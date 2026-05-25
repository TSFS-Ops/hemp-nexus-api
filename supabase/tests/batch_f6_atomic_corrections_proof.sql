-- Batch F6 atomicity proof — counterparty + match correction wrappers.
--
-- Exercises:
--   1. admin_counterparty_corrections_with_governance (link_to_org)
--   2. admin_match_corrections_with_governance (correct_jurisdiction)
--
-- For each we prove:
--   - happy path mutates state + writes exactly 1
--     admin.hq_decision_recorded event into event_store under the
--     correct aggregate;
--   - replay with the same request_id is deduplicated (no second event);
--   - rollback: invalid input (reason < 10 chars) raises inside the
--     wrapper and leaves NO state change and NO governance event behind.
--
-- The whole script runs inside a transaction that ends in ROLLBACK — no
-- production data is mutated.

BEGIN;

DO $$
DECLARE
  v_actor uuid;
  v_org uuid := gen_random_uuid();
  v_org2 uuid := gen_random_uuid();
  v_cp uuid := gen_random_uuid();
  v_cp_rollback uuid := gen_random_uuid();
  v_match uuid := gen_random_uuid();
  v_match_rollback uuid := gen_random_uuid();
  v_tr uuid := gen_random_uuid();
  v_call jsonb;
  v_call_2 jsonb;
  v_event_count int;
  v_linked uuid;
  v_origin text;
  v_bad_caught boolean;
  v_req_cp text := 'f6-cp-' || gen_random_uuid()::text;
  v_req_match text := 'f6-match-' || gen_random_uuid()::text;
BEGIN
  SELECT user_id INTO v_actor
  FROM public.user_roles
  WHERE role = 'platform_admin'
  ORDER BY created_at
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'F6 proof: no platform_admin user available'; END IF;

  -- scratch orgs
  INSERT INTO public.organizations (id, name, status, data_region)
  VALUES (v_org,  'F6 Owner Org ' || v_org::text,  'active', 'ZA'),
         (v_org2, 'F6 Target Org ' || v_org2::text, 'active', 'ZA')
  ON CONFLICT (id) DO NOTHING;

  -- ===================================================================
  -- 1. COUNTERPARTY CORRECTIONS (link_to_org)
  -- ===================================================================
  INSERT INTO public.counterparties (id, org_id, company_name, verified)
  VALUES (v_cp, v_org, 'F6 CP', false)
  ON CONFLICT (id) DO NOTHING;

  v_call := public.admin_counterparty_corrections_with_governance(
    p_operation     => 'link_to_org',
    p_admin_user_id => v_actor,
    p_reason        => 'F6 link counterparty proof reason',
    p_request_id    => v_req_cp,
    p_params        => jsonb_build_object('counterparty_id', v_cp, 'org_id', v_org2)
  );
  IF NOT COALESCE((v_call->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'F6 cp happy path failed: %', v_call;
  END IF;
  IF COALESCE((v_call->>'deduplicated')::boolean, false) THEN
    RAISE EXCEPTION 'F6 cp happy path unexpectedly deduplicated';
  END IF;

  SELECT linked_org_id INTO v_linked FROM public.counterparties WHERE id = v_cp;
  IF v_linked IS DISTINCT FROM v_org2 THEN
    RAISE EXCEPTION 'F6 cp happy path: linked_org_id not set (got %)', v_linked;
  END IF;

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_cp AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'F6 cp happy path: expected 1 gov event, got %', v_event_count;
  END IF;

  -- replay → dedupe
  v_call_2 := public.admin_counterparty_corrections_with_governance(
    p_operation     => 'link_to_org',
    p_admin_user_id => v_actor,
    p_reason        => 'F6 link counterparty proof reason',
    p_request_id    => v_req_cp,
    p_params        => jsonb_build_object('counterparty_id', v_cp, 'org_id', v_org2)
  );
  IF NOT COALESCE((v_call_2->>'deduplicated')::boolean, false) THEN
    RAISE EXCEPTION 'F6 cp replay: expected deduplicated=true, got %', v_call_2;
  END IF;
  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_cp AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'F6 cp replay: event count grew to %', v_event_count;
  END IF;

  -- rollback: invalid reason (too short)
  INSERT INTO public.counterparties (id, org_id, company_name, verified)
  VALUES (v_cp_rollback, v_org, 'F6 CP rollback', false)
  ON CONFLICT (id) DO NOTHING;

  v_bad_caught := false;
  BEGIN
    PERFORM public.admin_counterparty_corrections_with_governance(
      p_operation     => 'link_to_org',
      p_admin_user_id => v_actor,
      p_reason        => 'short',
      p_request_id    => 'f6-cp-rollback-' || gen_random_uuid()::text,
      p_params        => jsonb_build_object('counterparty_id', v_cp_rollback, 'org_id', v_org2)
    );
  EXCEPTION WHEN OTHERS THEN v_bad_caught := true; END;
  IF NOT v_bad_caught THEN RAISE EXCEPTION 'F6 cp rollback: expected invalid input to raise'; END IF;

  SELECT linked_org_id INTO v_linked FROM public.counterparties WHERE id = v_cp_rollback;
  IF v_linked IS NOT NULL THEN
    RAISE EXCEPTION 'F6 cp rollback: linked_org_id mutated despite failure (%)', v_linked;
  END IF;
  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_cp_rollback AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 0 THEN
    RAISE EXCEPTION 'F6 cp rollback: % gov events leaked', v_event_count;
  END IF;

  -- ===================================================================
  -- 2. MATCH CORRECTIONS (correct_jurisdiction)
  -- ===================================================================
  INSERT INTO public.trade_requests (id, org_id, created_by, side, status)
  VALUES (v_tr, v_org, v_actor, 'buyer', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.matches (id, trade_request_id, status, state, poi_state, metadata,
                              hash, commodity, org_id, match_type,
                              origin_country, destination_country)
  VALUES (v_match, v_tr, 'matched', 'discovery', 'DRAFT', '{}'::jsonb,
          'f6-hash-' || v_match::text, 'F6-COMMODITY', v_org, 'bilateral',
          'ZA', 'AE')
  ON CONFLICT (id) DO NOTHING;

  v_call := public.admin_match_corrections_with_governance(
    p_operation     => 'correct_jurisdiction',
    p_admin_user_id => v_actor,
    p_reason        => 'F6 jurisdiction correction proof reason',
    p_request_id    => v_req_match,
    p_params        => jsonb_build_object(
      'match_id', v_match,
      'origin_country', 'ZA',
      'destination_country', 'GB'
    )
  );
  IF NOT COALESCE((v_call->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'F6 match happy path failed: %', v_call;
  END IF;

  SELECT destination_country INTO v_origin FROM public.matches WHERE id = v_match;
  IF v_origin <> 'GB' THEN
    RAISE EXCEPTION 'F6 match happy path: destination_country not updated (got %)', v_origin;
  END IF;

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_match AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'F6 match happy path: expected 1 gov event, got %', v_event_count;
  END IF;

  -- replay → dedupe
  v_call_2 := public.admin_match_corrections_with_governance(
    p_operation     => 'correct_jurisdiction',
    p_admin_user_id => v_actor,
    p_reason        => 'F6 jurisdiction correction proof reason',
    p_request_id    => v_req_match,
    p_params        => jsonb_build_object(
      'match_id', v_match,
      'origin_country', 'ZA',
      'destination_country', 'GB'
    )
  );
  IF NOT COALESCE((v_call_2->>'deduplicated')::boolean, false) THEN
    RAISE EXCEPTION 'F6 match replay: expected deduplicated=true, got %', v_call_2;
  END IF;
  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_match AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'F6 match replay: event count grew to %', v_event_count;
  END IF;

  -- rollback: invalid reason
  INSERT INTO public.matches (id, trade_request_id, status, state, poi_state, metadata,
                              hash, commodity, org_id, match_type,
                              origin_country, destination_country)
  VALUES (v_match_rollback, v_tr, 'matched', 'discovery', 'DRAFT', '{}'::jsonb,
          'f6-hash-' || v_match_rollback::text, 'F6-COMMODITY', v_org, 'bilateral',
          'ZA', 'AE')
  ON CONFLICT (id) DO NOTHING;

  v_bad_caught := false;
  BEGIN
    PERFORM public.admin_match_corrections_with_governance(
      p_operation     => 'correct_jurisdiction',
      p_admin_user_id => v_actor,
      p_reason        => 'short',
      p_request_id    => 'f6-match-rollback-' || gen_random_uuid()::text,
      p_params        => jsonb_build_object(
        'match_id', v_match_rollback,
        'origin_country', 'ZA',
        'destination_country', 'GB'
      )
    );
  EXCEPTION WHEN OTHERS THEN v_bad_caught := true; END;
  IF NOT v_bad_caught THEN RAISE EXCEPTION 'F6 match rollback: expected invalid input to raise'; END IF;

  SELECT destination_country INTO v_origin FROM public.matches WHERE id = v_match_rollback;
  IF v_origin <> 'AE' THEN
    RAISE EXCEPTION 'F6 match rollback: destination_country mutated despite failure (%)', v_origin;
  END IF;
  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_match_rollback AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 0 THEN
    RAISE EXCEPTION 'F6 match rollback: % gov events leaked', v_event_count;
  END IF;

  RAISE NOTICE 'Batch F6 atomic corrections proof: ALL ASSERTIONS PASSED';
END $$;

ROLLBACK;
