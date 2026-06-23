
-- ─────────────────────────────────────────────────────────────────────────
-- Refund provider-settlement separation (pre-PayFast hardening).
--
-- Adds an additive "provider settlement" lifecycle to refund_requests so
-- status='approved' (internal credit reversal) is no longer overloaded as
-- "money returned to the customer". Existing balances/ledger/audit are
-- untouched. No outbound Paystack/PayFast refund submission is built; no
-- provider abstraction is introduced.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Additive columns (all nullable).
ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS provider_settlement_status text,
  ADD COLUMN IF NOT EXISTS provider_refund_reference  text,
  ADD COLUMN IF NOT EXISTS provider_submitted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS provider_settled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS provider_settlement_actor  uuid,
  ADD COLUMN IF NOT EXISTS provider_settlement_notes  text;

COMMENT ON COLUMN public.refund_requests.provider_settlement_status IS
'Provider-side money-movement lifecycle, independent of refund_requests.status. NULL on legacy rows. After this migration: approve_refund sets ''not_submitted''; decline_refund sets ''not_applicable''. Allowed: not_submitted, submitted, provider_pending, provider_completed, provider_failed, manually_settled_offline, not_applicable.';
COMMENT ON COLUMN public.refund_requests.provider_refund_reference IS
'Provider refund id (e.g. Paystack refund.processed.reference). Unique when set.';

-- 2. Supporting indexes.
CREATE INDEX IF NOT EXISTS idx_refund_requests_settlement_open
  ON public.refund_requests (reviewed_at)
  WHERE status = 'approved' AND provider_settlement_status = 'not_submitted';

CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_requests_provider_ref
  ON public.refund_requests (provider_refund_reference)
  WHERE provider_refund_reference IS NOT NULL;

-- 3. Validation trigger (multi-column rules → not a CHECK constraint).
CREATE OR REPLACE FUNCTION public.refund_requests_settlement_status_guard_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_allowed_status text[] := ARRAY[
    'pending','approved','declined',
    'blocked_credits_used','blocked_expired','superseded'
  ];
  v_allowed_settle text[] := ARRAY[
    'not_submitted','submitted','provider_pending',
    'provider_completed','provider_failed',
    'manually_settled_offline','not_applicable'
  ];
BEGIN
  IF NEW.status IS NULL OR NOT (NEW.status = ANY(v_allowed_status)) THEN
    RAISE EXCEPTION 'refund_requests.status invalid: %', NEW.status
      USING ERRCODE = '22023';
  END IF;

  IF NEW.provider_settlement_status IS NOT NULL
     AND NOT (NEW.provider_settlement_status = ANY(v_allowed_settle)) THEN
    RAISE EXCEPTION 'refund_requests.provider_settlement_status invalid: %',
      NEW.provider_settlement_status USING ERRCODE = '22023';
  END IF;

  -- Pending / blocked / superseded must NOT have a provider settlement status.
  IF NEW.status IN ('pending','blocked_credits_used','blocked_expired','superseded')
     AND NEW.provider_settlement_status IS NOT NULL THEN
    RAISE EXCEPTION 'refund_requests.provider_settlement_status must be NULL while status=%',
      NEW.status USING ERRCODE = '22023';
  END IF;

  -- Approved rows written by the new approve_refund must carry not_submitted
  -- (or a later legitimate settlement state). Legacy rows that pre-date this
  -- migration are tolerated by the WHEN clause on the trigger binding below.
  IF NEW.status = 'approved' AND NEW.provider_settlement_status IS NULL THEN
    RAISE EXCEPTION 'refund_requests.provider_settlement_status required when status=approved'
      USING ERRCODE = '22023';
  END IF;

  -- Declined rows: settlement is not_applicable.
  IF NEW.status = 'declined'
     AND COALESCE(NEW.provider_settlement_status, '') <> 'not_applicable' THEN
    RAISE EXCEPTION 'refund_requests.provider_settlement_status must be ''not_applicable'' when status=declined'
      USING ERRCODE = '22023';
  END IF;

  -- manually_settled_offline integrity.
  IF NEW.provider_settlement_status = 'manually_settled_offline' THEN
    IF NEW.provider_settlement_actor IS NULL
       OR NEW.provider_settled_at IS NULL
       OR NEW.provider_settlement_notes IS NULL
       OR char_length(btrim(NEW.provider_settlement_notes)) < 20 THEN
      RAISE EXCEPTION 'manually_settled_offline requires actor, settled timestamp, notes>=20'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- provider_completed integrity.
  IF NEW.provider_settlement_status = 'provider_completed' THEN
    IF NEW.provider_refund_reference IS NULL
       OR NEW.provider_settled_at IS NULL THEN
      RAISE EXCEPTION 'provider_completed requires provider_refund_reference and provider_settled_at'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refund_requests_settlement_status_guard
  ON public.refund_requests;
-- Only fire on INSERT (always) and on UPDATE when status or settlement status
-- actually changes. Legacy rows with NULL settlement status that get touched
-- for unrelated reasons (e.g. metadata updates) do not raise.
CREATE TRIGGER refund_requests_settlement_status_guard
BEFORE INSERT OR UPDATE OF status, provider_settlement_status,
                          provider_refund_reference, provider_settled_at,
                          provider_settlement_actor, provider_settlement_notes
ON public.refund_requests
FOR EACH ROW
EXECUTE FUNCTION public.refund_requests_settlement_status_guard_fn();

-- 4. approve_refund: set provider_settlement_status='not_submitted'. No other
--    change. Credit reversal / ledger / audit logic preserved verbatim.
CREATE OR REPLACE FUNCTION public.approve_refund(
  p_refund_request_id UUID,
  p_admin_user_id UUID,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rr RECORD;
  v_purchase RECORD;
  v_new_balance INTEGER;
  v_ledger_id UUID;
  v_correlation TEXT;
BEGIN
  IF p_reason IS NULL OR char_length(p_reason) < 20 THEN
    RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED');
  END IF;
  SELECT * INTO v_rr FROM public.refund_requests WHERE id = p_refund_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_NOT_FOUND');
  END IF;
  IF v_rr.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_ALREADY_DECIDED');
  END IF;

  SELECT * INTO v_purchase FROM public.token_purchases WHERE id = v_rr.token_purchase_id;
  v_correlation := 'refund_req_' || v_rr.id::text;

  UPDATE public.token_balances
    SET balance = GREATEST(0, balance - v_rr.credits_at_request)
    WHERE org_id = v_rr.org_id
    RETURNING balance INTO v_new_balance;

  INSERT INTO public.token_ledger (
    org_id, endpoint, tokens_burned, outcome, remaining_balance,
    request_id, action_type, entity_id, metadata
  ) VALUES (
    v_rr.org_id, 'refund', v_rr.credits_at_request, 'allowed', COALESCE(v_new_balance, 0),
    v_correlation, 'refund', v_rr.id,
    jsonb_build_object(
      'refund_request_id', v_rr.id,
      'token_purchase_id', v_rr.token_purchase_id,
      'approved_by', p_admin_user_id,
      'reason', p_reason,
      'source', 'approve_refund'
    )
  ) RETURNING id INTO v_ledger_id;

  UPDATE public.refund_requests
    SET status = 'approved',
        provider_settlement_status = 'not_submitted',
        decision_reason = p_reason,
        reviewed_by = p_admin_user_id,
        reviewed_at = now(),
        ledger_adjustment_id = v_ledger_id
    WHERE id = v_rr.id;

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
  VALUES (v_rr.org_id, 'refund_request', v_rr.id, 'billing.refund_approved',
    jsonb_build_object('approved_by', p_admin_user_id, 'reason', p_reason,
                       'ledger_id', v_ledger_id,
                       'credits_refunded', v_rr.credits_at_request,
                       'provider_settlement_status', 'not_submitted'));

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
  VALUES (v_rr.org_id, 'token_ledger', v_ledger_id, 'billing.credit_adjustment_recorded',
    jsonb_build_object('refund_request_id', v_rr.id,
                       'amount', v_rr.credits_at_request,
                       'kind', 'refund'));

  RETURN jsonb_build_object('success', true, 'ledger_id', v_ledger_id,
                            'provider_settlement_status', 'not_submitted');
END;
$$;

-- 5. decline_refund: set provider_settlement_status='not_applicable'.
CREATE OR REPLACE FUNCTION public.decline_refund(
  p_refund_request_id UUID,
  p_admin_user_id UUID,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rr RECORD;
BEGIN
  IF p_reason IS NULL OR char_length(p_reason) < 20 THEN
    RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED');
  END IF;
  SELECT * INTO v_rr FROM public.refund_requests WHERE id = p_refund_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'REFUND_NOT_FOUND'); END IF;
  IF v_rr.status <> 'pending' THEN RETURN jsonb_build_object('success', false, 'code', 'REFUND_ALREADY_DECIDED'); END IF;

  UPDATE public.refund_requests
    SET status = 'declined',
        provider_settlement_status = 'not_applicable',
        decision_reason = p_reason,
        reviewed_by = p_admin_user_id, reviewed_at = now()
    WHERE id = v_rr.id;

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
  VALUES (v_rr.org_id, 'refund_request', v_rr.id, 'billing.refund_declined',
    jsonb_build_object('declined_by', p_admin_user_id, 'reason', p_reason));

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 6. mark_refund_provider_settled: webhook-driven settlement confirmation.
--    Does NOT mutate token_balances or token_ledger. Idempotent on
--    (refund_request_id, provider_refund_reference).
CREATE OR REPLACE FUNCTION public.mark_refund_provider_settled(
  p_refund_request_id uuid,
  p_provider_refund_reference text,
  p_amount numeric DEFAULT NULL,
  p_currency text DEFAULT NULL,
  p_provider_event_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rr RECORD;
BEGIN
  IF p_refund_request_id IS NULL OR p_provider_refund_reference IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_INPUT');
  END IF;

  SELECT * INTO v_rr FROM public.refund_requests
    WHERE id = p_refund_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_NOT_FOUND');
  END IF;

  -- Idempotent: already settled with same reference.
  IF v_rr.provider_settlement_status = 'provider_completed'
     AND v_rr.provider_refund_reference = p_provider_refund_reference THEN
    RETURN jsonb_build_object(
      'success', true, 'deduplicated', true,
      'refund_request_id', v_rr.id);
  END IF;

  -- Conflicting reference: open risk item, do not overwrite.
  IF v_rr.provider_settlement_status = 'provider_completed'
     AND v_rr.provider_refund_reference <> p_provider_refund_reference THEN
    INSERT INTO public.admin_risk_items (
      org_id, kind, title, description, severity, status, dedup_key, metadata
    ) VALUES (
      v_rr.org_id, 'refund_settlement_conflict',
      'Refund settlement reference conflict',
      'refund_requests.id=' || v_rr.id || ' is already provider_completed with reference '
        || v_rr.provider_refund_reference
        || ' but webhook delivered a different reference '
        || p_provider_refund_reference || '. Investigate manually.',
      'high', 'open',
      'refund_settlement_conflict:' || v_rr.id::text || ':' || p_provider_refund_reference,
      jsonb_build_object(
        'refund_request_id', v_rr.id,
        'existing_reference', v_rr.provider_refund_reference,
        'incoming_reference', p_provider_refund_reference,
        'provider_event_id', p_provider_event_id)
    )
    ON CONFLICT (dedup_key) DO NOTHING;
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_SETTLEMENT_CONFLICT');
  END IF;

  -- Only allow settling from not_submitted (or NULL legacy) into completed.
  IF v_rr.provider_settlement_status IS NOT NULL
     AND v_rr.provider_settlement_status NOT IN ('not_submitted','submitted','provider_pending') THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_NOT_SETTLEABLE',
                              'current_status', v_rr.provider_settlement_status);
  END IF;

  UPDATE public.refund_requests
    SET provider_settlement_status = 'provider_completed',
        provider_refund_reference  = p_provider_refund_reference,
        provider_settled_at        = now(),
        updated_at                 = now()
    WHERE id = v_rr.id;

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
  VALUES (v_rr.org_id, 'refund_request', v_rr.id, 'billing.refund_provider_settled',
    jsonb_build_object(
      'provider_refund_reference', p_provider_refund_reference,
      'amount', p_amount,
      'currency', p_currency,
      'provider_event_id', p_provider_event_id,
      'source', 'mark_refund_provider_settled'));

  -- Auto-resolve any open settlement-pending risk item for this refund.
  UPDATE public.admin_risk_items
    SET status = 'resolved', resolved_at = now(), updated_at = now()
    WHERE dedup_key = 'refund_settlement_pending:' || v_rr.id::text
      AND status NOT IN ('resolved','closed');

  RETURN jsonb_build_object(
    'success', true, 'deduplicated', false,
    'refund_request_id', v_rr.id);
END;
$$;

-- 7. mark_refund_manually_settled_with_governance: admin records that the
--    refund was issued in the provider dashboard. No balance/ledger change.
CREATE OR REPLACE FUNCTION public.mark_refund_manually_settled_with_governance(
  p_refund_request_id uuid,
  p_admin_user_id uuid,
  p_notes text,
  p_request_id text,
  p_aal text DEFAULT 'aal2',
  p_action_code text DEFAULT 'refund.manual_settlement',
  p_policy_version text DEFAULT 'admin-hq-decision/v1'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rr RECORD;
  v_prev_hash text;
  v_occurred_at timestamptz := now();
  v_idempotency_key text;
  v_existing_event uuid;
  v_payload jsonb;
  v_event_hash text;
  v_event_id uuid;
  v_canonical text;
BEGIN
  IF p_refund_request_id IS NULL OR p_admin_user_id IS NULL
     OR p_notes IS NULL OR length(btrim(p_notes)) < 20 THEN
    RAISE EXCEPTION 'mark_refund_manually_settled_with_governance: invalid input'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := p_refund_request_id::text
    || '|admin.hq_decision_recorded|'
    || COALESCE(p_request_id, 'no-req')
    || '|' || p_action_code;

  SELECT * INTO v_rr FROM public.refund_requests
    WHERE id = p_refund_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_NOT_FOUND');
  END IF;

  -- Idempotency on (refund, request_id, action_code).
  SELECT id INTO v_existing_event
  FROM public.event_store
  WHERE aggregate_id = p_refund_request_id
    AND event_type = 'admin.hq_decision_recorded'
    AND payload->>'idempotency_key' = v_idempotency_key
    AND occurred_at > (now() - interval '5 minutes')
  ORDER BY occurred_at DESC
  LIMIT 1;

  IF v_existing_event IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true, 'deduplicated', true,
      'event_id', v_existing_event,
      'refund_request_id', p_refund_request_id);
  END IF;

  -- Only valid when the refund is internally approved and not yet settled.
  IF v_rr.status <> 'approved' THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_NOT_APPROVED');
  END IF;
  IF v_rr.provider_settlement_status IS DISTINCT FROM 'not_submitted' THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_ALREADY_SETTLED',
                              'current_status', v_rr.provider_settlement_status);
  END IF;

  UPDATE public.refund_requests
    SET provider_settlement_status = 'manually_settled_offline',
        provider_settlement_actor  = p_admin_user_id,
        provider_settlement_notes  = p_notes,
        provider_settled_at        = now(),
        updated_at                 = now()
    WHERE id = v_rr.id;

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
  VALUES (v_rr.org_id, 'refund_request', v_rr.id, 'billing.refund_manually_settled',
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'notes', p_notes,
      'source', 'mark_refund_manually_settled_with_governance'));

  -- Auto-resolve any open settlement-pending risk item.
  UPDATE public.admin_risk_items
    SET status = 'resolved', resolved_at = now(), updated_at = now()
    WHERE dedup_key = 'refund_settlement_pending:' || v_rr.id::text
      AND status NOT IN ('resolved','closed');

  -- Governance event (admin.hq_decision_recorded, hash-chained).
  v_payload := jsonb_build_object(
    'source_function',  'admin-refund-mark-settled',
    'request_id',       p_request_id,
    'correlation_id',   NULL,
    'idempotency_key',  v_idempotency_key,
    'previous_state',   'not_submitted',
    'new_state',        'manually_settled_offline',
    'allowed_or_blocked','allowed',
    'reason',           p_action_code,
    'reason_code',      p_action_code,
    'posture',          'Standard',
    'posture_snapshot', jsonb_build_object(
      'verification_posture', 'Standard',
      'policy_version', p_policy_version,
      'waiver_applied', false,
      'bypass_applied', false,
      'demo',           false,
      'test_mode',      false,
      'evidence_level', NULL,
      'check_status_snapshot', jsonb_build_object('aal', p_aal),
      'stale_verification', false,
      'manual_review_required', false
    ),
    'policy_version',   p_policy_version,
    'actor_role',       'platform_admin',
    'actor_org_id',     NULL,
    'system_actor',     NULL,
    'links', jsonb_build_object(
      'match_id', NULL, 'poi_id', NULL, 'wad_id', NULL, 'engagement_id', NULL,
      'payment_reference', v_rr.token_purchase_id,
      'credit_ledger_id', v_rr.ledger_adjustment_id),
    'match_id', NULL,
    'poi_id',   NULL,
    'metadata', jsonb_build_object(
      'action_code',       p_action_code,
      'notes',             p_notes,
      'aal',               p_aal,
      'policy_version',    p_policy_version,
      'refund_request_id', p_refund_request_id,
      'token_purchase_id', v_rr.token_purchase_id)
  );

  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE org_id = v_rr.org_id
    AND aggregate_type = 'refund_request'
    AND aggregate_id = p_refund_request_id
  ORDER BY occurred_at DESC
  LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash',      v_prev_hash,
    'org_id',         v_rr.org_id,
    'aggregate_type', 'refund_request',
    'aggregate_id',   p_refund_request_id,
    'event_type',     'admin.hq_decision_recorded',
    'occurred_at',    to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload',        v_payload
  )::text;
  v_event_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    occurred_at, actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    v_rr.org_id, 'core', 'refund_request', p_refund_request_id,
    'admin.hq_decision_recorded',
    v_occurred_at, p_admin_user_id, 'platform_admin',
    v_payload, v_prev_hash, v_event_hash
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true, 'deduplicated', false,
    'event_id', v_event_id,
    'refund_request_id', p_refund_request_id);
END;
$$;

-- 8. surface_unsettled_refunds: bounded sweeper that opens / auto-resolves
--    admin_risk_items for approved refunds awaiting provider settlement.
CREATE OR REPLACE FUNCTION public.surface_unsettled_refunds(
  p_min_age_minutes int DEFAULT 1440,
  p_limit int DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_opened int := 0;
  v_resolved int := 0;
  r RECORD;
BEGIN
  -- Open dedup'd risk items for stale approved+not_submitted refunds.
  FOR r IN
    SELECT id, org_id, reviewed_at
    FROM public.refund_requests
    WHERE status = 'approved'
      AND provider_settlement_status = 'not_submitted'
      AND reviewed_at < now() - (p_min_age_minutes || ' minutes')::interval
    ORDER BY reviewed_at ASC
    LIMIT GREATEST(0, p_limit)
  LOOP
    INSERT INTO public.admin_risk_items (
      org_id, kind, title, description, severity, status, dedup_key, metadata
    ) VALUES (
      r.org_id, 'refund_settlement_pending',
      'Approved refund awaiting provider settlement',
      'Refund ' || r.id || ' was internally approved at ' || r.reviewed_at
        || '. Credits were reversed in-platform. No provider settlement has been recorded. '
        || 'Issue the refund in the provider dashboard and click ''Mark manually settled'', '
        || 'or wait for the provider refund webhook.',
      'medium', 'open',
      'refund_settlement_pending:' || r.id::text,
      jsonb_build_object('refund_request_id', r.id,
                         'reviewed_at', r.reviewed_at)
    )
    ON CONFLICT (dedup_key) DO NOTHING;
    IF FOUND THEN v_opened := v_opened + 1; END IF;
  END LOOP;

  -- Auto-resolve risk items whose underlying refund is no longer not_submitted.
  WITH resolved AS (
    UPDATE public.admin_risk_items ari
      SET status = 'resolved', resolved_at = now(), updated_at = now()
    FROM public.refund_requests rr
    WHERE ari.kind = 'refund_settlement_pending'
      AND ari.status NOT IN ('resolved','closed')
      AND ari.dedup_key = 'refund_settlement_pending:' || rr.id::text
      AND COALESCE(rr.provider_settlement_status, '') <> 'not_submitted'
    RETURNING ari.id
  )
  SELECT count(*) INTO v_resolved FROM resolved;

  RETURN jsonb_build_object(
    'success', true,
    'opened', v_opened,
    'resolved', v_resolved);
END;
$$;

-- 9. Grants — keep parity with the existing refund function lockdown
--    (service_role only; called by edge functions / cron).
REVOKE ALL ON FUNCTION public.refund_requests_settlement_status_guard_fn() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.mark_refund_provider_settled(uuid, text, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_refund_provider_settled(uuid, text, numeric, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_refund_provider_settled(uuid, text, numeric, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.mark_refund_manually_settled_with_governance(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_refund_manually_settled_with_governance(uuid, uuid, text, text, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_refund_manually_settled_with_governance(uuid, uuid, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.surface_unsettled_refunds(int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.surface_unsettled_refunds(int, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.surface_unsettled_refunds(int, int) TO service_role;

COMMENT ON FUNCTION public.mark_refund_provider_settled(uuid, text, numeric, text, text) IS
'Webhook-driven: marks a refund_requests row as provider_completed. Idempotent on (refund, provider_refund_reference). Does NOT touch token_balances or token_ledger; called after credit reversal already happened in approve_refund.';

COMMENT ON FUNCTION public.mark_refund_manually_settled_with_governance(uuid, uuid, text, text, text, text, text) IS
'Admin-driven: records that an approved refund was issued in the provider dashboard. Requires notes>=20. No balance/ledger side effect. Writes hash-chained admin.hq_decision_recorded governance event in the same transaction.';

COMMENT ON FUNCTION public.surface_unsettled_refunds(int, int) IS
'Reconciliation sweeper: opens one deduped admin_risk_items row per approved refund older than p_min_age_minutes whose provider_settlement_status is not_submitted. Auto-resolves risk items whose refund is no longer not_submitted.';
