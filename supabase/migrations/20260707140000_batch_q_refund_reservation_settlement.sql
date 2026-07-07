-- ============================================================================
-- Batch Q -- Provider-neutral refund reservation and settlement finalisation.
--
-- Client decision (completed PayFast/Paystack refund questionnaire):
-- * Admin approval means "approved for refund processing" only. Credits are
--   RESERVED at approval, not finally deducted.
-- * Final deduction happens only when a provider confirms successful
--   settlement (existing Paystack webhook path) OR an authorised admin
--   records a manual offline settlement (reason + reference + timestamp +
--   admin identity + audit entry).
-- * Settlement mismatches always go to manual review. No automatic refund,
--   no automatic credit, no automatic final deduction.
-- * Provider-neutral: does not add, fake, or assume any PayFast automated
--   refund-status API. PayFast refund settlement remains manual-offline-only
--   until a real PayFast refund-status integration exists (Phase 2K /
--   provider-adapter gap). Paystack webhook settlement is unchanged and
--   continues to call mark_refund_provider_settled.
--
-- Additive only. Does not touch token-purchase, PayFast ITN credit path,
-- Paystack webhook credit path, or any table/function unrelated to refunds,
-- other than the single WHERE-clause change in atomic_token_burn needed so
-- reserved credits cannot be spent (see step 5).
-- ============================================================================

-- 1. Reservation bookkeeping column on token_balances.
--    balance stays the customer's TOTAL balance. Spendable balance is
--    (balance - reserved_refund_tokens). Reserving credits for a pending
--    refund no longer touches `balance` directly; it only increases this
--    column, so the deduction is not "final" until settlement.
ALTER TABLE public.token_balances
  ADD COLUMN IF NOT EXISTS reserved_refund_tokens integer NOT NULL DEFAULT 0;

ALTER TABLE public.token_balances
  DROP CONSTRAINT IF EXISTS token_balances_reserved_refund_tokens_nonneg;
ALTER TABLE public.token_balances
  ADD CONSTRAINT token_balances_reserved_refund_tokens_nonneg
  CHECK (reserved_refund_tokens >= 0);

COMMENT ON COLUMN public.token_balances.reserved_refund_tokens IS
'Batch Q: credits held against pending (approved, not-yet-settled) refund requests. Spendable balance = balance - reserved_refund_tokens. Incremented only by approve_refund; decremented only by mark_refund_provider_settled / mark_refund_manually_settled_with_governance when a reservation is consumed. Never written directly by edge functions.';

-- 2. Reservation table -- one row per refund_request, SSOT for hold state.
CREATE TABLE IF NOT EXISTS public.token_refund_reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    refund_request_id uuid NOT NULL REFERENCES public.refund_requests(id),
    org_id uuid NOT NULL,
    reserved_credits integer NOT NULL CHECK (reserved_credits >= 0),
    status text NOT NULL DEFAULT 'active',
    final_ledger_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    consumed_at timestamptz,
    released_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
  );

ALTER TABLE public.token_refund_reservations
  DROP CONSTRAINT IF EXISTS token_refund_reservations_status_check;
ALTER TABLE public.token_refund_reservations
  ADD CONSTRAINT token_refund_reservations_status_check
  CHECK (status IN ('active','consumed','released'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_token_refund_reservations_refund_request
  ON public.token_refund_reservations (refund_request_id);

COMMENT ON TABLE public.token_refund_reservations IS
'Batch Q: one row per refund_request_id. Tracks a hold on credits between admin approval and final settlement (provider-confirmed or manual). status=active while pending settlement; consumed once final deduction is written by mark_refund_provider_settled / mark_refund_manually_settled_with_governance. Internal bookkeeping table: service_role only, no direct client access, RLS enabled with no grants to anon/authenticated.';

ALTER TABLE public.token_refund_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.token_refund_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.token_refund_reservations TO service_role;

-- 3. Additive linkage columns on refund_requests.
ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS reservation_id uuid REFERENCES public.token_refund_reservations(id),
  ADD COLUMN IF NOT EXISTS final_ledger_id uuid;

COMMENT ON COLUMN public.refund_requests.reservation_id IS
'Batch Q: FK to token_refund_reservations. Set by approve_refund. NULL for legacy rows approved before Batch Q -- their credits were already finally deducted under the old immediate-deduction behaviour and require no reservation.';
COMMENT ON COLUMN public.refund_requests.final_ledger_id IS
'Batch Q: token_ledger row id of the FINAL refund deduction, written only by mark_refund_provider_settled or mark_refund_manually_settled_with_governance at actual settlement time. NULL until settlement evidence exists.';

-- 4. approve_refund -- reserve, do not finally deduct.
CREATE OR REPLACE FUNCTION public.approve_refund(
    p_refund_request_id UUID,
    p_admin_user_id UUID,
    p_reason TEXT
  ) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rr RECORD;
  v_bal RECORD;
  v_reserve_amount integer;
  v_available integer;
  v_hold_ledger_id UUID;
  v_reservation_id UUID;
  v_existing_reservation RECORD;
  v_correlation TEXT;
BEGIN
  IF p_reason IS NULL OR char_length(p_reason) < 20 THEN
    RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_rr FROM public.refund_requests WHERE id = p_refund_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_NOT_FOUND');
  END IF;

  -- Idempotent replay: refund already approved with a reservation on file.
  IF v_rr.status = 'approved' AND v_rr.reservation_id IS NOT NULL THEN
    SELECT * INTO v_existing_reservation FROM public.token_refund_reservations
      WHERE id = v_rr.reservation_id;
    RETURN jsonb_build_object(
            'success', true, 'deduplicated', true,
            'ledger_id', v_rr.ledger_adjustment_id,
            'reservation_id', v_rr.reservation_id,
            'reserved_credits', v_existing_reservation.reserved_credits,
            'provider_settlement_status', v_rr.provider_settlement_status
          );
  END IF;

  IF v_rr.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_ALREADY_DECIDED');
  END IF;

  v_correlation := 'refund_req_' || v_rr.id::text;

  SELECT balance, reserved_refund_tokens INTO v_bal
    FROM public.token_balances WHERE org_id = v_rr.org_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'TOKEN_BALANCE_NOT_FOUND');
  END IF;

  v_available := GREATEST(0, v_bal.balance - COALESCE(v_bal.reserved_refund_tokens, 0));
  -- Cannot reserve more credits than are currently available. If the org has
  -- since spent below the requested amount, reserve what remains available
  -- and flag it -- do not block the admin decision, mirroring the previous
  -- GREATEST(0, ...) floor behaviour of the pre-Batch-Q deduction.
  v_reserve_amount := GREATEST(0, LEAST(v_rr.credits_at_request, v_available));

  -- Reservation row is the idempotency anchor (unique on refund_request_id).
  INSERT INTO public.token_refund_reservations (
        refund_request_id, org_id, reserved_credits, status, metadata
      ) VALUES (
        v_rr.id, v_rr.org_id, v_reserve_amount, 'active',
        jsonb_build_object(
          'requested_credits', v_rr.credits_at_request,
          'partial_reservation', v_reserve_amount < v_rr.credits_at_request
        )
      )
  ON CONFLICT (refund_request_id) DO NOTHING
  RETURNING id INTO v_reservation_id;

  IF v_reservation_id IS NULL THEN
    -- Concurrent duplicate approval race: reservation already exists.
    SELECT id INTO v_reservation_id FROM public.token_refund_reservations
      WHERE refund_request_id = v_rr.id;
  ELSE
    -- Only move the hold when we actually created the reservation.
    UPDATE public.token_balances
      SET reserved_refund_tokens = reserved_refund_tokens + v_reserve_amount
      WHERE org_id = v_rr.org_id;
  END IF;

  INSERT INTO public.token_ledger (
        org_id, endpoint, tokens_burned, outcome, remaining_balance,
        request_id, action_type, entity_id, metadata
      ) VALUES (
        v_rr.org_id, 'refund_hold', 0, 'allowed', v_bal.balance,
        v_correlation, 'refund_hold', v_rr.id,
        jsonb_build_object(
          'refund_request_id', v_rr.id,
          'token_purchase_id', v_rr.token_purchase_id,
          'approved_by', p_admin_user_id,
          'reason', p_reason,
          'reserved_credits', v_reserve_amount,
          'reservation_id', v_reservation_id,
          'source', 'approve_refund',
          'note', 'Hold only. No final deduction. Final deduction is written at settlement by mark_refund_provider_settled or mark_refund_manually_settled_with_governance.'
        )
      ) RETURNING id INTO v_hold_ledger_id;

  UPDATE public.refund_requests
    SET status = 'approved',
        provider_settlement_status = 'not_submitted',
        decision_reason = p_reason,
        reviewed_by = p_admin_user_id,
        reviewed_at = now(),
        ledger_adjustment_id = v_hold_ledger_id,
        reservation_id = v_reservation_id
    WHERE id = v_rr.id;

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
    VALUES (v_rr.org_id, 'refund_request', v_rr.id, 'billing.refund_approved',
          jsonb_build_object('approved_by', p_admin_user_id, 'reason', p_reason,
            'ledger_id', v_hold_ledger_id,
            'reserved_credits', v_reserve_amount,
            'reservation_id', v_reservation_id,
            'provider_settlement_status', 'not_submitted',
            'note', 'Credits reserved, not finally deducted (Batch Q).'));

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
    VALUES (v_rr.org_id, 'token_ledger', v_hold_ledger_id, 'billing.credit_reservation_recorded',
          jsonb_build_object('refund_request_id', v_rr.id,
            'reserved_credits', v_reserve_amount,
            'kind', 'refund_hold'));

  RETURN jsonb_build_object('success', true, 'deduplicated', false,
        'ledger_id', v_hold_ledger_id,
        'reservation_id', v_reservation_id,
        'reserved_credits', v_reserve_amount,
        'provider_settlement_status', 'not_submitted');
END;
$$;

-- 5. atomic_token_burn -- spendable balance must exclude reserved holds.
--    Only the WHERE-clause guard changes. Everything else (billing_hold
--    check, ledger insert, governance emission) is preserved verbatim from
--    the existing deployed function.
CREATE OR REPLACE FUNCTION public.atomic_token_burn(
  p_org_id uuid,
  p_amount integer,
  p_reason text DEFAULT 'governance_burn'::text,
  p_reference_id text DEFAULT NULL::text,
  p_governance jsonb DEFAULT NULL
  )
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
v_old_balance integer; v_new_balance integer;
v_correlation_id text; v_match_id_meta jsonb := '{}'::jsonb;
v_billing_hold boolean;
v_ledger_id uuid;
v_governance_event_id uuid;
v_gov_input jsonb;
BEGIN
SELECT billing_hold INTO v_billing_hold FROM public.organizations WHERE id = p_org_id;
IF v_billing_hold IS TRUE THEN
RETURN jsonb_build_object('success', false, 'error', 'BILLING_HOLD_ACTIVE',
  'message', 'Organisation is on billing hold; credit burns are blocked until released.');
END IF;

-- Batch Q: spendable balance excludes credits reserved against a pending
-- refund. A refund reservation must never be spendable until it is
-- released or consumed.
UPDATE token_balances SET balance = balance - p_amount
WHERE org_id = p_org_id AND (balance - COALESCE(reserved_refund_tokens, 0)) >= p_amount
RETURNING balance INTO v_new_balance;
IF NOT FOUND THEN
SELECT balance INTO v_old_balance FROM token_balances WHERE org_id = p_org_id;
RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_TOKENS',
  'current_balance', COALESCE(v_old_balance, 0), 'requested_amount', p_amount);
END IF;

v_correlation_id := COALESCE(p_reference_id, gen_random_uuid()::text);
IF p_reference_id IS NOT NULL AND public._is_uuid(p_reference_id) THEN
v_match_id_meta := jsonb_build_object('match_id', p_reference_id);
END IF;

INSERT INTO token_ledger (org_id, endpoint, tokens_burned, outcome, remaining_balance, request_id, action_type, metadata)
VALUES (p_org_id, COALESCE(p_reason, 'unknown'), p_amount, 'allowed', v_new_balance, v_correlation_id,
  CASE WHEN p_reason LIKE 'action:%' THEN substring(p_reason from 8)
  WHEN p_reason LIKE 'api:%' THEN 'api_call' ELSE p_reason END,
  jsonb_build_object('source', 'atomic_token_burn', 'correlation_id', v_correlation_id,
  'balance_before', v_new_balance + p_amount, 'balance_after', v_new_balance) || v_match_id_meta)
RETURNING id INTO v_ledger_id;

IF p_governance IS NOT NULL THEN
v_gov_input := p_governance
|| jsonb_build_object(
  'org_id', p_org_id::text,
  'aggregate_type', COALESCE(p_governance->>'aggregate_type','credit_burn'),
  'aggregate_id', COALESCE(p_governance->>'aggregate_id', p_org_id::text),
  'event_type', COALESCE(p_governance->>'event_type','credit.burned'),
  'credit_ledger_id', v_ledger_id::text
  );
v_gov_input := jsonb_set(
  v_gov_input,
  '{metadata}',
  COALESCE(v_gov_input->'metadata','{}'::jsonb)
  || jsonb_build_object(
  'amount', p_amount,
  'balance_before', v_new_balance + p_amount,
  'balance_after', v_new_balance,
  'credit_ledger_id', v_ledger_id::text
  ),
  true
  );
v_governance_event_id := public.gov_emit_event(v_gov_input);
END IF;

RETURN jsonb_build_object('success', true, 'balance_before', v_new_balance + p_amount,
  'balance_after', v_new_balance, 'burned', p_amount, 'reason', p_reason,
  'reference_id', p_reference_id, 'correlation_id', v_correlation_id,
  'credit_ledger_id', v_ledger_id,
  'governance_event_id', v_governance_event_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_token_burn(uuid, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_token_burn(uuid, integer, text, text, jsonb) TO service_role;

-- 6. mark_refund_provider_settled -- consume reservation, final-deduct once.
--    Preserves the existing Paystack webhook call site and its idempotency /
--    conflict-detection behaviour verbatim; adds reservation consumption,
--    a best-effort currency cross-check, and a legacy-row fallback for
--    refunds approved before this migration (which have no reservation
--    because they were already finally deducted under the old behaviour).
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
  v_reservation RECORD;
  v_purchase RECORD;
  v_final_ledger_id uuid;
  v_new_balance integer;
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
          'refund_request_id', v_rr.id,
          'final_ledger_id', v_rr.final_ledger_id);
  END IF;

  -- Conflicting reference: open risk item, do not overwrite, no money moves.
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

  IF v_rr.status <> 'approved' THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_NOT_APPROVED');
  END IF;

  IF v_rr.provider_settlement_status IS NOT NULL
     AND v_rr.provider_settlement_status NOT IN ('not_submitted','submitted','provider_pending') THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_NOT_SETTLEABLE',
          'current_status', v_rr.provider_settlement_status);
  END IF;

  IF v_rr.reservation_id IS NULL THEN
    -- Legacy refund approved before Batch Q: credits were already finally
    -- deducted at approval time under the old behaviour. Do not attempt a
    -- second deduction -- record settlement confirmation only.
    UPDATE public.refund_requests
      SET provider_settlement_status = 'provider_completed',
          provider_refund_reference = p_provider_refund_reference,
          provider_settled_at = now(),
          updated_at = now()
      WHERE id = v_rr.id;

    INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
      VALUES (v_rr.org_id, 'refund_request', v_rr.id, 'billing.refund_provider_settled',
              jsonb_build_object(
                'provider_refund_reference', p_provider_refund_reference,
                'amount', p_amount, 'currency', p_currency,
                'provider_event_id', p_provider_event_id,
                'source', 'mark_refund_provider_settled',
                'note', 'Legacy pre-Batch-Q refund: credits were already finally deducted at approval; no reservation to consume.'));

    UPDATE public.admin_risk_items
      SET status = 'resolved', resolved_at = now(), updated_at = now()
      WHERE dedup_key = 'refund_settlement_pending:' || v_rr.id::text
        AND status NOT IN ('resolved','closed');

    RETURN jsonb_build_object('success', true, 'deduplicated', false,
            'refund_request_id', v_rr.id, 'legacy_pre_reservation', true);
  END IF;

  SELECT * INTO v_reservation FROM public.token_refund_reservations
    WHERE id = v_rr.reservation_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'RESERVATION_NOT_FOUND');
  END IF;

  IF v_reservation.status = 'consumed' THEN
    RETURN jsonb_build_object('success', true, 'deduplicated', true,
          'refund_request_id', v_rr.id, 'final_ledger_id', v_reservation.final_ledger_id);
  END IF;

  IF v_reservation.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'code', 'RESERVATION_NOT_ACTIVE',
          'reservation_status', v_reservation.status);
  END IF;

  -- Best-effort currency cross-check where we have data to check against.
  -- A mismatch always goes to manual review; it never moves money/credits.
  IF p_currency IS NOT NULL THEN
    SELECT * INTO v_purchase FROM public.token_purchases WHERE id = v_rr.token_purchase_id;
    IF v_purchase.currency IS NOT NULL AND upper(v_purchase.currency) <> upper(p_currency) THEN
      INSERT INTO public.admin_risk_items (
              org_id, kind, title, description, severity, status, dedup_key, metadata
            ) VALUES (
              v_rr.org_id, 'refund_settlement_mismatch',
              'Refund settlement currency mismatch',
              'refund_requests.id=' || v_rr.id || ' purchase currency ' || v_purchase.currency
                || ' does not match provider settlement currency ' || p_currency
                || '. Held for manual review; no automatic credit/refund movement performed.',
              'high', 'open',
              'refund_settlement_mismatch:' || v_rr.id::text || ':' || p_provider_refund_reference,
              jsonb_build_object('refund_request_id', v_rr.id, 'expected_currency', v_purchase.currency,
                'reported_currency', p_currency, 'provider_event_id', p_provider_event_id)
            )
      ON CONFLICT (dedup_key) DO NOTHING;
      RETURN jsonb_build_object('success', false, 'code', 'REFUND_SETTLEMENT_MISMATCH');
    END IF;
  END IF;

  -- Consume the reservation and finally deduct.
  UPDATE public.token_balances
    SET balance = GREATEST(0, balance - v_reservation.reserved_credits),
        reserved_refund_tokens = GREATEST(0, reserved_refund_tokens - v_reservation.reserved_credits)
    WHERE org_id = v_rr.org_id
    RETURNING balance INTO v_new_balance;

  INSERT INTO public.token_ledger (
        org_id, endpoint, tokens_burned, outcome, remaining_balance,
        request_id, action_type, entity_id, metadata
      ) VALUES (
        v_rr.org_id, 'refund', v_reservation.reserved_credits, 'allowed', COALESCE(v_new_balance, 0),
        'refund_settled_' || v_rr.id::text, 'refund', v_rr.id,
        jsonb_build_object(
          'refund_request_id', v_rr.id,
          'token_purchase_id', v_rr.token_purchase_id,
          'reservation_id', v_reservation.id,
          'provider_refund_reference', p_provider_refund_reference,
          'provider_event_id', p_provider_event_id,
          'source', 'mark_refund_provider_settled'
        )
      ) RETURNING id INTO v_final_ledger_id;

  UPDATE public.token_refund_reservations
    SET status = 'consumed', consumed_at = now(), final_ledger_id = v_final_ledger_id
    WHERE id = v_reservation.id;

  UPDATE public.refund_requests
    SET provider_settlement_status = 'provider_completed',
        provider_refund_reference = p_provider_refund_reference,
        provider_settled_at = now(),
        final_ledger_id = v_final_ledger_id,
        updated_at = now()
    WHERE id = v_rr.id;

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
    VALUES (v_rr.org_id, 'refund_request', v_rr.id, 'billing.refund_provider_settled',
          jsonb_build_object(
            'provider_refund_reference', p_provider_refund_reference,
            'amount', p_amount, 'currency', p_currency,
            'provider_event_id', p_provider_event_id,
            'reservation_id', v_reservation.id,
            'final_ledger_id', v_final_ledger_id,
            'credits_refunded', v_reservation.reserved_credits,
            'source', 'mark_refund_provider_settled'));

  UPDATE public.admin_risk_items
    SET status = 'resolved', resolved_at = now(), updated_at = now()
    WHERE dedup_key = 'refund_settlement_pending:' || v_rr.id::text
      AND status NOT IN ('resolved','closed');

  RETURN jsonb_build_object(
        'success', true, 'deduplicated', false,
        'refund_request_id', v_rr.id,
        'final_ledger_id', v_final_ledger_id,
        'credits_refunded', v_reservation.reserved_credits);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_refund_provider_settled(uuid, text, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_refund_provider_settled(uuid, text, numeric, text, text) TO service_role;

-- 7. mark_refund_manually_settled_with_governance -- consume reservation,
--    final-deduct once, keep governance/audit requirements unchanged
--    (authorised admin, notes >= 20 chars, hash-chained governance event).
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
  v_reservation RECORD;
  v_new_balance integer;
  v_final_ledger_id uuid;
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
          'refund_request_id', p_refund_request_id,
          'final_ledger_id', v_rr.final_ledger_id);
  END IF;

  IF v_rr.status <> 'approved' THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_NOT_APPROVED');
  END IF;
  IF v_rr.provider_settlement_status IS DISTINCT FROM 'not_submitted' THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_ALREADY_SETTLED',
          'current_status', v_rr.provider_settlement_status);
  END IF;

  IF v_rr.reservation_id IS NOT NULL THEN
    SELECT * INTO v_reservation FROM public.token_refund_reservations
      WHERE id = v_rr.reservation_id FOR UPDATE;

    IF FOUND AND v_reservation.status = 'active' THEN
      UPDATE public.token_balances
        SET balance = GREATEST(0, balance - v_reservation.reserved_credits),
            reserved_refund_tokens = GREATEST(0, reserved_refund_tokens - v_reservation.reserved_credits)
        WHERE org_id = v_rr.org_id
        RETURNING balance INTO v_new_balance;

      INSERT INTO public.token_ledger (
                org_id, endpoint, tokens_burned, outcome, remaining_balance,
                request_id, action_type, entity_id, metadata
              ) VALUES (
                v_rr.org_id, 'refund', v_reservation.reserved_credits, 'allowed', COALESCE(v_new_balance, 0),
                'refund_manual_settled_' || v_rr.id::text, 'refund', v_rr.id,
                jsonb_build_object(
                  'refund_request_id', v_rr.id,
                  'token_purchase_id', v_rr.token_purchase_id,
                  'reservation_id', v_reservation.id,
                  'admin_user_id', p_admin_user_id,
                  'notes', p_notes,
                  'source', 'mark_refund_manually_settled_with_governance'
                )
              ) RETURNING id INTO v_final_ledger_id;

      UPDATE public.token_refund_reservations
        SET status = 'consumed', consumed_at = now(), final_ledger_id = v_final_ledger_id
        WHERE id = v_reservation.id;
    END IF;
  END IF;
  -- If reservation_id IS NULL (legacy pre-Batch-Q refund), credits were
  -- already finally deducted at approval time; no second deduction here.

  UPDATE public.refund_requests
    SET provider_settlement_status = 'manually_settled_offline',
        provider_settlement_actor = p_admin_user_id,
        provider_settlement_notes = p_notes,
        provider_settled_at = now(),
        final_ledger_id = COALESCE(v_final_ledger_id, final_ledger_id),
        updated_at = now()
    WHERE id = v_rr.id;

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
    VALUES (v_rr.org_id, 'refund_request', v_rr.id, 'billing.refund_manually_settled',
          jsonb_build_object(
            'admin_user_id', p_admin_user_id,
            'notes', p_notes,
            'final_ledger_id', v_final_ledger_id,
            'source', 'mark_refund_manually_settled_with_governance'));

  UPDATE public.admin_risk_items
    SET status = 'resolved', resolved_at = now(), updated_at = now()
    WHERE dedup_key = 'refund_settlement_pending:' || v_rr.id::text
      AND status NOT IN ('resolved','closed');

  v_payload := jsonb_build_object(
        'source_function', 'admin-refund-mark-settled',
        'request_id', p_request_id,
        'correlation_id', NULL,
        'idempotency_key', v_idempotency_key,
        'previous_state', 'not_submitted',
        'new_state', 'manually_settled_offline',
        'allowed_or_blocked','allowed',
        'reason', p_action_code,
        'reason_code', p_action_code,
        'posture', 'Standard',
        'posture_snapshot', jsonb_build_object(
          'verification_posture', 'Standard',
          'policy_version', p_policy_version,
          'waiver_applied', false,
          'bypass_applied', false,
          'demo', false,
          'test_mode', false,
          'evidence_level', NULL,
          'check_status_snapshot', jsonb_build_object('aal', p_aal),
          'stale_verification', false,
          'manual_review_required', false
        ),
        'policy_version', p_policy_version,
        'actor_role', 'platform_admin',
        'actor_org_id', NULL,
        'system_actor', NULL,
        'links', jsonb_build_object(
          'match_id', NULL, 'poi_id', NULL, 'wad_id', NULL, 'engagement_id', NULL,
          'payment_reference', v_rr.token_purchase_id,
          'credit_ledger_id', v_final_ledger_id),
        'match_id', NULL,
        'poi_id', NULL,
        'metadata', jsonb_build_object(
          'action_code', p_action_code,
          'notes', p_notes,
          'aal', p_aal,
          'policy_version', p_policy_version,
          'refund_request_id', p_refund_request_id,
          'token_purchase_id', v_rr.token_purchase_id,
          'final_ledger_id', v_final_ledger_id)
      );

  SELECT event_hash INTO v_prev_hash
    FROM public.event_store
    WHERE org_id = v_rr.org_id
      AND aggregate_type = 'refund_request'
      AND aggregate_id = p_refund_request_id
    ORDER BY occurred_at DESC
    LIMIT 1;

  v_canonical := jsonb_build_object(
        'prev_hash', v_prev_hash,
        'org_id', v_rr.org_id,
        'aggregate_type', 'refund_request',
        'aggregate_id', p_refund_request_id,
        'event_type', 'admin.hq_decision_recorded',
        'occurred_at', to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'payload', v_payload
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
        'refund_request_id', p_refund_request_id,
        'final_ledger_id', v_final_ledger_id);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_refund_manually_settled_with_governance(uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_refund_manually_settled_with_governance(uuid, uuid, text, text, text, text, text) TO service_role;

-- 8. surface_unsettled_refunds -- wording only. Credits are now held via a
--    reservation, not "reversed in-platform", while awaiting settlement.
--    Logic (which rows qualify, dedup, auto-resolve) is unchanged.
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
          || '. Credits are held in reserve pending settlement (Batch Q); they have not been finally deducted. '
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

REVOKE ALL ON FUNCTION public.surface_unsettled_refunds(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.surface_unsettled_refunds(int, int) TO service_role;


-- 9. Batch Q fix: token_ledger_action_type_check does not currently allow
-- an action_type value for the refund-hold audit marker written by
-- approve_refund (step 4 above uses action_type='refund_hold', tokens_burned=0,
-- to record that a reservation was created WITHOUT performing a real
-- deduction). Without this widening, approve_refund would fail at
-- execution time with a check-constraint violation. This additively
-- extends the existing whitelist (see migration
-- 20260503195606_c0d1533f-b4c9-4be8-bec9-b3c7552eb285.sql) by exactly one
-- value; no existing allowed value is removed or altered.
ALTER TABLE public.token_ledger DROP CONSTRAINT IF EXISTS token_ledger_action_type_check;
ALTER TABLE public.token_ledger ADD CONSTRAINT token_ledger_action_type_check
CHECK (action_type = ANY (ARRAY[
    'api_call', 'system_adjustment', 'declare_intent', 'credit',
    'counterparty_sighting', 'transaction_complete', 'buyer_commit',
    'credit_purchase', 'poi_generation', 'refund', 'administrative_adjustment',
    'legacy_pre_production_poi_generation', 'refund_hold'
  ]));
