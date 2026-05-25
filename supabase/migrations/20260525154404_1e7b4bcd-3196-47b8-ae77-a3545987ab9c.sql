
-- ============================================================
-- Batch F6 — atomic counterparty / match correction wrappers.
-- Pattern mirrors F1–F5. SECURITY DEFINER, service_role-only EXECUTE.
-- Each wrapper dispatches on p_operation, runs the existing RPC,
-- then inserts exactly one canonical admin.hq_decision_recorded
-- row in the same transaction.
-- ============================================================

-- ---------- 1. admin_counterparty_corrections_with_governance ----------
CREATE OR REPLACE FUNCTION public.admin_counterparty_corrections_with_governance(
  p_operation text,
  p_admin_user_id uuid,
  p_reason text,
  p_request_id text,
  p_params jsonb,
  p_aal text DEFAULT 'aal2',
  p_policy_version text DEFAULT 'admin-hq-decision/v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_rpc_result jsonb;
  v_aggregate_id uuid;
  v_org_id uuid;
  v_action_code text;
  v_extra jsonb;
  v_prev_hash text;
  v_occurred_at timestamptz := now();
  v_idempotency_key text;
  v_existing_event uuid;
  v_payload jsonb;
  v_event_hash text;
  v_event_id uuid;
  v_canonical text;
  v_counterparty_id uuid;
  v_link_org_id uuid;
  v_primary_id uuid;
  v_duplicate_id uuid;
BEGIN
  IF p_admin_user_id IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) < 10
     OR p_operation IS NULL THEN
    RAISE EXCEPTION 'admin_counterparty_corrections_with_governance: invalid input'
      USING ERRCODE = '22023';
  END IF;

  IF p_operation = 'link_to_org' THEN
    v_counterparty_id := (p_params->>'counterparty_id')::uuid;
    v_link_org_id     := (p_params->>'org_id')::uuid;
    IF v_counterparty_id IS NULL OR v_link_org_id IS NULL THEN
      RAISE EXCEPTION 'admin_counterparty_corrections_with_governance: missing params for link_to_org'
        USING ERRCODE = '22023';
    END IF;
    v_aggregate_id := v_counterparty_id;
    v_action_code  := 'counterparty.correct.link_to_org';
    v_extra := jsonb_build_object('linked_org_id', v_link_org_id);
  ELSIF p_operation = 'merge' THEN
    v_primary_id   := (p_params->>'primary_id')::uuid;
    v_duplicate_id := (p_params->>'duplicate_id')::uuid;
    IF v_primary_id IS NULL OR v_duplicate_id IS NULL THEN
      RAISE EXCEPTION 'admin_counterparty_corrections_with_governance: missing params for merge'
        USING ERRCODE = '22023';
    END IF;
    v_aggregate_id := v_primary_id;
    v_action_code  := 'counterparty.correct.merge';
    v_extra := jsonb_build_object('duplicate_id', v_duplicate_id);
  ELSE
    RAISE EXCEPTION 'admin_counterparty_corrections_with_governance: unknown operation %', p_operation
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := v_aggregate_id::text
    || '|admin.hq_decision_recorded|'
    || COALESCE(p_request_id, 'no-req')
    || '|' || v_action_code;

  SELECT id INTO v_existing_event
  FROM public.event_store
  WHERE aggregate_id = v_aggregate_id
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
      'aggregate_id', v_aggregate_id
    );
  END IF;

  -- business mutation
  IF p_operation = 'link_to_org' THEN
    v_rpc_result := public.admin_link_counterparty_to_org(
      p_counterparty_id => v_counterparty_id,
      p_org_id          => v_link_org_id,
      p_reason          => p_reason,
      p_admin_user_id   => p_admin_user_id
    );
    v_org_id := v_link_org_id;
  ELSE
    v_rpc_result := public.admin_merge_counterparties(
      p_primary_id     => v_primary_id,
      p_duplicate_id   => v_duplicate_id,
      p_reason         => p_reason,
      p_admin_user_id  => p_admin_user_id
    );
    SELECT org_id INTO v_org_id
    FROM public.counterparties WHERE id = v_primary_id;
  END IF;

  v_payload := jsonb_build_object(
    'source_function',   'admin-counterparty-corrections',
    'request_id',        p_request_id,
    'correlation_id',    NULL,
    'idempotency_key',   v_idempotency_key,
    'previous_state',    'counterparty_pre_correction',
    'new_state',         'counterparty_post_correction',
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
      'match_id', NULL, 'poi_id', NULL, 'wad_id', NULL,
      'engagement_id', NULL, 'payment_reference', NULL,
      'credit_ledger_id', NULL,
      'counterparty_id', v_aggregate_id
    ),
    'match_id', NULL,
    'poi_id',   NULL,
    'metadata', jsonb_build_object(
      'action_code',      v_action_code,
      'operation',        p_operation,
      'reason',           p_reason,
      'aal',              p_aal,
      'policy_version',   p_policy_version,
      'counterparty_id',  v_aggregate_id,
      'org_id',           v_org_id,
      'rpc_result',       v_rpc_result
    ) || v_extra
  );

  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE aggregate_type = 'counterparty'
    AND aggregate_id = v_aggregate_id
  ORDER BY occurred_at DESC
  LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash', v_prev_hash,
    'org_id', v_org_id,
    'aggregate_type', 'counterparty',
    'aggregate_id', v_aggregate_id,
    'event_type', 'admin.hq_decision_recorded',
    'occurred_at', to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload', v_payload
  )::text;
  v_event_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    occurred_at, actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    v_org_id, 'core', 'counterparty', v_aggregate_id, 'admin.hq_decision_recorded',
    v_occurred_at, p_admin_user_id, 'platform_admin', v_payload, v_prev_hash, v_event_hash
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'deduplicated', false,
    'event_id', v_event_id,
    'aggregate_id', v_aggregate_id,
    'result', v_rpc_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_counterparty_corrections_with_governance(text,uuid,text,text,jsonb,text,text)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_counterparty_corrections_with_governance(text,uuid,text,text,jsonb,text,text)
  TO service_role;


-- ---------- 2. admin_match_corrections_with_governance ----------
CREATE OR REPLACE FUNCTION public.admin_match_corrections_with_governance(
  p_operation text,
  p_admin_user_id uuid,
  p_reason text,
  p_request_id text,
  p_params jsonb,
  p_aal text DEFAULT 'aal2',
  p_policy_version text DEFAULT 'admin-hq-decision/v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_rpc_result jsonb;
  v_match_id uuid;
  v_org_id uuid;
  v_action_code text;
  v_extra jsonb;
  v_prev_hash text;
  v_occurred_at timestamptz := now();
  v_idempotency_key text;
  v_existing_event uuid;
  v_payload jsonb;
  v_event_hash text;
  v_event_id uuid;
  v_canonical text;
  v_origin text;
  v_destination text;
  v_side text;
  v_new_org_id uuid;
  v_duplicate_of_match_id uuid;
BEGIN
  IF p_admin_user_id IS NULL
     OR p_reason IS NULL OR length(btrim(p_reason)) < 10
     OR p_operation IS NULL THEN
    RAISE EXCEPTION 'admin_match_corrections_with_governance: invalid input'
      USING ERRCODE = '22023';
  END IF;

  v_match_id := (p_params->>'match_id')::uuid;
  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'admin_match_corrections_with_governance: missing match_id'
      USING ERRCODE = '22023';
  END IF;

  IF p_operation = 'correct_jurisdiction' THEN
    v_origin      := p_params->>'origin_country';
    v_destination := p_params->>'destination_country';
    IF v_origin IS NULL OR v_destination IS NULL THEN
      RAISE EXCEPTION 'admin_match_corrections_with_governance: missing jurisdiction params'
        USING ERRCODE = '22023';
    END IF;
    v_action_code := 'match.correct.jurisdiction';
    v_extra := jsonb_build_object('origin_country', v_origin, 'destination_country', v_destination);
  ELSIF p_operation = 'relink_counterparty' THEN
    v_side := p_params->>'side';
    v_new_org_id := NULLIF(p_params->>'new_org_id','')::uuid;
    IF v_side IS NULL OR v_side NOT IN ('buyer','seller') THEN
      RAISE EXCEPTION 'admin_match_corrections_with_governance: invalid side'
        USING ERRCODE = '22023';
    END IF;
    v_action_code := 'match.correct.relink_counterparty';
    v_extra := jsonb_build_object('side', v_side, 'new_org_id', v_new_org_id);
  ELSIF p_operation = 'archive_duplicate' THEN
    v_duplicate_of_match_id := (p_params->>'duplicate_of_match_id')::uuid;
    IF v_duplicate_of_match_id IS NULL THEN
      RAISE EXCEPTION 'admin_match_corrections_with_governance: missing duplicate_of_match_id'
        USING ERRCODE = '22023';
    END IF;
    v_action_code := 'match.correct.archive_duplicate';
    v_extra := jsonb_build_object('duplicate_of_match_id', v_duplicate_of_match_id);
  ELSE
    RAISE EXCEPTION 'admin_match_corrections_with_governance: unknown operation %', p_operation
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := v_match_id::text
    || '|admin.hq_decision_recorded|'
    || COALESCE(p_request_id, 'no-req')
    || '|' || v_action_code;

  SELECT id INTO v_existing_event
  FROM public.event_store
  WHERE aggregate_id = v_match_id
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
      'match_id', v_match_id
    );
  END IF;

  IF p_operation = 'correct_jurisdiction' THEN
    v_rpc_result := public.admin_correct_match_jurisdiction(
      p_match_id => v_match_id,
      p_origin_country => v_origin,
      p_destination_country => v_destination,
      p_reason => p_reason,
      p_admin_user_id => p_admin_user_id
    );
  ELSIF p_operation = 'relink_counterparty' THEN
    v_rpc_result := public.admin_relink_match_counterparty(
      p_match_id => v_match_id,
      p_side => v_side,
      p_new_org_id => v_new_org_id,
      p_reason => p_reason,
      p_admin_user_id => p_admin_user_id
    );
  ELSE
    v_rpc_result := public.admin_archive_duplicate_match(
      p_match_id => v_match_id,
      p_duplicate_of_match_id => v_duplicate_of_match_id,
      p_reason => p_reason,
      p_admin_user_id => p_admin_user_id
    );
  END IF;

  SELECT org_id INTO v_org_id FROM public.matches WHERE id = v_match_id;

  v_payload := jsonb_build_object(
    'source_function',   'admin-match-corrections',
    'request_id',        p_request_id,
    'correlation_id',    NULL,
    'idempotency_key',   v_idempotency_key,
    'previous_state',    'match_pre_correction',
    'new_state',         'match_post_correction',
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
      'credit_ledger_id', NULL
    ),
    'match_id', v_match_id,
    'poi_id',   NULL,
    'metadata', jsonb_build_object(
      'action_code',    v_action_code,
      'operation',      p_operation,
      'reason',         p_reason,
      'aal',            p_aal,
      'policy_version', p_policy_version,
      'match_id',       v_match_id,
      'org_id',         v_org_id,
      'rpc_result',     v_rpc_result
    ) || v_extra
  );

  SELECT event_hash INTO v_prev_hash
  FROM public.event_store
  WHERE aggregate_type = 'match'
    AND aggregate_id = v_match_id
  ORDER BY occurred_at DESC
  LIMIT 1;

  v_canonical := jsonb_build_object(
    'prev_hash', v_prev_hash,
    'org_id', v_org_id,
    'aggregate_type', 'match',
    'aggregate_id', v_match_id,
    'event_type', 'admin.hq_decision_recorded',
    'occurred_at', to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload', v_payload
  )::text;
  v_event_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    occurred_at, actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    v_org_id, 'core', 'match', v_match_id, 'admin.hq_decision_recorded',
    v_occurred_at, p_admin_user_id, 'platform_admin', v_payload, v_prev_hash, v_event_hash
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'deduplicated', false,
    'event_id', v_event_id,
    'match_id', v_match_id,
    'result', v_rpc_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_match_corrections_with_governance(text,uuid,text,text,jsonb,text,text)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_match_corrections_with_governance(text,uuid,text,text,jsonb,text,text)
  TO service_role;
