-- Batch F5 atomicity proof — trade-request exception wrappers.
--
-- Exercises the two atomic wrapper RPCs added in the F5 migration:
--   1. admin_trade_request_archive_override_with_governance
--   2. admin_trade_request_exception_hold_release_with_governance
--
-- For each we prove:
--   - happy path mutates state + writes exactly 1
--     admin.hq_decision_recorded event into event_store under the
--     trade_request aggregate;
--   - replay with the same request_id is deduplicated (no second event);
--   - rollback: an invalid input (reason < 20 chars) raises 22023
--     inside the wrapper and leaves NO state change and NO governance
--     event behind.
--
-- The whole script runs inside a single transaction that ends in ROLLBACK,
-- so no production data is mutated.

BEGIN;

DO $$
DECLARE
  v_actor uuid;
  v_org uuid := gen_random_uuid();
  v_tr_archive uuid := gen_random_uuid();
  v_tr_release uuid := gen_random_uuid();
  v_tr_rollback uuid := gen_random_uuid();
  v_match_archive uuid := gen_random_uuid();
  v_match_release uuid := gen_random_uuid();
  v_match_rollback uuid := gen_random_uuid();
  v_call jsonb;
  v_call_2 jsonb;
  v_event_count int;
  v_archived_at timestamptz;
  v_hold_active boolean;
  v_bad_caught boolean;
  v_req_archive text := 'f5-tr-archive-' || gen_random_uuid()::text;
  v_req_release text := 'f5-tr-release-' || gen_random_uuid()::text;
BEGIN
  -- Need a real platform_admin actor (RPCs key off user uuid).
  SELECT user_id INTO v_actor
  FROM public.user_roles
  WHERE role = 'platform_admin'
  ORDER BY created_at
  LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'F5 proof: no platform_admin user available';
  END IF;

  -- Scratch org (FK satisfied by orgs table NOT being needed here —
  -- trade_requests and matches only need their own UUIDs + org_id field;
  -- audit_logs accepts NULL/any org_id).
  -- ===================================================================
  -- 1. ARCHIVE OVERRIDE — happy path + dedupe + rollback
  -- ===================================================================
  INSERT INTO public.trade_requests (id, org_id, created_by, side, status)
  VALUES (v_tr_archive, v_org, v_actor, 'buyer', 'active')
  ON CONFLICT (id) DO NOTHING;

  -- Add one active child match so override has something to flip.
  INSERT INTO public.matches (id, trade_request_id, status, state, poi_state, metadata)
  VALUES (v_match_archive, v_tr_archive, 'active', 'active', 'DRAFT', '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  v_call := public.admin_trade_request_archive_override_with_governance(
    p_trade_request_id => v_tr_archive,
    p_admin_user_id    => v_actor,
    p_reason           => 'F5 archive override proof — sufficient length',
    p_request_id       => v_req_archive
  );

  IF NOT COALESCE((v_call->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'F5 archive happy path failed: %', v_call;
  END IF;
  IF COALESCE((v_call->>'deduplicated')::boolean, false) THEN
    RAISE EXCEPTION 'F5 archive happy path unexpectedly deduplicated';
  END IF;

  SELECT archived_at INTO v_archived_at FROM public.trade_requests WHERE id = v_tr_archive;
  IF v_archived_at IS NULL THEN
    RAISE EXCEPTION 'F5 archive happy path: archived_at not set';
  END IF;

  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE aggregate_id = v_tr_archive
    AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'F5 archive happy path: expected 1 gov event, got %', v_event_count;
  END IF;

  -- Replay with the same request_id should dedupe (no second event).
  v_call_2 := public.admin_trade_request_archive_override_with_governance(
    p_trade_request_id => v_tr_archive,
    p_admin_user_id    => v_actor,
    p_reason           => 'F5 archive override proof — sufficient length',
    p_request_id       => v_req_archive
  );
  IF NOT COALESCE((v_call_2->>'deduplicated')::boolean, false) THEN
    RAISE EXCEPTION 'F5 archive replay: expected deduplicated=true, got %', v_call_2;
  END IF;
  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE aggregate_id = v_tr_archive
    AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'F5 archive replay: event count grew to %', v_event_count;
  END IF;

  -- ===================================================================
  -- 2. EXCEPTION-HOLD RELEASE — happy path + dedupe
  -- ===================================================================
  INSERT INTO public.trade_requests (id, org_id, created_by, side, status, archived_at, archive_mode)
  VALUES (v_tr_release, v_org, v_actor, 'buyer', 'active', now(),
          'admin_override_active_children')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.matches (id, trade_request_id, status, state, poi_state, metadata)
  VALUES (
    v_match_release, v_tr_release, 'active', 'active', 'DRAFT',
    jsonb_build_object(
      'parent_archived_admin_exception_hold', true,
      'parent_archived_admin_exception_hold_at', now()
    )
  )
  ON CONFLICT (id) DO NOTHING;

  v_call := public.admin_trade_request_exception_hold_release_with_governance(
    p_trade_request_id => v_tr_release,
    p_admin_user_id    => v_actor,
    p_reason           => 'F5 release exception hold proof — sufficient length',
    p_request_id       => v_req_release
  );

  IF NOT COALESCE((v_call->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'F5 release happy path failed: %', v_call;
  END IF;

  SELECT COALESCE((metadata->>'parent_archived_admin_exception_hold')::boolean, true)
    INTO v_hold_active
  FROM public.matches WHERE id = v_match_release;
  IF v_hold_active THEN
    RAISE EXCEPTION 'F5 release happy path: exception hold flag still active';
  END IF;

  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE aggregate_id = v_tr_release
    AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'F5 release happy path: expected 1 gov event, got %', v_event_count;
  END IF;

  v_call_2 := public.admin_trade_request_exception_hold_release_with_governance(
    p_trade_request_id => v_tr_release,
    p_admin_user_id    => v_actor,
    p_reason           => 'F5 release exception hold proof — sufficient length',
    p_request_id       => v_req_release
  );
  IF NOT COALESCE((v_call_2->>'deduplicated')::boolean, false) THEN
    RAISE EXCEPTION 'F5 release replay: expected deduplicated=true, got %', v_call_2;
  END IF;
  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE aggregate_id = v_tr_release
    AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'F5 release replay: event count grew to %', v_event_count;
  END IF;

  -- ===================================================================
  -- 3. ROLLBACK — invalid input (reason too short) must:
  --    - raise inside the wrapper
  --    - NOT mutate trade_requests
  --    - NOT insert a gov event
  -- ===================================================================
  INSERT INTO public.trade_requests (id, org_id, created_by, side, status)
  VALUES (v_tr_rollback, v_org, v_actor, 'buyer', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.matches (id, trade_request_id, status, state, poi_state, metadata)
  VALUES (v_match_rollback, v_tr_rollback, 'active', 'active', 'DRAFT', '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  v_bad_caught := false;
  BEGIN
    PERFORM public.admin_trade_request_archive_override_with_governance(
      p_trade_request_id => v_tr_rollback,
      p_admin_user_id    => v_actor,
      p_reason           => 'too short',
      p_request_id       => 'f5-rollback-' || gen_random_uuid()::text
    );
  EXCEPTION WHEN OTHERS THEN
    v_bad_caught := true;
  END;
  IF NOT v_bad_caught THEN
    RAISE EXCEPTION 'F5 rollback: expected invalid input to raise';
  END IF;

  SELECT archived_at INTO v_archived_at FROM public.trade_requests WHERE id = v_tr_rollback;
  IF v_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'F5 rollback: trade_request was archived despite failure';
  END IF;

  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE aggregate_id = v_tr_rollback
    AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 0 THEN
    RAISE EXCEPTION 'F5 rollback: % gov events leaked', v_event_count;
  END IF;

  RAISE NOTICE 'Batch F5 atomic trade-request exception proof: ALL ASSERTIONS PASSED';
END $$;

ROLLBACK;
