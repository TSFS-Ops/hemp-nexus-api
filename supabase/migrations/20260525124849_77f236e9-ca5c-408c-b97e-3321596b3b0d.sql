-- Batch F2: atomic refund approve/decline + Governance Record event.
-- Mirrors Batch F1 (admin_credit_org_with_governance). Closes the gap where
-- approve_refund / decline_refund committed and recordAdminHqDecision could
-- fail afterwards, leaving the refund decided but no canonical
-- admin.hq_decision_recorded event in event_store.
--
-- Contract (both functions):
--   * SECURITY DEFINER, service_role-only EXECUTE.
--   * Calls public.approve_refund / decline_refund inside the same tx.
--     If the RPC returns success=false OR raises, the whole tx rolls back.
--   * Inserts a hash-chained 'admin.hq_decision_recorded' row into event_store
--     with aggregate_type='refund_request', aggregate_id=p_refund_request_id.
--   * Payload shape mirrors supabase/functions/_shared/governance-audit.ts
--     buildPayload() so the Phase 1 UI normaliser keeps working.
--   * Idempotent on (aggregate_id, event_type, payload->>idempotency_key)
--     within a 5-minute window.

-- ─────────────────────────────────────────────────────────────────────────
-- Shared helper: build the canonical admin.hq_decision_recorded payload.
-- Inlined per-function so we keep the wrappers self-contained (matches F1).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_refund_approve_with_governance(
  p_refund_request_id uuid,
  p_admin_user_id uuid,
  p_reason text,
  p_request_id text,
  p_aal text DEFAULT 'aal2',
  p_action_code text DEFAULT 'refund.approve',
  p_policy_version text DEFAULT 'admin-hq-decision/v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rr RECORD;
  v_rpc_result jsonb;
  v_prev_hash text;
  v_occurred_at timestamptz := now();
  v_idempotency_key text;
  v_existing_event uuid;
  v_payload jsonb;
  v_event_hash text;
  v_event_id uuid;
  v_canonical text;
  v_org_id uuid;
  v_token_purchase_id uuid;
BEGIN
  IF p_refund_request_id IS NULL OR p_admin_user_id IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'admin_refund_approve_with_governance: invalid input'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := p_refund_request_id::text
    || '|admin.hq_decision_recorded|'
    || COALESCE(p_request_id, 'no-req')
    || '|' || p_action_code;

  -- Resolve org_id for the aggregate + idempotency lookup. Refund row may
  -- not exist yet if request id is bogus — let approve_refund return the
  -- structured REFUND_NOT_FOUND in that case.
  SELECT org_id, token_purchase_id INTO v_org_id, v_token_purchase_id
  FROM public.refund_requests
  WHERE id = p_refund_request_id;

  IF v_org_id IS NOT NULL THEN
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
        'success', true,
        'deduplicated', true,
        'event_id', v_existing_event,
        'refund_request_id', p_refund_request_id
      );
    END IF;
  END IF;

  -- 1. Refund decision (same transaction).
  v_rpc_result := public.approve_refund(
    p_refund_request_id => p_refund_request_id,
    p_admin_user_id     => p_admin_user_id,
    p_reason            => p_reason
  );

  IF v_rpc_result IS NULL
     OR COALESCE((v_rpc_result->>'success')::boolean, false) IS NOT TRUE THEN
    -- Return structured result (REFUND_NOT_FOUND / REFUND_ALREADY_DECIDED /
    -- REASON_REQUIRED) so the edge function can map to 4xx without rolling
    -- back the rest of the tx unnecessarily — but since nothing else was
    -- written yet, we just return.
    RETURN COALESCE(v_rpc_result, jsonb_build_object('success', false, 'code', 'REFUND_FAILED'));
  END IF;

  -- Re-read in case the row was just created by approve_refund (refund row
  -- did exist; org_id is stable). Refresh token_purchase_id if it was null.
  IF v_org_id IS NULL THEN
    SELECT org_id, token_purchase_id INTO v_org_id, v_token_purchase_id
    FROM public.refund_requests WHERE id = p_refund_request_id;
  END IF;

  -- 2. Governance payload.
  v_payload := jsonb_build_object(
    'source_function',  'admin-refund-approve',
    'request_id',       p_request_id,
    'correlation_id',   NULL,
    'idempotency_key',  v_idempotency_key,
    'previous_state',   'pending',
    'new_state',        'approved',
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
      'match_id', NULL,
      'poi_id',   NULL,
      'wad_id',   NULL,
      'engagement_id', NULL,
      'payment_reference', v_token_purchase_id,
      'credit_ledger_id', v_rpc_result->>'ledger_id'
    ),
    'match_id', NULL,
    'poi_id',   NULL,
    'metadata', jsonb_build_object(
      'action_code',      p_action_code,
      'reason',           p_reason,
      'aal',              p_aal,
      'policy_version',   p_policy_version,
      'refund_request_id', p_refund_request_id,
      'token_purchase_id', v_token_purchase_id,
      'ledger_id',         v_rpc_result->>'ledger_id'
    )
  );

  -- 3. Hash chain.
  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE org_id = v_org_id
    AND aggregate_type = 'refund_request'
    AND aggregate_id = p_refund_request_id
  ORDER BY occurred_at DESC
  LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash',      v_prev_hash,
    'org_id',         v_org_id,
    'aggregate_type', 'refund_request',
    'aggregate_id',   p_refund_request_id,
    'event_type',     'admin.hq_decision_recorded',
    'occurred_at',    to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload',        v_payload
  )::text;
  v_event_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  -- 4. Insert event. If this fails, approve_refund work above rolls back.
  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    occurred_at, actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    v_org_id, 'core', 'refund_request', p_refund_request_id, 'admin.hq_decision_recorded',
    v_occurred_at, p_admin_user_id, 'platform_admin', v_payload, v_prev_hash, v_event_hash
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success',           true,
    'deduplicated',      false,
    'event_id',          v_event_id,
    'refund_request_id', p_refund_request_id,
    'ledger_id',         v_rpc_result->>'ledger_id'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_refund_decline_with_governance(
  p_refund_request_id uuid,
  p_admin_user_id uuid,
  p_reason text,
  p_request_id text,
  p_aal text DEFAULT 'aal2',
  p_action_code text DEFAULT 'refund.decline',
  p_policy_version text DEFAULT 'admin-hq-decision/v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rpc_result jsonb;
  v_prev_hash text;
  v_occurred_at timestamptz := now();
  v_idempotency_key text;
  v_existing_event uuid;
  v_payload jsonb;
  v_event_hash text;
  v_event_id uuid;
  v_canonical text;
  v_org_id uuid;
  v_token_purchase_id uuid;
BEGIN
  IF p_refund_request_id IS NULL OR p_admin_user_id IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'admin_refund_decline_with_governance: invalid input'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := p_refund_request_id::text
    || '|admin.hq_decision_recorded|'
    || COALESCE(p_request_id, 'no-req')
    || '|' || p_action_code;

  SELECT org_id, token_purchase_id INTO v_org_id, v_token_purchase_id
  FROM public.refund_requests
  WHERE id = p_refund_request_id;

  IF v_org_id IS NOT NULL THEN
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
        'success', true,
        'deduplicated', true,
        'event_id', v_existing_event,
        'refund_request_id', p_refund_request_id
      );
    END IF;
  END IF;

  v_rpc_result := public.decline_refund(
    p_refund_request_id => p_refund_request_id,
    p_admin_user_id     => p_admin_user_id,
    p_reason            => p_reason
  );

  IF v_rpc_result IS NULL
     OR COALESCE((v_rpc_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN COALESCE(v_rpc_result, jsonb_build_object('success', false, 'code', 'REFUND_FAILED'));
  END IF;

  IF v_org_id IS NULL THEN
    SELECT org_id, token_purchase_id INTO v_org_id, v_token_purchase_id
    FROM public.refund_requests WHERE id = p_refund_request_id;
  END IF;

  v_payload := jsonb_build_object(
    'source_function',  'admin-refund-decline',
    'request_id',       p_request_id,
    'correlation_id',   NULL,
    'idempotency_key',  v_idempotency_key,
    'previous_state',   'pending',
    'new_state',        'declined',
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
      'match_id', NULL,
      'poi_id',   NULL,
      'wad_id',   NULL,
      'engagement_id', NULL,
      'payment_reference', v_token_purchase_id,
      'credit_ledger_id', NULL
    ),
    'match_id', NULL,
    'poi_id',   NULL,
    'metadata', jsonb_build_object(
      'action_code',      p_action_code,
      'reason',           p_reason,
      'aal',              p_aal,
      'policy_version',   p_policy_version,
      'refund_request_id', p_refund_request_id,
      'token_purchase_id', v_token_purchase_id
    )
  );

  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE org_id = v_org_id
    AND aggregate_type = 'refund_request'
    AND aggregate_id = p_refund_request_id
  ORDER BY occurred_at DESC
  LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash',      v_prev_hash,
    'org_id',         v_org_id,
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
    v_org_id, 'core', 'refund_request', p_refund_request_id, 'admin.hq_decision_recorded',
    v_occurred_at, p_admin_user_id, 'platform_admin', v_payload, v_prev_hash, v_event_hash
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success',           true,
    'deduplicated',      false,
    'event_id',          v_event_id,
    'refund_request_id', p_refund_request_id
  );
END;
$$;

-- SECDEF Stage D1 lockdown: service_role only.
REVOKE ALL ON FUNCTION public.admin_refund_approve_with_governance(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_refund_approve_with_governance(uuid, uuid, text, text, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refund_approve_with_governance(uuid, uuid, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_refund_decline_with_governance(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_refund_decline_with_governance(uuid, uuid, text, text, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refund_decline_with_governance(uuid, uuid, text, text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.admin_refund_approve_with_governance(uuid, uuid, text, text, text, text, text) IS
'Batch F2 atomic refund approve. Performs approve_refund + canonical event_store admin.hq_decision_recorded insert in one transaction. service_role only; called exclusively by edge function admin-refund-approve.';

COMMENT ON FUNCTION public.admin_refund_decline_with_governance(uuid, uuid, text, text, text, text, text) IS
'Batch F2 atomic refund decline. Performs decline_refund + canonical event_store admin.hq_decision_recorded insert in one transaction. service_role only; called exclusively by edge function admin-refund-decline.';
