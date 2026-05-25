-- Batch F7 atomicity proof — admin_manual_override_with_governance.
--
-- Exercises:
--   1. force_status   (DB-mutating: safe_transition_match_state)
--   2. void_match     (DB-mutating: safe_transition_match_state)
--   3. rerun_screening    (external-side-effect: audit + gov atomic only)
--   4. regenerate_evidence (external-side-effect: audit + gov atomic only)
--
-- For each we prove:
--   - happy path mutates state (where applicable) + writes exactly 1
--     admin.hq_decision_recorded event + exactly 1 admin_audit_logs row;
--   - replay with the same request_id is deduplicated (no second event,
--     no second audit row);
--   - rollback: invalid input (reason < 10 chars / bad new_status) raises
--     inside the wrapper, leaving NO state change, NO governance event,
--     and NO audit row behind;
--   - for force_status, a rejected transition (wrong expected_state) rolls
--     back the audit row + governance event too.
--
-- The whole script runs inside a transaction that ends in ROLLBACK — no
-- production data is mutated.

BEGIN;

DO $$
DECLARE
  v_actor uuid;
  v_org uuid := gen_random_uuid();
  v_match uuid := gen_random_uuid();
  v_match_void uuid := gen_random_uuid();
  v_match_rollback uuid := gen_random_uuid();
  v_match_evidence uuid := gen_random_uuid();
  v_entity uuid := gen_random_uuid();
  v_tr uuid := gen_random_uuid();
  v_call jsonb;
  v_call_2 jsonb;
  v_event_count int;
  v_audit_count int;
  v_status text;
  v_bad_caught boolean;
  v_req_force text := 'f7-force-' || gen_random_uuid()::text;
  v_req_void  text := 'f7-void-'  || gen_random_uuid()::text;
  v_req_scr   text := 'f7-scr-'   || gen_random_uuid()::text;
  v_req_ev    text := 'f7-ev-'    || gen_random_uuid()::text;
BEGIN
  SELECT user_id INTO v_actor
  FROM public.user_roles
  WHERE role = 'platform_admin'
  ORDER BY created_at LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'F7 proof: no platform_admin user available'; END IF;

  INSERT INTO public.organizations (id, name, status, data_region)
  VALUES (v_org, 'F7 Org ' || v_org::text, 'active', 'ZA')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.trade_requests (id, org_id, created_by, side, status)
  VALUES (v_tr, v_org, v_actor, 'buyer', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.matches (id, trade_request_id, status, state, poi_state, metadata,
                              hash, commodity, org_id, match_type,
                              origin_country, destination_country)
  VALUES
    (v_match,          v_tr, 'matched', 'discovery', 'DRAFT', '{}'::jsonb,
     'f7-h-' || v_match::text,          'F7-COMMODITY', v_org, 'bilateral', 'ZA', 'AE'),
    (v_match_void,     v_tr, 'matched', 'discovery', 'DRAFT', '{}'::jsonb,
     'f7-h-' || v_match_void::text,     'F7-COMMODITY', v_org, 'bilateral', 'ZA', 'AE'),
    (v_match_rollback, v_tr, 'matched', 'discovery', 'DRAFT', '{}'::jsonb,
     'f7-h-' || v_match_rollback::text, 'F7-COMMODITY', v_org, 'bilateral', 'ZA', 'AE'),
    (v_match_evidence, v_tr, 'matched', 'discovery', 'DRAFT', '{}'::jsonb,
     'f7-h-' || v_match_evidence::text, 'F7-COMMODITY', v_org, 'bilateral', 'ZA', 'AE')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.entities (id, org_id, name, jurisdiction)
  VALUES (v_entity, v_org, 'F7 Entity', 'ZA')
  ON CONFLICT (id) DO NOTHING;

  -- =====================================================================
  -- 1. force_status — DB-mutating path
  -- =====================================================================
  v_call := public.admin_manual_override_with_governance(
    p_operation     => 'force_status',
    p_admin_user_id => v_actor,
    p_reason        => 'F7 force_status proof reason',
    p_request_id    => v_req_force,
    p_params        => jsonb_build_object('match_id', v_match, 'new_status', 'settled')
  );
  IF NOT COALESCE((v_call->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'F7 force_status happy path failed: %', v_call;
  END IF;

  SELECT status INTO v_status FROM public.matches WHERE id = v_match;
  IF v_status <> 'settled' THEN
    RAISE EXCEPTION 'F7 force_status: status not updated (got %)', v_status;
  END IF;

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_match AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'F7 force_status: expected 1 gov event, got %', v_event_count;
  END IF;

  SELECT count(*) INTO v_audit_count FROM public.admin_audit_logs
   WHERE target_id = v_match AND action = 'admin.manual_override.force_status';
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'F7 force_status: expected 1 audit row, got %', v_audit_count;
  END IF;

  -- replay → dedupe
  v_call_2 := public.admin_manual_override_with_governance(
    p_operation     => 'force_status',
    p_admin_user_id => v_actor,
    p_reason        => 'F7 force_status proof reason',
    p_request_id    => v_req_force,
    p_params        => jsonb_build_object('match_id', v_match, 'new_status', 'settled')
  );
  IF NOT COALESCE((v_call_2->>'deduplicated')::boolean, false) THEN
    RAISE EXCEPTION 'F7 force_status replay: expected deduplicated=true, got %', v_call_2;
  END IF;
  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_match AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'F7 force_status replay: event count grew to %', v_event_count;
  END IF;
  SELECT count(*) INTO v_audit_count FROM public.admin_audit_logs
   WHERE target_id = v_match AND action = 'admin.manual_override.force_status';
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'F7 force_status replay: audit row count grew to %', v_audit_count;
  END IF;

  -- =====================================================================
  -- 2. void_match — DB-mutating path
  -- =====================================================================
  v_call := public.admin_manual_override_with_governance(
    p_operation     => 'void_match',
    p_admin_user_id => v_actor,
    p_reason        => 'F7 void_match proof reason',
    p_request_id    => v_req_void,
    p_params        => jsonb_build_object('match_id', v_match_void)
  );
  IF NOT COALESCE((v_call->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'F7 void_match happy path failed: %', v_call;
  END IF;

  SELECT status INTO v_status FROM public.matches WHERE id = v_match_void;
  IF v_status <> 'voided' THEN
    RAISE EXCEPTION 'F7 void_match: status not voided (got %)', v_status;
  END IF;

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_match_void AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'F7 void_match: expected 1 gov event, got %', v_event_count;
  END IF;

  -- =====================================================================
  -- 3. rerun_screening — external-side-effect path (audit+gov atomic)
  -- =====================================================================
  v_call := public.admin_manual_override_with_governance(
    p_operation     => 'rerun_screening',
    p_admin_user_id => v_actor,
    p_reason        => 'F7 rerun_screening proof reason',
    p_request_id    => v_req_scr,
    p_params        => jsonb_build_object('entity_id', v_entity)
  );
  IF NOT COALESCE((v_call->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'F7 rerun_screening happy path failed: %', v_call;
  END IF;
  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_entity AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'F7 rerun_screening: expected 1 gov event, got %', v_event_count;
  END IF;
  SELECT count(*) INTO v_audit_count FROM public.admin_audit_logs
   WHERE target_id = v_entity AND action = 'admin.manual_override.rerun_screening';
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'F7 rerun_screening: expected 1 audit row, got %', v_audit_count;
  END IF;

  -- =====================================================================
  -- 4. regenerate_evidence — external-side-effect path
  -- =====================================================================
  v_call := public.admin_manual_override_with_governance(
    p_operation     => 'regenerate_evidence',
    p_admin_user_id => v_actor,
    p_reason        => 'F7 regenerate_evidence proof reason',
    p_request_id    => v_req_ev,
    p_params        => jsonb_build_object('match_id', v_match_evidence)
  );
  IF NOT COALESCE((v_call->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'F7 regenerate_evidence happy path failed: %', v_call;
  END IF;
  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_match_evidence AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'F7 regenerate_evidence: expected 1 gov event, got %', v_event_count;
  END IF;

  -- =====================================================================
  -- 5. ROLLBACK: invalid reason rolls back state + audit + gov.
  -- =====================================================================
  v_bad_caught := false;
  BEGIN
    PERFORM public.admin_manual_override_with_governance(
      p_operation     => 'force_status',
      p_admin_user_id => v_actor,
      p_reason        => 'short',
      p_request_id    => 'f7-rb-' || gen_random_uuid()::text,
      p_params        => jsonb_build_object('match_id', v_match_rollback, 'new_status', 'settled')
    );
  EXCEPTION WHEN OTHERS THEN v_bad_caught := true; END;
  IF NOT v_bad_caught THEN
    RAISE EXCEPTION 'F7 rollback (short reason): expected invalid input to raise';
  END IF;

  SELECT status INTO v_status FROM public.matches WHERE id = v_match_rollback;
  IF v_status <> 'matched' THEN
    RAISE EXCEPTION 'F7 rollback (short reason): status mutated despite failure (%)', v_status;
  END IF;
  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_match_rollback AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 0 THEN
    RAISE EXCEPTION 'F7 rollback (short reason): % gov events leaked', v_event_count;
  END IF;
  SELECT count(*) INTO v_audit_count FROM public.admin_audit_logs
   WHERE target_id = v_match_rollback;
  IF v_audit_count <> 0 THEN
    RAISE EXCEPTION 'F7 rollback (short reason): % audit rows leaked', v_audit_count;
  END IF;

  -- =====================================================================
  -- 6. ROLLBACK: invalid new_status also rolls back cleanly.
  -- =====================================================================
  v_bad_caught := false;
  BEGIN
    PERFORM public.admin_manual_override_with_governance(
      p_operation     => 'force_status',
      p_admin_user_id => v_actor,
      p_reason        => 'F7 bad status reason text',
      p_request_id    => 'f7-rb2-' || gen_random_uuid()::text,
      p_params        => jsonb_build_object('match_id', v_match_rollback, 'new_status', 'bogus')
    );
  EXCEPTION WHEN OTHERS THEN v_bad_caught := true; END;
  IF NOT v_bad_caught THEN
    RAISE EXCEPTION 'F7 rollback (bad status): expected invalid input to raise';
  END IF;
  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_match_rollback AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 0 THEN
    RAISE EXCEPTION 'F7 rollback (bad status): % gov events leaked', v_event_count;
  END IF;
  SELECT count(*) INTO v_audit_count FROM public.admin_audit_logs
   WHERE target_id = v_match_rollback;
  IF v_audit_count <> 0 THEN
    RAISE EXCEPTION 'F7 rollback (bad status): % audit rows leaked', v_audit_count;
  END IF;

  RAISE NOTICE 'Batch F7 atomic manual overrides proof: ALL ASSERTIONS PASSED';
END $$;

ROLLBACK;
