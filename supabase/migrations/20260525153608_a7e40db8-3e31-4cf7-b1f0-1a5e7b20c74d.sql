
-- ============================================================
-- Batch F5 — atomic trade-request exception wrappers.
-- Pattern mirrors F1/F2/F3/F4: business mutation + canonical
-- admin.hq_decision_recorded event in one transaction.
-- SECURITY DEFINER, service_role-only EXECUTE.
-- ============================================================

-- ---------- 1. admin_trade_request_archive_override_with_governance ----------
CREATE OR REPLACE FUNCTION public.admin_trade_request_archive_override_with_governance(
  p_trade_request_id uuid,
  p_admin_user_id uuid,
  p_reason text,
  p_request_id text,
  p_aal text DEFAULT 'aal2',
  p_action_code text DEFAULT 'trade_request.archive_override',
  p_policy_version text DEFAULT 'admin-hq-decision/v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_rpc_result jsonb;
  v_org_id uuid;
  v_prev_hash text;
  v_occurred_at timestamptz := now();
  v_idempotency_key text;
  v_existing_event uuid;
  v_payload jsonb;
  v_event_hash text;
  v_event_id uuid;
  v_canonical text;
BEGIN
  IF p_trade_request_id IS NULL OR p_admin_user_id IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'admin_trade_request_archive_override_with_governance: invalid input'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := p_trade_request_id::text
    || '|admin.hq_decision_recorded|'
    || COALESCE(p_request_id, 'no-req')
    || '|' || p_action_code;

  SELECT id INTO v_existing_event
  FROM public.event_store
  WHERE aggregate_id = p_trade_request_id
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
      'trade_request_id', p_trade_request_id
    );
  END IF;

  -- business mutation (raises on REASON_REQUIRED / ALREADY_ARCHIVED / NOT_FOUND)
  v_rpc_result := public.admin_archive_trade_request_override(
    p_trade_request_id => p_trade_request_id,
    p_admin_user_id    => p_admin_user_id,
    p_reason           => p_reason
  );

  SELECT org_id INTO v_org_id
  FROM public.trade_requests
  WHERE id = p_trade_request_id;

  v_payload := jsonb_build_object(
    'source_function',   'admin-trade-request-archive-override',
    'request_id',        p_request_id,
    'correlation_id',    NULL,
    'idempotency_key',   v_idempotency_key,
    'previous_state',    'active',
    'new_state',         'archived_admin_override_active_children',
    'allowed_or_blocked','allowed',
    'reason',            p_action_code,
    'reason_code',       p_action_code,
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
      'match_id', NULL, 'poi_id', NULL, 'wad_id', NULL,
      'engagement_id', NULL, 'payment_reference', NULL,
      'credit_ledger_id', NULL,
      'trade_request_id', p_trade_request_id
    ),
    'match_id', NULL,
    'poi_id',   NULL,
    'metadata', jsonb_build_object(
      'action_code',      p_action_code,
      'reason',           p_reason,
      'aal',              p_aal,
      'policy_version',   p_policy_version,
      'trade_request_id', p_trade_request_id,
      'org_id',           v_org_id,
      'rpc_result',       v_rpc_result
    )
  );

  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE aggregate_type = 'trade_request'
    AND aggregate_id = p_trade_request_id
  ORDER BY occurred_at DESC
  LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash', v_prev_hash,
    'org_id', v_org_id,
    'aggregate_type', 'trade_request',
    'aggregate_id', p_trade_request_id,
    'event_type', 'admin.hq_decision_recorded',
    'occurred_at', to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload', v_payload
  )::text;
  v_event_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    occurred_at, actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    v_org_id, 'core', 'trade_request', p_trade_request_id, 'admin.hq_decision_recorded',
    v_occurred_at, p_admin_user_id, 'platform_admin', v_payload, v_prev_hash, v_event_hash
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'deduplicated', false,
    'event_id', v_event_id,
    'trade_request_id', p_trade_request_id,
    'result', v_rpc_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_trade_request_archive_override_with_governance(uuid,uuid,text,text,text,text,text)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_trade_request_archive_override_with_governance(uuid,uuid,text,text,text,text,text)
  TO service_role;

-- ---------- 2. admin_trade_request_exception_hold_release_with_governance ----------
CREATE OR REPLACE FUNCTION public.admin_trade_request_exception_hold_release_with_governance(
  p_trade_request_id uuid,
  p_admin_user_id uuid,
  p_reason text,
  p_request_id text,
  p_aal text DEFAULT 'aal2',
  p_action_code text DEFAULT 'trade_request_exception.release',
  p_policy_version text DEFAULT 'admin-hq-decision/v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_rpc_result jsonb;
  v_org_id uuid;
  v_prev_hash text;
  v_occurred_at timestamptz := now();
  v_idempotency_key text;
  v_existing_event uuid;
  v_payload jsonb;
  v_event_hash text;
  v_event_id uuid;
  v_canonical text;
BEGIN
  IF p_trade_request_id IS NULL OR p_admin_user_id IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'admin_trade_request_exception_hold_release_with_governance: invalid input'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := p_trade_request_id::text
    || '|admin.hq_decision_recorded|'
    || COALESCE(p_request_id, 'no-req')
    || '|' || p_action_code;

  SELECT id INTO v_existing_event
  FROM public.event_store
  WHERE aggregate_id = p_trade_request_id
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
      'trade_request_id', p_trade_request_id
    );
  END IF;

  -- business mutation (raises on REASON_REQUIRED / NO_EXCEPTION_HOLD / NOT_FOUND)
  v_rpc_result := public.admin_release_trade_request_exception_hold(
    p_trade_request_id => p_trade_request_id,
    p_admin_user_id    => p_admin_user_id,
    p_reason           => p_reason
  );

  SELECT org_id INTO v_org_id
  FROM public.trade_requests
  WHERE id = p_trade_request_id;

  v_payload := jsonb_build_object(
    'source_function',   'admin-trade-request-exception-hold-release',
    'request_id',        p_request_id,
    'correlation_id',    NULL,
    'idempotency_key',   v_idempotency_key,
    'previous_state',    'exception_hold_active',
    'new_state',         'exception_hold_released',
    'allowed_or_blocked','allowed',
    'reason',            p_action_code,
    'reason_code',       p_action_code,
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
      'match_id', NULL, 'poi_id', NULL, 'wad_id', NULL,
      'engagement_id', NULL, 'payment_reference', NULL,
      'credit_ledger_id', NULL,
      'trade_request_id', p_trade_request_id
    ),
    'match_id', NULL,
    'poi_id',   NULL,
    'metadata', jsonb_build_object(
      'action_code',      p_action_code,
      'reason',           p_reason,
      'aal',              p_aal,
      'policy_version',   p_policy_version,
      'trade_request_id', p_trade_request_id,
      'org_id',           v_org_id,
      'rpc_result',       v_rpc_result
    )
  );

  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE aggregate_type = 'trade_request'
    AND aggregate_id = p_trade_request_id
  ORDER BY occurred_at DESC
  LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash', v_prev_hash,
    'org_id', v_org_id,
    'aggregate_type', 'trade_request',
    'aggregate_id', p_trade_request_id,
    'event_type', 'admin.hq_decision_recorded',
    'occurred_at', to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload', v_payload
  )::text;
  v_event_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    occurred_at, actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    v_org_id, 'core', 'trade_request', p_trade_request_id, 'admin.hq_decision_recorded',
    v_occurred_at, p_admin_user_id, 'platform_admin', v_payload, v_prev_hash, v_event_hash
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'deduplicated', false,
    'event_id', v_event_id,
    'trade_request_id', p_trade_request_id,
    'result', v_rpc_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_trade_request_exception_hold_release_with_governance(uuid,uuid,text,text,text,text,text)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_trade_request_exception_hold_release_with_governance(uuid,uuid,text,text,text,text,text)
  TO service_role;
