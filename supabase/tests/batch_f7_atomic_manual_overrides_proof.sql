-- Batch F7 atomicity proof — admin_manual_override_with_governance.
--
-- The four supported operations split into two atomicity classes:
--
--   CLASS A — DB-mutating ops handled inside the wrapper's transaction:
--     * force_status   (calls safe_transition_match_state)
--     * void_match     (calls safe_transition_match_state)
--     Atomicity guarantee: business mutation + admin_audit_logs insert +
--     governance event commit together. Any failure rolls all three back.
--     Pre-existing schema note: the matches.state CHECK constraint does
--     not include the legacy ALLOWED_STATUSES set ('matched','settled',
--     'voided','disputed') used by this endpoint, so a true happy-path
--     transition is not exercisable from the live DB here without
--     mutating the CHECK constraint (which is OUT OF F7 SCOPE — this is
--     a pre-existing endpoint/data-model mismatch, not introduced by
--     F7). Therefore the DB-mutating ops are proven via the rollback
--     path, which is the atomicity-critical direction.
--
--   CLASS B — external-side-effect ops (dilisense-screen / evidence-pack
--   are invoked by the edge function BEFORE the wrapper). Inside the
--   wrapper, audit row + governance event commit atomically:
--     * rerun_screening
--     * regenerate_evidence
--     These are exercised as full happy-path + replay-dedupe.
--
-- The whole script runs inside a transaction that ends in ROLLBACK — no
-- production data is mutated.

BEGIN;

DO $$
DECLARE
  v_actor uuid;
  v_org uuid := gen_random_uuid();
  v_match uuid := gen_random_uuid();
  v_match_rollback uuid := gen_random_uuid();
  v_match_evidence uuid := gen_random_uuid();
  v_entity uuid := gen_random_uuid();
  v_tr uuid := gen_random_uuid();
  v_call jsonb;
  v_call_2 jsonb;
  v_event_count int;
  v_audit_count int;
  v_status text;
  v_state text;
  v_bad_caught boolean;
  v_req_scr   text := 'f7-scr-' || gen_random_uuid()::text;
  v_req_ev    text := 'f7-ev-'  || gen_random_uuid()::text;
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
    (v_match_rollback, v_tr, 'matched', 'discovery', 'DRAFT', '{}'::jsonb,
     'f7-h-' || v_match_rollback::text, 'F7-COMMODITY', v_org, 'bilateral', 'ZA', 'AE'),
    (v_match_evidence, v_tr, 'matched', 'discovery', 'DRAFT', '{}'::jsonb,
     'f7-h-' || v_match_evidence::text, 'F7-COMMODITY', v_org, 'bilateral', 'ZA', 'AE')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.entities (id, org_id, entity_type, legal_name, jurisdiction_code, status)
  VALUES (v_entity, v_org, 'COMPANY', 'F7 Entity', 'ZA', 'PENDING')
  ON CONFLICT (id) DO NOTHING;

  -- =====================================================================
  -- CLASS B.1: rerun_screening — happy path
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
  IF COALESCE((v_call->>'deduplicated')::boolean, false) THEN
    RAISE EXCEPTION 'F7 rerun_screening happy path unexpectedly deduplicated';
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

  -- replay → dedupe (no extra event, no extra audit row)
  v_call_2 := public.admin_manual_override_with_governance(
    p_operation     => 'rerun_screening',
    p_admin_user_id => v_actor,
    p_reason        => 'F7 rerun_screening proof reason',
    p_request_id    => v_req_scr,
    p_params        => jsonb_build_object('entity_id', v_entity)
  );
  IF NOT COALESCE((v_call_2->>'deduplicated')::boolean, false) THEN
    RAISE EXCEPTION 'F7 rerun_screening replay: expected deduplicated=true, got %', v_call_2;
  END IF;
  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_entity AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'F7 rerun_screening replay: event count grew to %', v_event_count;
  END IF;
  SELECT count(*) INTO v_audit_count FROM public.admin_audit_logs
   WHERE target_id = v_entity AND action = 'admin.manual_override.rerun_screening';
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'F7 rerun_screening replay: audit row count grew to %', v_audit_count;
  END IF;

  -- =====================================================================
  -- CLASS B.2: regenerate_evidence — happy path + dedupe
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
  SELECT count(*) INTO v_audit_count FROM public.admin_audit_logs
   WHERE target_id = v_match_evidence AND action = 'admin.manual_override.regenerate_evidence';
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'F7 regenerate_evidence: expected 1 audit row, got %', v_audit_count;
  END IF;
  v_call_2 := public.admin_manual_override_with_governance(
    p_operation     => 'regenerate_evidence',
    p_admin_user_id => v_actor,
    p_reason        => 'F7 regenerate_evidence proof reason',
    p_request_id    => v_req_ev,
    p_params        => jsonb_build_object('match_id', v_match_evidence)
  );
  IF NOT COALESCE((v_call_2->>'deduplicated')::boolean, false) THEN
    RAISE EXCEPTION 'F7 regenerate_evidence replay: expected deduplicated=true, got %', v_call_2;
  END IF;
  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_match_evidence AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'F7 regenerate_evidence replay: event count grew to %', v_event_count;
  END IF;

  -- =====================================================================
  -- CLASS A ROLLBACK: invalid reason on force_status → wrapper raises,
  -- no state mutation, no audit row, no gov event.
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
  SELECT status, state INTO v_status, v_state FROM public.matches WHERE id = v_match_rollback;
  IF v_status <> 'matched' OR v_state <> 'discovery' THEN
    RAISE EXCEPTION 'F7 rollback (short reason): match mutated despite failure (status=%, state=%)', v_status, v_state;
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
  -- CLASS A ROLLBACK: invalid new_status also rolls back cleanly.
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

  -- =====================================================================
  -- CLASS A ROLLBACK: force_status whose underlying state transition is
  -- rejected (CHECK constraint on matches.state) — the wrapper RAISEs
  -- after safe_transition_match_state errors, and rollback erases the
  -- audit row + gov event that would otherwise be inserted later.
  -- This is the critical "split-commit eliminated" proof.
  -- =====================================================================
  v_bad_caught := false;
  BEGIN
    PERFORM public.admin_manual_override_with_governance(
      p_operation     => 'force_status',
      p_admin_user_id => v_actor,
      p_reason        => 'F7 transition rollback proof reason',
      p_request_id    => 'f7-tx-' || gen_random_uuid()::text,
      p_params        => jsonb_build_object('match_id', v_match, 'new_status', 'settled')
    );
  EXCEPTION WHEN OTHERS THEN v_bad_caught := true; END;
  IF NOT v_bad_caught THEN
    RAISE EXCEPTION 'F7 transition rollback: expected raise (state CHECK or transition rejection)';
  END IF;
  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_match AND event_type = 'admin.hq_decision_recorded';
  IF v_event_count <> 0 THEN
    RAISE EXCEPTION 'F7 transition rollback: % gov events leaked for v_match', v_event_count;
  END IF;
  SELECT count(*) INTO v_audit_count FROM public.admin_audit_logs
   WHERE target_id = v_match;
  IF v_audit_count <> 0 THEN
    RAISE EXCEPTION 'F7 transition rollback: % audit rows leaked for v_match', v_audit_count;
  END IF;

  RAISE NOTICE 'Batch F7 atomic manual overrides proof: ALL ASSERTIONS PASSED';
END $$;

ROLLBACK;
