
-- ============================================================
-- Batch F4 — atomic billing / compliance / residency hold wrappers.
-- Each function performs the existing business mutation + canonical
-- admin.hq_decision_recorded event_store insert in one transaction.
-- Mirrors F1/F2/F3 pattern. SECURITY DEFINER, service_role-only EXECUTE.
-- ============================================================

-- ---------- 1. admin_billing_hold_apply_with_governance ----------
CREATE OR REPLACE FUNCTION public.admin_billing_hold_apply_with_governance(
  p_org_id uuid,
  p_admin_user_id uuid,
  p_reason text,
  p_request_id text,
  p_aal text DEFAULT 'aal2',
  p_action_code text DEFAULT 'billing_hold.apply',
  p_policy_version text DEFAULT 'admin-hq-decision/v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
BEGIN
  IF p_org_id IS NULL OR p_admin_user_id IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'admin_billing_hold_apply_with_governance: invalid input'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := p_org_id::text
    || '|admin.hq_decision_recorded|'
    || COALESCE(p_request_id, 'no-req')
    || '|' || p_action_code;

  SELECT id INTO v_existing_event
  FROM public.event_store
  WHERE aggregate_id = p_org_id
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
      'org_id', p_org_id
    );
  END IF;

  v_rpc_result := public.apply_billing_hold(
    p_org_id => p_org_id,
    p_admin_user_id => p_admin_user_id,
    p_reason => p_reason
  );

  IF v_rpc_result IS NULL
     OR COALESCE((v_rpc_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN COALESCE(v_rpc_result, jsonb_build_object('success', false, 'code', 'BILLING_HOLD_APPLY_FAILED'));
  END IF;

  v_payload := jsonb_build_object(
    'source_function',   'admin-billing-hold-apply',
    'request_id',        p_request_id,
    'correlation_id',    NULL,
    'idempotency_key',   v_idempotency_key,
    'previous_state',    'no_hold',
    'new_state',         'on_hold',
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
      'credit_ledger_id', NULL
    ),
    'match_id', NULL,
    'poi_id',   NULL,
    'metadata', jsonb_build_object(
      'action_code',    p_action_code,
      'reason',         p_reason,
      'aal',            p_aal,
      'policy_version', p_policy_version,
      'org_id',         p_org_id
    )
  );

  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE org_id = p_org_id
    AND aggregate_type = 'billing_hold'
    AND aggregate_id = p_org_id
  ORDER BY occurred_at DESC
  LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash', v_prev_hash,
    'org_id', p_org_id,
    'aggregate_type', 'billing_hold',
    'aggregate_id', p_org_id,
    'event_type', 'admin.hq_decision_recorded',
    'occurred_at', to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload', v_payload
  )::text;
  v_event_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    occurred_at, actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    p_org_id, 'core', 'billing_hold', p_org_id, 'admin.hq_decision_recorded',
    v_occurred_at, p_admin_user_id, 'platform_admin', v_payload, v_prev_hash, v_event_hash
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'deduplicated', false,
    'event_id', v_event_id,
    'org_id', p_org_id
  );
END;
$$;

-- ---------- 2. admin_billing_hold_release_with_governance ----------
CREATE OR REPLACE FUNCTION public.admin_billing_hold_release_with_governance(
  p_org_id uuid,
  p_admin_user_id uuid,
  p_reason text,
  p_request_id text,
  p_aal text DEFAULT 'aal2',
  p_action_code text DEFAULT 'billing_hold.release',
  p_policy_version text DEFAULT 'admin-hq-decision/v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
BEGIN
  IF p_org_id IS NULL OR p_admin_user_id IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'admin_billing_hold_release_with_governance: invalid input'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := p_org_id::text
    || '|admin.hq_decision_recorded|'
    || COALESCE(p_request_id, 'no-req')
    || '|' || p_action_code;

  SELECT id INTO v_existing_event
  FROM public.event_store
  WHERE aggregate_id = p_org_id
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
      'org_id', p_org_id
    );
  END IF;

  v_rpc_result := public.release_billing_hold(
    p_org_id => p_org_id,
    p_admin_user_id => p_admin_user_id,
    p_reason => p_reason
  );

  IF v_rpc_result IS NULL
     OR COALESCE((v_rpc_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN COALESCE(v_rpc_result, jsonb_build_object('success', false, 'code', 'BILLING_HOLD_RELEASE_FAILED'));
  END IF;

  v_payload := jsonb_build_object(
    'source_function',   'admin-billing-hold-release',
    'request_id',        p_request_id,
    'correlation_id',    NULL,
    'idempotency_key',   v_idempotency_key,
    'previous_state',    'on_hold',
    'new_state',         'released',
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
      'credit_ledger_id', NULL
    ),
    'match_id', NULL,
    'poi_id',   NULL,
    'metadata', jsonb_build_object(
      'action_code',    p_action_code,
      'reason',         p_reason,
      'aal',            p_aal,
      'policy_version', p_policy_version,
      'org_id',         p_org_id
    )
  );

  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE org_id = p_org_id
    AND aggregate_type = 'billing_hold'
    AND aggregate_id = p_org_id
  ORDER BY occurred_at DESC
  LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash', v_prev_hash,
    'org_id', p_org_id,
    'aggregate_type', 'billing_hold',
    'aggregate_id', p_org_id,
    'event_type', 'admin.hq_decision_recorded',
    'occurred_at', to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload', v_payload
  )::text;
  v_event_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    occurred_at, actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    p_org_id, 'core', 'billing_hold', p_org_id, 'admin.hq_decision_recorded',
    v_occurred_at, p_admin_user_id, 'platform_admin', v_payload, v_prev_hash, v_event_hash
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'deduplicated', false,
    'event_id', v_event_id,
    'org_id', p_org_id
  );
END;
$$;

-- ---------- 3. admin_compliance_hold_release_with_governance ----------
-- Wraps existing direct-table flow (compliance_holds update + linked OVR
-- closure + canonical audit_logs row) into one transaction with the
-- Governance Record event_store insert.
CREATE OR REPLACE FUNCTION public.admin_compliance_hold_release_with_governance(
  p_hold_id uuid,
  p_admin_user_id uuid,
  p_reason text,
  p_request_id text,
  p_aal text DEFAULT 'aal2',
  p_action_code text DEFAULT 'compliance_hold.release',
  p_policy_version text DEFAULT 'admin-hq-decision/v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hold RECORD;
  v_audit_action text;
  v_prev_hash text;
  v_occurred_at timestamptz := now();
  v_idempotency_key text;
  v_existing_event uuid;
  v_payload jsonb;
  v_event_hash text;
  v_event_id uuid;
  v_canonical text;
  v_is_sanctions boolean;
  v_updated int;
BEGIN
  IF p_hold_id IS NULL OR p_admin_user_id IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'admin_compliance_hold_release_with_governance: invalid input'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := p_hold_id::text
    || '|admin.hq_decision_recorded|'
    || COALESCE(p_request_id, 'no-req')
    || '|' || p_action_code;

  SELECT id, org_id, entity_id, hold_type, status
    INTO v_hold
  FROM public.compliance_holds
  WHERE id = p_hold_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND');
  END IF;

  SELECT id INTO v_existing_event
  FROM public.event_store
  WHERE aggregate_id = p_hold_id
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
      'hold_id', p_hold_id,
      'status', 'released'
    );
  END IF;

  IF v_hold.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'code', 'HOLD_NOT_ACTIVE');
  END IF;

  v_is_sanctions := (v_hold.hold_type LIKE 'sanctions_%'
                     OR v_hold.hold_type LIKE 'compliance_hold_sanctions_%');

  UPDATE public.compliance_holds
     SET status = 'released',
         released_at = v_occurred_at,
         released_by = p_admin_user_id,
         release_reason = p_reason
   WHERE id = p_hold_id
     AND status = 'active';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'HOLD_NOT_ACTIVE');
  END IF;

  -- Close linked verification queue items (legacy audit visibility).
  UPDATE public.operator_verification_requests
     SET status = 'completed',
         outcome = 'verified',
         reviewer_notes = 'Released by platform admin: ' || p_reason,
         completed_at = v_occurred_at,
         assigned_to = p_admin_user_id
   WHERE compliance_hold_id = p_hold_id
     AND status IN ('pending', 'in_progress');

  v_audit_action := CASE WHEN v_is_sanctions
                         THEN 'compliance.sanctions_hold_released'
                         ELSE 'compliance.verification_hold_released' END;

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
  VALUES (
    v_hold.org_id, 'compliance_hold', p_hold_id, v_audit_action,
    jsonb_build_object(
      'hold_type', v_hold.hold_type,
      'released_by', p_admin_user_id,
      'reason', p_reason,
      'source_function', 'admin-compliance-hold-release',
      'timestamp', v_occurred_at
    )
  );

  v_payload := jsonb_build_object(
    'source_function',   'admin-compliance-hold-release',
    'request_id',        p_request_id,
    'correlation_id',    NULL,
    'idempotency_key',   v_idempotency_key,
    'previous_state',    'active',
    'new_state',         'released',
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
      'credit_ledger_id', NULL
    ),
    'match_id', NULL,
    'poi_id',   NULL,
    'metadata', jsonb_build_object(
      'action_code',    p_action_code,
      'reason',         p_reason,
      'aal',            p_aal,
      'policy_version', p_policy_version,
      'hold_id',        p_hold_id,
      'hold_type',      v_hold.hold_type,
      'entity_id',      v_hold.entity_id
    )
  );

  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE org_id = v_hold.org_id
    AND aggregate_type = 'compliance_hold'
    AND aggregate_id = p_hold_id
  ORDER BY occurred_at DESC
  LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash', v_prev_hash,
    'org_id', v_hold.org_id,
    'aggregate_type', 'compliance_hold',
    'aggregate_id', p_hold_id,
    'event_type', 'admin.hq_decision_recorded',
    'occurred_at', to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload', v_payload
  )::text;
  v_event_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    occurred_at, actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    v_hold.org_id, 'core', 'compliance_hold', p_hold_id, 'admin.hq_decision_recorded',
    v_occurred_at, p_admin_user_id, 'platform_admin', v_payload, v_prev_hash, v_event_hash
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'deduplicated', false,
    'event_id', v_event_id,
    'hold_id', p_hold_id,
    'status', 'released'
  );
END;
$$;

-- ---------- 4. admin_compliance_hold_close_with_governance ----------
CREATE OR REPLACE FUNCTION public.admin_compliance_hold_close_with_governance(
  p_hold_id uuid,
  p_admin_user_id uuid,
  p_reason text,
  p_request_id text,
  p_aal text DEFAULT 'aal2',
  p_action_code text DEFAULT 'compliance_hold.close',
  p_policy_version text DEFAULT 'admin-hq-decision/v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hold RECORD;
  v_audit_action text;
  v_prev_hash text;
  v_occurred_at timestamptz := now();
  v_idempotency_key text;
  v_existing_event uuid;
  v_payload jsonb;
  v_event_hash text;
  v_event_id uuid;
  v_canonical text;
  v_is_sanctions boolean;
  v_prev_status text;
BEGIN
  IF p_hold_id IS NULL OR p_admin_user_id IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'admin_compliance_hold_close_with_governance: invalid input'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := p_hold_id::text
    || '|admin.hq_decision_recorded|'
    || COALESCE(p_request_id, 'no-req')
    || '|' || p_action_code;

  SELECT id, org_id, entity_id, hold_type, status, released_at
    INTO v_hold
  FROM public.compliance_holds
  WHERE id = p_hold_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND');
  END IF;

  SELECT id INTO v_existing_event
  FROM public.event_store
  WHERE aggregate_id = p_hold_id
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
      'hold_id', p_hold_id,
      'status', 'closed'
    );
  END IF;

  IF v_hold.status = 'closed' THEN
    RETURN jsonb_build_object('success', false, 'code', 'ALREADY_CLOSED');
  END IF;

  v_prev_status := v_hold.status;
  v_is_sanctions := (v_hold.hold_type LIKE 'sanctions_%'
                     OR v_hold.hold_type LIKE 'compliance_hold_sanctions_%');

  IF v_hold.released_at IS NULL THEN
    UPDATE public.compliance_holds
       SET status = 'closed',
           release_reason = p_reason,
           released_at = v_occurred_at,
           released_by = p_admin_user_id
     WHERE id = p_hold_id;
  ELSE
    UPDATE public.compliance_holds
       SET status = 'closed',
           release_reason = p_reason
     WHERE id = p_hold_id;
  END IF;

  UPDATE public.operator_verification_requests
     SET status = 'cancelled',
         reviewer_notes = 'Closed by platform admin: ' || p_reason,
         completed_at = v_occurred_at,
         assigned_to = p_admin_user_id
   WHERE compliance_hold_id = p_hold_id
     AND status IN ('pending', 'in_progress');

  v_audit_action := CASE WHEN v_is_sanctions
                         THEN 'compliance.sanctions_hold_closed'
                         ELSE 'compliance.verification_hold_closed' END;

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
  VALUES (
    v_hold.org_id, 'compliance_hold', p_hold_id, v_audit_action,
    jsonb_build_object(
      'hold_type', v_hold.hold_type,
      'closed_by', p_admin_user_id,
      'reason', p_reason,
      'source_function', 'admin-compliance-hold-close',
      'timestamp', v_occurred_at
    )
  );

  v_payload := jsonb_build_object(
    'source_function',   'admin-compliance-hold-close',
    'request_id',        p_request_id,
    'correlation_id',    NULL,
    'idempotency_key',   v_idempotency_key,
    'previous_state',    v_prev_status,
    'new_state',         'closed',
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
      'credit_ledger_id', NULL
    ),
    'match_id', NULL,
    'poi_id',   NULL,
    'metadata', jsonb_build_object(
      'action_code',    p_action_code,
      'reason',         p_reason,
      'aal',            p_aal,
      'policy_version', p_policy_version,
      'hold_id',        p_hold_id,
      'hold_type',      v_hold.hold_type,
      'entity_id',      v_hold.entity_id,
      'previous_status', v_prev_status
    )
  );

  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE org_id = v_hold.org_id
    AND aggregate_type = 'compliance_hold'
    AND aggregate_id = p_hold_id
  ORDER BY occurred_at DESC
  LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash', v_prev_hash,
    'org_id', v_hold.org_id,
    'aggregate_type', 'compliance_hold',
    'aggregate_id', p_hold_id,
    'event_type', 'admin.hq_decision_recorded',
    'occurred_at', to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload', v_payload
  )::text;
  v_event_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    occurred_at, actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    v_hold.org_id, 'core', 'compliance_hold', p_hold_id, 'admin.hq_decision_recorded',
    v_occurred_at, p_admin_user_id, 'platform_admin', v_payload, v_prev_hash, v_event_hash
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'deduplicated', false,
    'event_id', v_event_id,
    'hold_id', p_hold_id,
    'status', 'closed'
  );
END;
$$;

-- ---------- 5. admin_residency_review_approve_with_governance ----------
CREATE OR REPLACE FUNCTION public.admin_residency_review_approve_with_governance(
  p_review_id uuid,
  p_admin_user_id uuid,
  p_reason text,
  p_request_id text,
  p_aal text DEFAULT 'aal2',
  p_action_code text DEFAULT 'residency_review.approve',
  p_policy_version text DEFAULT 'admin-hq-decision/v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_rpc_result jsonb;
  v_review RECORD;
  v_prev_hash text;
  v_occurred_at timestamptz := now();
  v_idempotency_key text;
  v_existing_event uuid;
  v_payload jsonb;
  v_event_hash text;
  v_event_id uuid;
  v_canonical text;
BEGIN
  IF p_review_id IS NULL OR p_admin_user_id IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'admin_residency_review_approve_with_governance: invalid input'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := p_review_id::text
    || '|admin.hq_decision_recorded|'
    || COALESCE(p_request_id, 'no-req')
    || '|' || p_action_code;

  SELECT id, org_id, requested_region, requested_country
    INTO v_review
  FROM public.data_residency_reviews
  WHERE id = p_review_id;

  IF v_review.org_id IS NOT NULL THEN
    SELECT id INTO v_existing_event
    FROM public.event_store
    WHERE aggregate_id = p_review_id
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
        'review_id', p_review_id,
        'status', 'approved'
      );
    END IF;
  END IF;

  -- Underlying RPC raises on not-found / already-decided / not-admin /
  -- short-reason. Those bubble up and roll back the wrapper tx.
  v_rpc_result := public.approve_residency_review(
    p_review_id => p_review_id,
    p_admin_user_id => p_admin_user_id,
    p_reason => p_reason
  );

  -- Re-read in case it was just created.
  IF v_review.org_id IS NULL THEN
    SELECT id, org_id, requested_region, requested_country
      INTO v_review
    FROM public.data_residency_reviews
    WHERE id = p_review_id;
  END IF;

  v_payload := jsonb_build_object(
    'source_function',   'admin-residency-review-approve',
    'request_id',        p_request_id,
    'correlation_id',    NULL,
    'idempotency_key',   v_idempotency_key,
    'previous_state',    'review_required',
    'new_state',         'approved',
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
      'credit_ledger_id', NULL
    ),
    'match_id', NULL,
    'poi_id',   NULL,
    'metadata', jsonb_build_object(
      'action_code',       p_action_code,
      'reason',            p_reason,
      'aal',               p_aal,
      'policy_version',    p_policy_version,
      'review_id',         p_review_id,
      'requested_region',  v_review.requested_region,
      'requested_country', v_review.requested_country
    )
  );

  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE org_id = v_review.org_id
    AND aggregate_type = 'data_residency_review'
    AND aggregate_id = p_review_id
  ORDER BY occurred_at DESC
  LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash', v_prev_hash,
    'org_id', v_review.org_id,
    'aggregate_type', 'data_residency_review',
    'aggregate_id', p_review_id,
    'event_type', 'admin.hq_decision_recorded',
    'occurred_at', to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload', v_payload
  )::text;
  v_event_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    occurred_at, actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    v_review.org_id, 'core', 'data_residency_review', p_review_id, 'admin.hq_decision_recorded',
    v_occurred_at, p_admin_user_id, 'platform_admin', v_payload, v_prev_hash, v_event_hash
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'deduplicated', false,
    'event_id', v_event_id,
    'review_id', p_review_id,
    'status', 'approved',
    'rpc_result', v_rpc_result
  );
END;
$$;

-- ---------- 6. admin_residency_review_decline_with_governance ----------
CREATE OR REPLACE FUNCTION public.admin_residency_review_decline_with_governance(
  p_review_id uuid,
  p_admin_user_id uuid,
  p_reason text,
  p_request_id text,
  p_aal text DEFAULT 'aal2',
  p_action_code text DEFAULT 'residency_review.decline',
  p_policy_version text DEFAULT 'admin-hq-decision/v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_rpc_result jsonb;
  v_review RECORD;
  v_prev_hash text;
  v_occurred_at timestamptz := now();
  v_idempotency_key text;
  v_existing_event uuid;
  v_payload jsonb;
  v_event_hash text;
  v_event_id uuid;
  v_canonical text;
BEGIN
  IF p_review_id IS NULL OR p_admin_user_id IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'admin_residency_review_decline_with_governance: invalid input'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := p_review_id::text
    || '|admin.hq_decision_recorded|'
    || COALESCE(p_request_id, 'no-req')
    || '|' || p_action_code;

  SELECT id, org_id, requested_region, requested_country
    INTO v_review
  FROM public.data_residency_reviews
  WHERE id = p_review_id;

  IF v_review.org_id IS NOT NULL THEN
    SELECT id INTO v_existing_event
    FROM public.event_store
    WHERE aggregate_id = p_review_id
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
        'review_id', p_review_id,
        'status', 'declined'
      );
    END IF;
  END IF;

  v_rpc_result := public.decline_residency_review(
    p_review_id => p_review_id,
    p_admin_user_id => p_admin_user_id,
    p_reason => p_reason
  );

  IF v_review.org_id IS NULL THEN
    SELECT id, org_id, requested_region, requested_country
      INTO v_review
    FROM public.data_residency_reviews
    WHERE id = p_review_id;
  END IF;

  v_payload := jsonb_build_object(
    'source_function',   'admin-residency-review-decline',
    'request_id',        p_request_id,
    'correlation_id',    NULL,
    'idempotency_key',   v_idempotency_key,
    'previous_state',    'review_required',
    'new_state',         'declined',
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
      'credit_ledger_id', NULL
    ),
    'match_id', NULL,
    'poi_id',   NULL,
    'metadata', jsonb_build_object(
      'action_code',       p_action_code,
      'reason',            p_reason,
      'aal',               p_aal,
      'policy_version',    p_policy_version,
      'review_id',         p_review_id,
      'requested_region',  v_review.requested_region,
      'requested_country', v_review.requested_country,
      'onboarding_hold_retained', true
    )
  );

  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE org_id = v_review.org_id
    AND aggregate_type = 'data_residency_review'
    AND aggregate_id = p_review_id
  ORDER BY occurred_at DESC
  LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash', v_prev_hash,
    'org_id', v_review.org_id,
    'aggregate_type', 'data_residency_review',
    'aggregate_id', p_review_id,
    'event_type', 'admin.hq_decision_recorded',
    'occurred_at', to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload', v_payload
  )::text;
  v_event_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    occurred_at, actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    v_review.org_id, 'core', 'data_residency_review', p_review_id, 'admin.hq_decision_recorded',
    v_occurred_at, p_admin_user_id, 'platform_admin', v_payload, v_prev_hash, v_event_hash
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'deduplicated', false,
    'event_id', v_event_id,
    'review_id', p_review_id,
    'status', 'declined',
    'rpc_result', v_rpc_result
  );
END;
$$;

-- ============================================================
-- SECDEF Stage D1 lockdown — service_role only.
-- ============================================================
REVOKE ALL ON FUNCTION public.admin_billing_hold_apply_with_governance(uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_billing_hold_apply_with_governance(uuid, uuid, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_billing_hold_release_with_governance(uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_billing_hold_release_with_governance(uuid, uuid, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_compliance_hold_release_with_governance(uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_compliance_hold_release_with_governance(uuid, uuid, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_compliance_hold_close_with_governance(uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_compliance_hold_close_with_governance(uuid, uuid, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_residency_review_approve_with_governance(uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_residency_review_approve_with_governance(uuid, uuid, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_residency_review_decline_with_governance(uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_residency_review_decline_with_governance(uuid, uuid, text, text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.admin_billing_hold_apply_with_governance(uuid, uuid, text, text, text, text, text)        IS 'Batch F4 atomic: apply_billing_hold + canonical admin.hq_decision_recorded in one tx. service_role only.';
COMMENT ON FUNCTION public.admin_billing_hold_release_with_governance(uuid, uuid, text, text, text, text, text)      IS 'Batch F4 atomic: release_billing_hold + canonical admin.hq_decision_recorded in one tx. service_role only.';
COMMENT ON FUNCTION public.admin_compliance_hold_release_with_governance(uuid, uuid, text, text, text, text, text)   IS 'Batch F4 atomic: compliance_holds release + linked OVR closure + canonical event in one tx. service_role only.';
COMMENT ON FUNCTION public.admin_compliance_hold_close_with_governance(uuid, uuid, text, text, text, text, text)     IS 'Batch F4 atomic: compliance_holds close + linked OVR cancellation + canonical event in one tx. service_role only.';
COMMENT ON FUNCTION public.admin_residency_review_approve_with_governance(uuid, uuid, text, text, text, text, text)  IS 'Batch F4 atomic: approve_residency_review + canonical admin.hq_decision_recorded in one tx. service_role only.';
COMMENT ON FUNCTION public.admin_residency_review_decline_with_governance(uuid, uuid, text, text, text, text, text)  IS 'Batch F4 atomic: decline_residency_review + canonical admin.hq_decision_recorded in one tx. service_role only.';
