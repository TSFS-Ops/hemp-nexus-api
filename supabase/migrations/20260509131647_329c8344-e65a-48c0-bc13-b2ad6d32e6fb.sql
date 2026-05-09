CREATE OR REPLACE FUNCTION public._phase2b_run_trigger_proof()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match uuid; v_org_a uuid; v_user uuid; v_ch uuid;
  v_pass int := 0; v_fail int := 0;
  v_results jsonb := '[]'::jsonb;
  v_status text; v_outcome text; v_sumlen int;
  v_err text;
BEGIN
  SELECT id, buyer_org_id INTO v_match, v_org_a
    FROM matches WHERE buyer_org_id IS NOT NULL AND seller_org_id IS NOT NULL LIMIT 1;
  SELECT id INTO v_user FROM profiles LIMIT 1;

  INSERT INTO match_challenges (
    match_id, org_id, raised_by_org_id, raised_by_user_id, raised_by_role,
    subject_code, summary
  ) VALUES (
    v_match, v_org_a, v_org_a, v_user, 'buyer_org_admin', 'terms_disagreement',
    'Phase 2b live proof seed for trigger surface — drives the lifecycle through immutability and state-machine checks.'
  ) RETURNING id INTO v_ch;

  -- Helper: each block tries an UPDATE, captures SQLERRM, and records pass/fail.
  -- expect_block=true means we want it to FAIL.

  -- U1a immutable match_id
  v_err := NULL;
  BEGIN UPDATE match_challenges SET match_id = gen_random_uuid() WHERE id = v_ch; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NOT NULL THEN v_pass := v_pass+1; v_results := v_results || jsonb_build_object('case','U1a immutable match_id','verdict','PASS','error',v_err);
  ELSE v_fail := v_fail+1; v_results := v_results || jsonb_build_object('case','U1a immutable match_id','verdict','FAIL'); END IF;

  -- U1b immutable summary
  v_err := NULL;
  BEGIN UPDATE match_challenges SET summary = repeat('x',80) WHERE id = v_ch; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NOT NULL THEN v_pass := v_pass+1; v_results := v_results || jsonb_build_object('case','U1b immutable summary','verdict','PASS','error',v_err);
  ELSE v_fail := v_fail+1; v_results := v_results || jsonb_build_object('case','U1b immutable summary','verdict','FAIL'); END IF;

  -- U1c immutable raised_by_role
  v_err := NULL;
  BEGIN UPDATE match_challenges SET raised_by_role = 'platform_admin' WHERE id = v_ch; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NOT NULL THEN v_pass := v_pass+1; v_results := v_results || jsonb_build_object('case','U1c immutable raised_by_role','verdict','PASS','error',v_err);
  ELSE v_fail := v_fail+1; v_results := v_results || jsonb_build_object('case','U1c immutable raised_by_role','verdict','FAIL'); END IF;

  -- U4a open->outcome direct invalid
  v_err := NULL;
  BEGIN UPDATE match_challenges SET status='outcome_recorded', outcome_code='no_action_required', outcome_summary=repeat('y',80) WHERE id = v_ch; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NOT NULL THEN v_pass := v_pass+1; v_results := v_results || jsonb_build_object('case','U4a open->outcome direct invalid','verdict','PASS','error',v_err);
  ELSE v_fail := v_fail+1; v_results := v_results || jsonb_build_object('case','U4a open->outcome direct invalid','verdict','FAIL'); END IF;

  -- U3a open->under_review valid
  v_err := NULL;
  BEGIN UPDATE match_challenges SET status='under_review' WHERE id = v_ch; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass+1; v_results := v_results || jsonb_build_object('case','U3a open->under_review valid','verdict','PASS');
  ELSE v_fail := v_fail+1; v_results := v_results || jsonb_build_object('case','U3a open->under_review valid','verdict','FAIL','error',v_err); END IF;

  -- U4b under_review->open invalid
  v_err := NULL;
  BEGIN UPDATE match_challenges SET status='open' WHERE id = v_ch; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NOT NULL THEN v_pass := v_pass+1; v_results := v_results || jsonb_build_object('case','U4b under_review->open invalid','verdict','PASS','error',v_err);
  ELSE v_fail := v_fail+1; v_results := v_results || jsonb_build_object('case','U4b under_review->open invalid','verdict','FAIL'); END IF;

  -- U4c outcome+withdrawn code invalid
  v_err := NULL;
  BEGIN UPDATE match_challenges SET status='outcome_recorded', outcome_code='withdrawn_by_raiser', outcome_summary=repeat('z',80) WHERE id = v_ch; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NOT NULL THEN v_pass := v_pass+1; v_results := v_results || jsonb_build_object('case','U4c outcome+withdrawn code invalid','verdict','PASS','error',v_err);
  ELSE v_fail := v_fail+1; v_results := v_results || jsonb_build_object('case','U4c outcome+withdrawn code invalid','verdict','FAIL'); END IF;

  -- U4d closed_no_action <40 chars invalid
  v_err := NULL;
  BEGIN UPDATE match_challenges SET status='outcome_recorded', outcome_code='no_action_required', outcome_summary='too short' WHERE id = v_ch; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NOT NULL THEN v_pass := v_pass+1; v_results := v_results || jsonb_build_object('case','U4d closed_no_action <40 chars invalid','verdict','PASS','error',v_err);
  ELSE v_fail := v_fail+1; v_results := v_results || jsonb_build_object('case','U4d closed_no_action <40 chars invalid','verdict','FAIL'); END IF;

  -- U3b legitimate close
  v_err := NULL;
  BEGIN UPDATE match_challenges SET status='outcome_recorded', outcome_code='corrected_and_proceed', outcome_summary='Counterparty supplied an updated incoterm clarification — both sides confirmed.' WHERE id = v_ch; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass+1; v_results := v_results || jsonb_build_object('case','U3b legitimate close','verdict','PASS');
  ELSE v_fail := v_fail+1; v_results := v_results || jsonb_build_object('case','U3b legitimate close','verdict','FAIL','error',v_err); END IF;

  -- U2 terminal cannot transition
  v_err := NULL;
  BEGIN UPDATE match_challenges SET status='under_review' WHERE id = v_ch; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS NOT NULL THEN v_pass := v_pass+1; v_results := v_results || jsonb_build_object('case','U2 terminal cannot transition','verdict','PASS','error',v_err);
  ELSE v_fail := v_fail+1; v_results := v_results || jsonb_build_object('case','U2 terminal cannot transition','verdict','FAIL'); END IF;

  SELECT status, outcome_code, length(outcome_summary)
    INTO v_status, v_outcome, v_sumlen
    FROM match_challenges WHERE id = v_ch;

  DELETE FROM match_challenge_evidence WHERE challenge_id = v_ch;
  DELETE FROM match_challenge_comments WHERE challenge_id = v_ch;
  DELETE FROM match_challenges WHERE id = v_ch;

  RETURN jsonb_build_object(
    'pass', v_pass, 'fail', v_fail,
    'final_status', v_status, 'final_outcome', v_outcome, 'final_summary_len', v_sumlen,
    'results', v_results
  );
END $$;

REVOKE EXECUTE ON FUNCTION public._phase2b_run_trigger_proof() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._phase2b_run_trigger_proof() TO service_role;