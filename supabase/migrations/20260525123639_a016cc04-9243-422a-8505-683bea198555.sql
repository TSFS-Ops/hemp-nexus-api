-- Batch F1 follow-up: pgcrypto's digest() lives in the extensions schema on
-- Supabase. Our function has SET search_path = public, so we must qualify it.
CREATE OR REPLACE FUNCTION public.admin_credit_org_with_governance(
  p_org_id uuid,
  p_amount integer,
  p_reason text,
  p_reference_id text,
  p_actor_user_id uuid,
  p_request_id text,
  p_credit_kind text,
  p_demo boolean,
  p_action_code text DEFAULT 'credit_org.adjust',
  p_policy_version text DEFAULT 'admin-hq-decision/v1',
  p_aal text DEFAULT 'aal2'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_credit_result jsonb;
  v_new_balance numeric;
  v_prev_hash text;
  v_occurred_at timestamptz := now();
  v_idempotency_key text;
  v_existing_event uuid;
  v_payload jsonb;
  v_event_hash text;
  v_event_id uuid;
  v_canonical text;
BEGIN
  IF p_org_id IS NULL OR p_amount IS NULL OR p_amount <= 0
     OR p_reason IS NULL OR length(btrim(p_reason)) < 8
     OR p_actor_user_id IS NULL OR p_reference_id IS NULL THEN
    RAISE EXCEPTION 'admin_credit_org_with_governance: invalid input'
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
      'new_balance', NULL,
      'reference_id', p_reference_id
    );
  END IF;

  v_credit_result := public.atomic_token_credit(
    p_org_id        => p_org_id,
    p_amount        => p_amount,
    p_reason        => left('admin_top_up:' || p_reason, 500),
    p_reference_id  => p_reference_id,
    p_extra_metadata => jsonb_build_object(
      'credit_kind', p_credit_kind,
      'reference_id', p_reference_id,
      'payment_reference', p_reference_id,
      'reason', p_reason,
      'actor_user_id', p_actor_user_id,
      'target_org_id', p_org_id,
      'demo', p_demo
    )
  );

  IF v_credit_result IS NULL OR COALESCE((v_credit_result->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_credit_org_with_governance: credit_failed: %', COALESCE(v_credit_result->>'error', 'unknown')
      USING ERRCODE = 'P0001';
  END IF;

  v_new_balance := (v_credit_result->>'new_balance')::numeric;

  v_payload := jsonb_build_object(
    'source_function',  'admin-credit-org',
    'request_id',       p_request_id,
    'correlation_id',   NULL,
    'idempotency_key',  v_idempotency_key,
    'previous_state',   NULL,
    'new_state',        NULL,
    'allowed_or_blocked','allowed',
    'reason',           p_action_code,
    'reason_code',      p_action_code,
    'posture',          'Standard',
    'posture_snapshot', jsonb_build_object(
      'verification_posture', 'Standard',
      'policy_version', p_policy_version,
      'waiver_applied', false,
      'bypass_applied', false,
      'demo',           p_demo,
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
      'payment_reference', p_reference_id,
      'credit_ledger_id', NULL
    ),
    'match_id', NULL,
    'poi_id',   NULL,
    'metadata', jsonb_build_object(
      'action_code',      p_action_code,
      'reason',           p_reason,
      'aal',              p_aal,
      'policy_version',   p_policy_version,
      'credits',          p_amount,
      'credit_kind',      p_credit_kind,
      'demo',             p_demo,
      'new_balance',      v_new_balance,
      'reference_id',     p_reference_id,
      'payment_reference', p_reference_id
    )
  );

  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE org_id = p_org_id
    AND aggregate_type = 'organisation_credit_balance'
    AND aggregate_id = p_org_id
  ORDER BY occurred_at DESC
  LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash',      v_prev_hash,
    'org_id',         p_org_id,
    'aggregate_type', 'organisation_credit_balance',
    'aggregate_id',   p_org_id,
    'event_type',     'admin.hq_decision_recorded',
    'occurred_at',    to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload',        v_payload
  )::text;
  v_event_hash := encode(extensions.digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    occurred_at, actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    p_org_id, 'core', 'organisation_credit_balance', p_org_id, 'admin.hq_decision_recorded',
    v_occurred_at, p_actor_user_id, 'platform_admin', v_payload, v_prev_hash, v_event_hash
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success',       true,
    'deduplicated',  false,
    'event_id',      v_event_id,
    'new_balance',   v_new_balance,
    'reference_id',  p_reference_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_credit_org_with_governance(
  uuid, integer, text, text, uuid, text, text, boolean, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_credit_org_with_governance(
  uuid, integer, text, text, uuid, text, text, boolean, text, text, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_credit_org_with_governance(
  uuid, integer, text, text, uuid, text, text, boolean, text, text, text
) TO service_role;