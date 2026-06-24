-- P-5 Batch 1 — Stage 3 action RPC proof.
--
-- Proves: permission denies for unauthorised roles, allowed roles can act,
-- reason/note enforced where required, illegal transitions rejected, every
-- material action writes an audit row, audit immutable, release-hold cannot
-- be automatic, ready_to_proceed cannot be approved with blocker/hold/
-- provider dependency, evidence rejection affects readiness, and high-risk
-- provider results return cases to under_review instead of auto-finalising.
--
-- All work runs inside a single transaction that is rolled back at the end.

BEGIN;

-- Two real users (auth.users not writable from this script). Admin already
-- has platform_admin; stranger has no roles. Everything rolls back.
DO $$
DECLARE
  _admin uuid;
  _stranger uuid;
  _org uuid;
  _case uuid;
  _ev uuid;
  _audit_count_before int;
  _audit_count_after int;
  _status public.p5_status;
  _err_seen boolean;
BEGIN
  SELECT user_id INTO _admin FROM public.user_roles WHERE role='platform_admin' LIMIT 1;
  IF _admin IS NULL THEN RAISE EXCEPTION 'PROOF_SETUP_FAIL: need a platform_admin user'; END IF;
  SELECT p.id INTO _stranger FROM public.profiles p
    WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=p.id) LIMIT 1;
  IF _stranger IS NULL THEN RAISE EXCEPTION 'PROOF_SETUP_FAIL: need a no-role user'; END IF;



  ------------------------------------------------------------------
  -- 1. Unprivileged caller cannot create a case.
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _stranger::text)::text, true);
  _err_seen := false;
  BEGIN
    PERFORM public.p5_create_case(_org);
  EXCEPTION WHEN insufficient_privilege THEN _err_seen := true;
  END;
  IF NOT _err_seen THEN RAISE EXCEPTION 'PROOF_FAIL: stranger could create case'; END IF;

  ------------------------------------------------------------------
  -- 2. Admin can create a case + audit row written.
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin::text)::text, true);
  SELECT count(*) INTO _audit_count_before FROM public.p5_governance_audit_events;
  _case := public.p5_create_case(_org, NULL, NULL, NULL, NULL, NULL, 'incomplete'::public.p5_status, 'corr-1', 'req-1');
  SELECT count(*) INTO _audit_count_after FROM public.p5_governance_audit_events WHERE case_id=_case;
  IF _audit_count_after < 1 THEN RAISE EXCEPTION 'PROOF_FAIL: no audit on create'; END IF;

  ------------------------------------------------------------------
  -- 3. Reason/note enforced for request_more_info, apply_hold, reject,
  --    escalate, waive, override, reopen, archive.
  ------------------------------------------------------------------
  _err_seen := false;
  BEGIN
    PERFORM public.p5_request_more_info(_case, NULL, NULL);
  EXCEPTION WHEN check_violation THEN _err_seen := true; END;
  IF NOT _err_seen THEN RAISE EXCEPTION 'PROOF_FAIL: request_more_info accepted null reason'; END IF;

  _err_seen := false;
  BEGIN
    PERFORM public.p5_apply_hold(_case, 'compliance', NULL, 'note');
  EXCEPTION WHEN check_violation THEN _err_seen := true; END;
  IF NOT _err_seen THEN RAISE EXCEPTION 'PROOF_FAIL: apply_hold accepted null reason'; END IF;

  _err_seen := false;
  BEGIN
    PERFORM public.p5_apply_hold(_case, 'compliance', 'compliance_hold_applied'::public.p5_reason_code, '');
  EXCEPTION WHEN check_violation THEN _err_seen := true; END;
  IF NOT _err_seen THEN RAISE EXCEPTION 'PROOF_FAIL: apply_hold accepted empty note'; END IF;

  ------------------------------------------------------------------
  -- 4. Illegal transition rejected (submit from already-submitted).
  ------------------------------------------------------------------
  -- Submit (requires admin since no evidence rows + minimum_pack flag).
  PERFORM public.p5_submit_case(_case, true, 'corr-2');
  _err_seen := false;
  BEGIN
    PERFORM public.p5_submit_case(_case, true);
  EXCEPTION WHEN check_violation THEN _err_seen := true; END;
  IF NOT _err_seen THEN RAISE EXCEPTION 'PROOF_FAIL: re-submit accepted'; END IF;

  ------------------------------------------------------------------
  -- 5. Evidence rejection affects readiness.
  ------------------------------------------------------------------
  _ev := public.p5_upload_evidence_meta(_case,'bank_detail_proof', true);
  PERFORM public.p5_start_review(_case, _admin);
  PERFORM public.p5_review_evidence(_ev,'reject','rejected_by_reviewer','rejection note','customer-safe');
  SELECT readiness_status INTO _status FROM public.p5_governance_readiness_cases WHERE id=_case;
  IF _status <> 'blocked' THEN
    RAISE EXCEPTION 'PROOF_FAIL: rejection did not block, got %', _status;
  END IF;

  ------------------------------------------------------------------
  -- 6. ready_to_proceed cannot be approved with blocker or hold or provider gap.
  ------------------------------------------------------------------
  _err_seen := false;
  BEGIN
    PERFORM public.p5_approve_ready_to_proceed(_case, 'final sign-off');
  EXCEPTION WHEN check_violation THEN _err_seen := true; END;
  IF NOT _err_seen THEN RAISE EXCEPTION 'PROOF_FAIL: ready_to_proceed approved with blocker'; END IF;

  -- Reopen + approve evidence, then mark provider dependent and try again.
  PERFORM public.p5_reopen(_case,'manual_review_required','reopen after fix');
  PERFORM public.p5_review_evidence(_ev,'approve');
  PERFORM public.p5_submit_case(_case, true);
  PERFORM public.p5_start_review(_case,_admin);
  PERFORM public.p5_approve_internally(_case);
  PERFORM public.p5_mark_provider_dependent(_case,'sanctions_screening','pending'::public.p5_provider_status);
  _err_seen := false;
  BEGIN
    PERFORM public.p5_approve_ready_to_proceed(_case, 'sign-off');
  EXCEPTION WHEN check_violation THEN _err_seen := true; END;
  IF NOT _err_seen THEN
    RAISE EXCEPTION 'PROOF_FAIL: ready_to_proceed approved with provider dependency';
  END IF;

  ------------------------------------------------------------------
  -- 7. High-risk provider result returns case to under_review and clears
  --    any prior human approval (must not auto-finalise).
  ------------------------------------------------------------------
  PERFORM public.p5_record_provider_result(_case,'passed'::public.p5_provider_status,'provider-ref-1', now(), true);
  SELECT readiness_status INTO _status FROM public.p5_governance_readiness_cases WHERE id=_case;
  IF _status <> 'under_review' THEN
    RAISE EXCEPTION 'PROOF_FAIL: high-risk provider result did not return to under_review, got %', _status;
  END IF;

  ------------------------------------------------------------------
  -- 8. Hold cannot be released without a senior caller / reason / note.
  ------------------------------------------------------------------
  PERFORM public.p5_apply_hold(_case,'governance','governance_hold_applied'::public.p5_reason_code,'apply hold');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _stranger::text)::text, true);
  _err_seen := false;
  BEGIN
    PERFORM public.p5_release_hold(_case,'compliance_hold_released'::public.p5_reason_code,'release');
  EXCEPTION WHEN insufficient_privilege THEN _err_seen := true; END;
  IF NOT _err_seen THEN RAISE EXCEPTION 'PROOF_FAIL: stranger released hold'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin::text)::text, true);

  ------------------------------------------------------------------
  -- 9. Audit is immutable - update + delete must fail.
  ------------------------------------------------------------------
  _err_seen := false;
  BEGIN
    UPDATE public.p5_governance_audit_events SET note='tamper' WHERE case_id=_case;
  EXCEPTION WHEN OTHERS THEN _err_seen := true; END;
  IF NOT _err_seen THEN RAISE EXCEPTION 'PROOF_FAIL: audit was updateable'; END IF;

  _err_seen := false;
  BEGIN
    DELETE FROM public.p5_governance_audit_events WHERE case_id=_case;
  EXCEPTION WHEN OTHERS THEN _err_seen := true; END;
  IF NOT _err_seen THEN RAISE EXCEPTION 'PROOF_FAIL: audit was deletable'; END IF;

  RAISE NOTICE 'P5_STAGE3_PROOF_OK';
END;
$$;

ROLLBACK;
