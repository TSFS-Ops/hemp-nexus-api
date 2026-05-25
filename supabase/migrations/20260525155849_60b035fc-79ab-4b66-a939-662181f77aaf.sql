-- ============================================================
-- Batch F7 — atomic admin_manual_override wrapper.
-- Mirrors F1–F6: SECURITY DEFINER, service_role-only EXECUTE,
-- single-transaction audit + governance event emission.
--
-- Operations dispatched on p_operation:
--   - force_status        : calls safe_transition_match_state internally
--   - void_match          : calls safe_transition_match_state internally
--   - rerun_screening     : commits audit + gov only (external edge fn already ran)
--   - regenerate_evidence : commits audit + gov only (external edge fn already ran)
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_manual_override_with_governance(
  p_operation text,
  p_admin_user_id uuid,
  p_reason text,
  p_request_id text,
  p_params jsonb,
  p_before_snapshot jsonb DEFAULT NULL,
  p_after_snapshot  jsonb DEFAULT NULL,
  p_operation_result jsonb DEFAULT NULL,
  p_actor_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_aal text DEFAULT 'aal2',
  p_policy_version text DEFAULT 'admin-hq-decision/v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_match_id uuid;
  v_entity_id uuid;
  v_target_id uuid;
  v_target_type text;
  v_aggregate_type text;
  v_org_id uuid;
  v_action_code text;
  v_extra jsonb := '{}'::jsonb;
  v_before jsonb := p_before_snapshot;
  v_after  jsonb := p_after_snapshot;
  v_result jsonb := p_operation_result;
  v_expected_state text;
  v_new_state text;
  v_requested_status text;
  v_prev_hash text;
  v_occurred_at timestamptz := now();
  v_idempotency_key text;
  v_existing_event uuid;
  v_payload jsonb;
  v_event_hash text;
  v_event_id uuid;
  v_canonical text;
BEGIN
  IF p_admin_user_id IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) < 10
     OR p_operation IS NULL THEN
    RAISE EXCEPTION 'admin_manual_override_with_governance: invalid input'
      USING ERRCODE = '22023';
  END IF;

  -- Dispatch + target resolution
  IF p_operation IN ('force_status','void_match') THEN
    v_match_id := (p_params->>'match_id')::uuid;
    IF v_match_id IS NULL THEN
      RAISE EXCEPTION 'admin_manual_override_with_governance: missing match_id'
        USING ERRCODE = '22023';
    END IF;
    v_target_id      := v_match_id;
    v_target_type    := 'match';
    v_aggregate_type := 'match';

    IF p_operation = 'force_status' THEN
      v_requested_status := p_params->>'new_status';
      IF v_requested_status IS NULL
         OR v_requested_status NOT IN ('matched','settled','voided','disputed') THEN
        RAISE EXCEPTION 'admin_manual_override_with_governance: invalid new_status'
          USING ERRCODE = '22023';
      END IF;
      v_new_state   := v_requested_status;
      v_action_code := 'manual_override.force_status';
      v_extra := jsonb_build_object('requested_status', v_requested_status);
    ELSE
      v_new_state   := 'voided';
      v_action_code := 'manual_override.void_match';
    END IF;

    -- Capture before snapshot inside the transaction so the wrapper is
    -- self-contained even if the caller did not pre-load one.
    SELECT to_jsonb(m) INTO v_before
    FROM (
      SELECT id, state, status, org_id, counterparty_org_id, updated_at
      FROM public.matches WHERE id = v_match_id
    ) m;
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'admin_manual_override_with_governance: match not found'
        USING ERRCODE = 'P0002';
    END IF;
    v_org_id := (v_before->>'org_id')::uuid;
    v_expected_state := COALESCE(v_before->>'state', 'discovery');

  ELSIF p_operation = 'rerun_screening' THEN
    v_entity_id := (p_params->>'entity_id')::uuid;
    IF v_entity_id IS NULL THEN
      RAISE EXCEPTION 'admin_manual_override_with_governance: missing entity_id'
        USING ERRCODE = '22023';
    END IF;
    v_target_id      := v_entity_id;
    v_target_type    := 'entity';
    v_aggregate_type := 'entity';
    v_action_code    := 'manual_override.rerun_screening';
    SELECT org_id INTO v_org_id FROM public.entities WHERE id = v_entity_id;

  ELSIF p_operation = 'regenerate_evidence' THEN
    v_match_id := (p_params->>'match_id')::uuid;
    IF v_match_id IS NULL THEN
      RAISE EXCEPTION 'admin_manual_override_with_governance: missing match_id'
        USING ERRCODE = '22023';
    END IF;
    v_target_id      := v_match_id;
    v_target_type    := 'match';
    v_aggregate_type := 'match';
    v_action_code    := 'manual_override.regenerate_evidence';
    SELECT org_id INTO v_org_id FROM public.matches WHERE id = v_match_id;

  ELSE
    RAISE EXCEPTION 'admin_manual_override_with_governance: unknown operation %', p_operation
      USING ERRCODE = '22023';
  END IF;

  -- Idempotency check (5-minute window)
  v_idempotency_key := v_target_id::text
    || '|admin.hq_decision_recorded|'
    || COALESCE(p_request_id, 'no-req')
    || '|' || v_action_code;

  SELECT id INTO v_existing_event
  FROM public.event_store
  WHERE aggregate_id = v_target_id
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
      'target_id', v_target_id,
      'target_type', v_target_type
    );
  END IF;

  -- Business mutation (only force_status / void_match mutate state here;
  -- the external edge-function ops have already executed by the time the
  -- endpoint calls the wrapper).
  IF p_operation IN ('force_status','void_match') THEN
    v_result := public.safe_transition_match_state(
      p_match_id       => v_match_id,
      p_org_id         => v_org_id,
      p_expected_state => v_expected_state,
      p_new_state      => v_new_state,
      p_update_fields  => jsonb_build_object('status', v_new_state)
    );
    IF NOT COALESCE((v_result->>'success')::boolean, true) THEN
      RAISE EXCEPTION 'admin_manual_override_with_governance: transition rejected: %',
        COALESCE(v_result->>'message','rejected')
        USING ERRCODE = 'P0001';
    END IF;

    SELECT to_jsonb(m) INTO v_after
    FROM (
      SELECT id, state, status, org_id, counterparty_org_id, updated_at
      FROM public.matches WHERE id = v_match_id
    ) m;
  END IF;

  -- Server-authored admin_audit_logs row (same tx as gov event).
  INSERT INTO public.admin_audit_logs (
    admin_user_id, action, target_type, target_id, details, user_agent
  ) VALUES (
    p_admin_user_id,
    'admin.manual_override.' || p_operation,
    v_target_type,
    v_target_id,
    jsonb_build_object(
      'operation',   p_operation,
      'reason',      p_reason,
      'before',      v_before,
      'after',       v_after,
      'actor_ip',    p_actor_ip,
      'request_id',  p_request_id,
      'source',      'admin-manual-overrides',
      'operation_result', v_result
    ) || v_extra,
    p_user_agent
  );

  -- Canonical governance payload
  v_payload := jsonb_build_object(
    'source_function',   'admin-manual-overrides',
    'request_id',        p_request_id,
    'correlation_id',    NULL,
    'idempotency_key',   v_idempotency_key,
    'previous_state',    'manual_override_pre',
    'new_state',         'manual_override_post',
    'allowed_or_blocked','allowed',
    'reason',            v_action_code,
    'reason_code',       v_action_code,
    'posture',           'Standard',
    'posture_snapshot',  jsonb_build_object(
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
    'policy_version',    p_policy_version,
    'actor_role',        'platform_admin',
    'actor_org_id',      NULL,
    'system_actor',      NULL,
    'links',             jsonb_build_object(
      'match_id', v_match_id, 'poi_id', NULL, 'wad_id', NULL,
      'engagement_id', NULL, 'payment_reference', NULL,
      'credit_ledger_id', NULL,
      'entity_id', v_entity_id
    ),
    'match_id', v_match_id,
    'poi_id',   NULL,
    'metadata', jsonb_build_object(
      'action_code',    v_action_code,
      'operation',      p_operation,
      'reason',         p_reason,
      'aal',            p_aal,
      'policy_version', p_policy_version,
      'target_type',    v_target_type,
      'target_id',      v_target_id,
      'org_id',         v_org_id
    ) || v_extra
  );

  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE aggregate_type = v_aggregate_type
    AND aggregate_id = v_target_id
  ORDER BY occurred_at DESC
  LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash', v_prev_hash,
    'org_id', v_org_id,
    'aggregate_type', v_aggregate_type,
    'aggregate_id', v_target_id,
    'event_type', 'admin.hq_decision_recorded',
    'occurred_at', to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload', v_payload
  )::text;
  v_event_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    occurred_at, actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    v_org_id, 'core', v_aggregate_type, v_target_id, 'admin.hq_decision_recorded',
    v_occurred_at, p_admin_user_id, 'platform_admin', v_payload, v_prev_hash, v_event_hash
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'deduplicated', false,
    'event_id', v_event_id,
    'target_id', v_target_id,
    'target_type', v_target_type,
    'result', v_result,
    'before', v_before,
    'after',  v_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_manual_override_with_governance(
  text, uuid, text, text, jsonb, jsonb, jsonb, jsonb, text, text, text, text
) FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION public.admin_manual_override_with_governance(
  text, uuid, text, text, jsonb, jsonb, jsonb, jsonb, text, text, text, text
) TO service_role;