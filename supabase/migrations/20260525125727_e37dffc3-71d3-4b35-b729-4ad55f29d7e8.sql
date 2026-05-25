-- Batch F3: atomic payment-dispute record/resolve-won/resolve-lost +
-- canonical Governance Record event in one transaction.
-- Mirrors Batch F1/F2. Closes the gap where the underlying RPC committed
-- and recordAdminHqDecision could fail afterwards.

-- ── F3.1 record (manual admin entry) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_payment_dispute_record_with_governance(
  p_org_id uuid,
  p_token_purchase_id uuid,
  p_provider text,
  p_provider_dispute_reference text,
  p_credits_issued integer,
  p_admin_user_id uuid,
  p_reason text,
  p_request_id text,
  p_aal text DEFAULT 'aal2',
  p_action_code text DEFAULT 'payment_dispute.record_manual',
  p_policy_version text DEFAULT 'admin-hq-decision/v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_rpc_result jsonb;
  v_dispute_id uuid;
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
     OR p_provider_dispute_reference IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'admin_payment_dispute_record_with_governance: invalid input'
      USING ERRCODE = '22023';
  END IF;

  v_rpc_result := public.record_payment_dispute(
    p_org_id                      => p_org_id,
    p_token_purchase_id           => p_token_purchase_id,
    p_provider                    => COALESCE(p_provider, 'paystack'),
    p_provider_dispute_reference  => p_provider_dispute_reference,
    p_source                      => 'manual_admin',
    p_credits_issued              => COALESCE(p_credits_issued, 0),
    p_actor_user_id               => p_admin_user_id,
    p_metadata                    => jsonb_build_object('admin_reason', p_reason)
  );

  IF v_rpc_result IS NULL
     OR COALESCE((v_rpc_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN COALESCE(v_rpc_result, jsonb_build_object('success', false, 'code', 'DISPUTE_FAILED'));
  END IF;

  v_dispute_id := (v_rpc_result->>'payment_dispute_id')::uuid;
  IF v_dispute_id IS NULL THEN
    RAISE EXCEPTION 'admin_payment_dispute_record_with_governance: missing payment_dispute_id'
      USING ERRCODE = 'P0001';
  END IF;

  v_idempotency_key := v_dispute_id::text
    || '|admin.hq_decision_recorded|'
    || COALESCE(p_request_id, 'no-req')
    || '|' || p_action_code;

  SELECT id INTO v_existing_event
  FROM public.event_store
  WHERE aggregate_id = v_dispute_id
    AND event_type = 'admin.hq_decision_recorded'
    AND payload->>'idempotency_key' = v_idempotency_key
    AND occurred_at > (now() - interval '5 minutes')
  ORDER BY occurred_at DESC
  LIMIT 1;

  IF v_existing_event IS NOT NULL THEN
    RETURN v_rpc_result || jsonb_build_object(
      'deduplicated', true,
      'event_id', v_existing_event,
      'payment_dispute_id', v_dispute_id
    );
  END IF;

  v_payload := jsonb_build_object(
    'source_function',  'admin-payment-dispute-record',
    'request_id',       p_request_id,
    'correlation_id',   NULL,
    'idempotency_key',  v_idempotency_key,
    'previous_state',   NULL,
    'new_state',        'open',
    'allowed_or_blocked','allowed',
    'reason',           p_action_code,
    'reason_code',      p_action_code,
    'posture',          'Standard',
    'posture_snapshot', jsonb_build_object(
      'verification_posture', 'Standard',
      'policy_version', p_policy_version,
      'waiver_applied', false,
      'bypass_applied', false,
      'demo', false, 'test_mode', false,
      'evidence_level', NULL,
      'check_status_snapshot', jsonb_build_object('aal', p_aal),
      'stale_verification', false,
      'manual_review_required', false
    ),
    'policy_version', p_policy_version,
    'actor_role',     'platform_admin',
    'actor_org_id',   NULL,
    'system_actor',   NULL,
    'links', jsonb_build_object(
      'match_id', NULL, 'poi_id', NULL, 'wad_id', NULL,
      'engagement_id', NULL,
      'payment_reference', p_provider_dispute_reference,
      'credit_ledger_id', NULL
    ),
    'match_id', NULL, 'poi_id', NULL,
    'metadata', jsonb_build_object(
      'action_code', p_action_code,
      'reason', p_reason,
      'aal', p_aal,
      'policy_version', p_policy_version,
      'payment_dispute_id', v_dispute_id,
      'token_purchase_id', p_token_purchase_id,
      'provider', p_provider,
      'provider_dispute_reference', p_provider_dispute_reference,
      'credits_issued', p_credits_issued,
      'credits_used', (v_rpc_result->>'credits_used')::int,
      'credits_frozen', (v_rpc_result->>'credits_frozen')::int,
      'idempotent_dispute_record', COALESCE((v_rpc_result->>'idempotent')::boolean, false)
    )
  );

  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE org_id = p_org_id
    AND aggregate_type = 'payment_dispute'
    AND aggregate_id = v_dispute_id
  ORDER BY occurred_at DESC
  LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash', v_prev_hash,
    'org_id', p_org_id,
    'aggregate_type', 'payment_dispute',
    'aggregate_id', v_dispute_id,
    'event_type', 'admin.hq_decision_recorded',
    'occurred_at', to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload', v_payload
  )::text;
  v_event_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    occurred_at, actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    p_org_id, 'core', 'payment_dispute', v_dispute_id, 'admin.hq_decision_recorded',
    v_occurred_at, p_admin_user_id, 'platform_admin', v_payload, v_prev_hash, v_event_hash
  )
  RETURNING id INTO v_event_id;

  RETURN v_rpc_result || jsonb_build_object(
    'deduplicated', false,
    'event_id', v_event_id,
    'payment_dispute_id', v_dispute_id
  );
END;
$$;

-- ── F3.2 resolve-won ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_payment_dispute_resolve_won_with_governance(
  p_payment_dispute_id uuid,
  p_admin_user_id uuid,
  p_reason text,
  p_request_id text,
  p_aal text DEFAULT 'aal2',
  p_action_code text DEFAULT 'payment_dispute.resolve_won',
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
  v_org_id uuid;
  v_provider_ref text;
BEGIN
  IF p_payment_dispute_id IS NULL OR p_admin_user_id IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'admin_payment_dispute_resolve_won_with_governance: invalid input'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := p_payment_dispute_id::text
    || '|admin.hq_decision_recorded|'
    || COALESCE(p_request_id, 'no-req')
    || '|' || p_action_code;

  SELECT org_id, provider_dispute_reference INTO v_org_id, v_provider_ref
  FROM public.payment_disputes WHERE id = p_payment_dispute_id;

  IF v_org_id IS NOT NULL THEN
    SELECT id INTO v_existing_event
    FROM public.event_store
    WHERE aggregate_id = p_payment_dispute_id
      AND event_type = 'admin.hq_decision_recorded'
      AND payload->>'idempotency_key' = v_idempotency_key
      AND occurred_at > (now() - interval '5 minutes')
    ORDER BY occurred_at DESC LIMIT 1;
    IF v_existing_event IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true, 'deduplicated', true,
        'event_id', v_existing_event,
        'payment_dispute_id', p_payment_dispute_id
      );
    END IF;
  END IF;

  v_rpc_result := public.resolve_payment_dispute_won(
    p_payment_dispute_id => p_payment_dispute_id,
    p_admin_user_id      => p_admin_user_id,
    p_reason             => p_reason
  );

  IF v_rpc_result IS NULL
     OR COALESCE((v_rpc_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN COALESCE(v_rpc_result, jsonb_build_object('success', false, 'code', 'DISPUTE_FAILED'));
  END IF;

  IF v_org_id IS NULL THEN
    SELECT org_id, provider_dispute_reference INTO v_org_id, v_provider_ref
    FROM public.payment_disputes WHERE id = p_payment_dispute_id;
  END IF;

  v_payload := jsonb_build_object(
    'source_function',  'admin-payment-dispute-resolve-won',
    'request_id',       p_request_id,
    'correlation_id',   NULL,
    'idempotency_key',  v_idempotency_key,
    'previous_state',   'open',
    'new_state',        'won',
    'allowed_or_blocked','allowed',
    'reason',           p_action_code,
    'reason_code',      p_action_code,
    'posture',          'Standard',
    'posture_snapshot', jsonb_build_object(
      'verification_posture', 'Standard',
      'policy_version', p_policy_version,
      'waiver_applied', false, 'bypass_applied', false,
      'demo', false, 'test_mode', false,
      'evidence_level', NULL,
      'check_status_snapshot', jsonb_build_object('aal', p_aal),
      'stale_verification', false, 'manual_review_required', false
    ),
    'policy_version', p_policy_version,
    'actor_role', 'platform_admin',
    'actor_org_id', NULL, 'system_actor', NULL,
    'links', jsonb_build_object(
      'match_id', NULL, 'poi_id', NULL, 'wad_id', NULL,
      'engagement_id', NULL,
      'payment_reference', v_provider_ref,
      'credit_ledger_id', NULL
    ),
    'match_id', NULL, 'poi_id', NULL,
    'metadata', jsonb_build_object(
      'action_code', p_action_code,
      'reason', p_reason,
      'aal', p_aal,
      'policy_version', p_policy_version,
      'payment_dispute_id', p_payment_dispute_id,
      'provider_dispute_reference', v_provider_ref
    )
  );

  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE org_id = v_org_id
    AND aggregate_type = 'payment_dispute'
    AND aggregate_id = p_payment_dispute_id
  ORDER BY occurred_at DESC LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash', v_prev_hash,
    'org_id', v_org_id,
    'aggregate_type', 'payment_dispute',
    'aggregate_id', p_payment_dispute_id,
    'event_type', 'admin.hq_decision_recorded',
    'occurred_at', to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload', v_payload
  )::text;
  v_event_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    occurred_at, actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    v_org_id, 'core', 'payment_dispute', p_payment_dispute_id, 'admin.hq_decision_recorded',
    v_occurred_at, p_admin_user_id, 'platform_admin', v_payload, v_prev_hash, v_event_hash
  ) RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true, 'deduplicated', false,
    'event_id', v_event_id,
    'payment_dispute_id', p_payment_dispute_id
  );
END;
$$;

-- ── F3.3 resolve-lost ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_payment_dispute_resolve_lost_with_governance(
  p_payment_dispute_id uuid,
  p_admin_user_id uuid,
  p_reason text,
  p_request_id text,
  p_aal text DEFAULT 'aal2',
  p_action_code text DEFAULT 'payment_dispute.resolve_lost',
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
  v_org_id uuid;
  v_provider_ref text;
BEGIN
  IF p_payment_dispute_id IS NULL OR p_admin_user_id IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'admin_payment_dispute_resolve_lost_with_governance: invalid input'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := p_payment_dispute_id::text
    || '|admin.hq_decision_recorded|'
    || COALESCE(p_request_id, 'no-req')
    || '|' || p_action_code;

  SELECT org_id, provider_dispute_reference INTO v_org_id, v_provider_ref
  FROM public.payment_disputes WHERE id = p_payment_dispute_id;

  IF v_org_id IS NOT NULL THEN
    SELECT id INTO v_existing_event
    FROM public.event_store
    WHERE aggregate_id = p_payment_dispute_id
      AND event_type = 'admin.hq_decision_recorded'
      AND payload->>'idempotency_key' = v_idempotency_key
      AND occurred_at > (now() - interval '5 minutes')
    ORDER BY occurred_at DESC LIMIT 1;
    IF v_existing_event IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true, 'deduplicated', true,
        'event_id', v_existing_event,
        'payment_dispute_id', p_payment_dispute_id
      );
    END IF;
  END IF;

  v_rpc_result := public.resolve_payment_dispute_lost(
    p_payment_dispute_id => p_payment_dispute_id,
    p_admin_user_id      => p_admin_user_id,
    p_reason             => p_reason
  );

  IF v_rpc_result IS NULL
     OR COALESCE((v_rpc_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN COALESCE(v_rpc_result, jsonb_build_object('success', false, 'code', 'DISPUTE_FAILED'));
  END IF;

  IF v_org_id IS NULL THEN
    SELECT org_id, provider_dispute_reference INTO v_org_id, v_provider_ref
    FROM public.payment_disputes WHERE id = p_payment_dispute_id;
  END IF;

  v_payload := jsonb_build_object(
    'source_function',  'admin-payment-dispute-resolve-lost',
    'request_id',       p_request_id,
    'correlation_id',   NULL,
    'idempotency_key',  v_idempotency_key,
    'previous_state',   'open',
    'new_state',        'lost',
    'allowed_or_blocked','allowed',
    'reason',           p_action_code,
    'reason_code',      p_action_code,
    'posture',          'Standard',
    'posture_snapshot', jsonb_build_object(
      'verification_posture', 'Standard',
      'policy_version', p_policy_version,
      'waiver_applied', false, 'bypass_applied', false,
      'demo', false, 'test_mode', false,
      'evidence_level', NULL,
      'check_status_snapshot', jsonb_build_object('aal', p_aal),
      'stale_verification', false, 'manual_review_required', false
    ),
    'policy_version', p_policy_version,
    'actor_role', 'platform_admin',
    'actor_org_id', NULL, 'system_actor', NULL,
    'links', jsonb_build_object(
      'match_id', NULL, 'poi_id', NULL, 'wad_id', NULL,
      'engagement_id', NULL,
      'payment_reference', v_provider_ref,
      'credit_ledger_id', NULL
    ),
    'match_id', NULL, 'poi_id', NULL,
    'metadata', jsonb_build_object(
      'action_code', p_action_code,
      'reason', p_reason,
      'aal', p_aal,
      'policy_version', p_policy_version,
      'payment_dispute_id', p_payment_dispute_id,
      'provider_dispute_reference', v_provider_ref
    )
  );

  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE org_id = v_org_id
    AND aggregate_type = 'payment_dispute'
    AND aggregate_id = p_payment_dispute_id
  ORDER BY occurred_at DESC LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash', v_prev_hash,
    'org_id', v_org_id,
    'aggregate_type', 'payment_dispute',
    'aggregate_id', p_payment_dispute_id,
    'event_type', 'admin.hq_decision_recorded',
    'occurred_at', to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload', v_payload
  )::text;
  v_event_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    occurred_at, actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    v_org_id, 'core', 'payment_dispute', p_payment_dispute_id, 'admin.hq_decision_recorded',
    v_occurred_at, p_admin_user_id, 'platform_admin', v_payload, v_prev_hash, v_event_hash
  ) RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true, 'deduplicated', false,
    'event_id', v_event_id,
    'payment_dispute_id', p_payment_dispute_id
  );
END;
$$;

-- SECDEF Stage D1 lockdown: service_role only.
REVOKE ALL ON FUNCTION public.admin_payment_dispute_record_with_governance(uuid, uuid, text, text, integer, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_payment_dispute_record_with_governance(uuid, uuid, text, text, integer, uuid, text, text, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_payment_dispute_record_with_governance(uuid, uuid, text, text, integer, uuid, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_payment_dispute_resolve_won_with_governance(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_payment_dispute_resolve_won_with_governance(uuid, uuid, text, text, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_payment_dispute_resolve_won_with_governance(uuid, uuid, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_payment_dispute_resolve_lost_with_governance(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_payment_dispute_resolve_lost_with_governance(uuid, uuid, text, text, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_payment_dispute_resolve_lost_with_governance(uuid, uuid, text, text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.admin_payment_dispute_record_with_governance(uuid, uuid, text, text, integer, uuid, text, text, text, text, text) IS
'Batch F3 atomic payment-dispute record (manual admin). record_payment_dispute + canonical event_store admin.hq_decision_recorded insert in one transaction. service_role only; called exclusively by edge function admin-payment-dispute-record.';
COMMENT ON FUNCTION public.admin_payment_dispute_resolve_won_with_governance(uuid, uuid, text, text, text, text, text) IS
'Batch F3 atomic payment-dispute resolve-won. resolve_payment_dispute_won + canonical event_store admin.hq_decision_recorded insert in one transaction. service_role only; called exclusively by edge function admin-payment-dispute-resolve-won.';
COMMENT ON FUNCTION public.admin_payment_dispute_resolve_lost_with_governance(uuid, uuid, text, text, text, text, text) IS
'Batch F3 atomic payment-dispute resolve-lost. resolve_payment_dispute_lost + canonical event_store admin.hq_decision_recorded insert in one transaction. service_role only; called exclusively by edge function admin-payment-dispute-resolve-lost.';
