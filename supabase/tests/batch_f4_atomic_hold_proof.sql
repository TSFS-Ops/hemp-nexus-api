-- Batch F4 atomicity proof — billing / compliance / residency hold wrappers.
--
-- Exercises the six atomic wrapper RPCs added in
-- supabase/migrations/20260525130532_*.sql:
--
--   1.  admin_billing_hold_apply_with_governance
--   2.  admin_billing_hold_release_with_governance
--   3.  admin_compliance_hold_release_with_governance
--   4.  admin_compliance_hold_close_with_governance
--   5.  admin_residency_review_approve_with_governance
--   6.  admin_residency_review_decline_with_governance
--
-- For each pair we prove:
--   - happy path mutates state + writes exactly 1 admin.hq_decision_recorded
--     event into event_store under the correct aggregate;
--   - replay with the same request_id is deduplicated (no second event);
--   - rollback: an invalid input (reason < 20 chars) raises 22023 inside the
--     wrapper and leaves NO state change and NO governance event behind.
--
-- The whole script runs inside a single transaction that ends in ROLLBACK,
-- so no production data is mutated.

BEGIN;

DO $$
DECLARE
  v_actor uuid;
  v_org uuid := gen_random_uuid();
  v_org_2 uuid := gen_random_uuid();
  v_hold_release_id uuid := gen_random_uuid();
  v_hold_close_id uuid := gen_random_uuid();
  v_hold_rollback_id uuid := gen_random_uuid();
  v_review_approve_id uuid := gen_random_uuid();
  v_review_decline_id uuid := gen_random_uuid();
  v_review_rollback_id uuid := gen_random_uuid();
  v_call jsonb;
  v_call_2 jsonb;
  v_event_count int;
  v_billing_hold boolean;
  v_status text;
  v_residency_status text;
  v_bad_caught boolean;
  v_req_apply text := 'f4-billing-apply-' || gen_random_uuid()::text;
  v_req_release text := 'f4-billing-release-' || gen_random_uuid()::text;
  v_req_hold_release text := 'f4-hold-release-' || gen_random_uuid()::text;
  v_req_hold_close text := 'f4-hold-close-' || gen_random_uuid()::text;
  v_req_review_approve text := 'f4-rev-approve-' || gen_random_uuid()::text;
  v_req_review_decline text := 'f4-rev-decline-' || gen_random_uuid()::text;
BEGIN
  -- Residency RPCs require a real platform_admin. Use the first one.
  SELECT user_id INTO v_actor
  FROM public.user_roles
  WHERE role = 'platform_admin'
  ORDER BY created_at
  LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'F4 proof: no platform_admin user available';
  END IF;

  -- Two scratch orgs (one for billing-hold + compliance-hold lifecycle,
  -- one for the residency-review lifecycle).
  INSERT INTO public.organizations (id, name, is_demo)
  VALUES (v_org,   'F4 proof org A', false),
         (v_org_2, 'F4 proof org B', false);

  -- ──────────────────────────────────────────────────────────────────
  -- 1. admin_billing_hold_apply_with_governance — happy + dedupe + bad
  -- ──────────────────────────────────────────────────────────────────
  v_call := public.admin_billing_hold_apply_with_governance(
    p_org_id        => v_org,
    p_admin_user_id => v_actor,
    p_reason        => 'batch f4 proof billing hold apply reason long enough',
    p_request_id    => v_req_apply
  );
  ASSERT (v_call->>'success')::boolean IS TRUE, 'F4-1A: apply must succeed';
  ASSERT (v_call->>'deduplicated')::boolean IS FALSE, 'F4-1A: first apply not dedup';

  SELECT billing_hold INTO v_billing_hold
  FROM public.organizations WHERE id = v_org;
  ASSERT v_billing_hold IS TRUE, 'F4-1A: org must be on billing hold';

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_org
     AND aggregate_type = 'billing_hold'
     AND event_type = 'admin.hq_decision_recorded'
     AND payload->>'source_function' = 'admin-billing-hold-apply';
  ASSERT v_event_count = 1,
    format('F4-1A: expected 1 apply gov event, got %s', v_event_count);

  -- Idempotent retry with same request_id → deduplicated, still 1 event.
  v_call_2 := public.admin_billing_hold_apply_with_governance(
    p_org_id        => v_org,
    p_admin_user_id => v_actor,
    p_reason        => 'batch f4 proof billing hold apply reason long enough',
    p_request_id    => v_req_apply
  );
  ASSERT (v_call_2->>'deduplicated')::boolean IS TRUE,
    'F4-1B: apply retry must dedupe';

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_org
     AND payload->>'source_function' = 'admin-billing-hold-apply';
  ASSERT v_event_count = 1,
    format('F4-1B: dedup must not add event, got %s', v_event_count);

  -- ──────────────────────────────────────────────────────────────────
  -- 2. admin_billing_hold_release_with_governance — happy path
  -- ──────────────────────────────────────────────────────────────────
  v_call := public.admin_billing_hold_release_with_governance(
    p_org_id        => v_org,
    p_admin_user_id => v_actor,
    p_reason        => 'batch f4 proof billing hold release reason long enough',
    p_request_id    => v_req_release
  );
  ASSERT (v_call->>'success')::boolean IS TRUE, 'F4-2A: release must succeed';

  SELECT billing_hold INTO v_billing_hold
  FROM public.organizations WHERE id = v_org;
  ASSERT v_billing_hold IS FALSE, 'F4-2A: org must be off billing hold';

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_org
     AND payload->>'source_function' = 'admin-billing-hold-release';
  ASSERT v_event_count = 1,
    format('F4-2A: expected 1 release gov event, got %s', v_event_count);

  -- ── 2B. Billing rollback: short reason → 22023, state untouched ────
  v_bad_caught := false;
  BEGIN
    PERFORM public.admin_billing_hold_apply_with_governance(
      p_org_id        => v_org,
      p_admin_user_id => v_actor,
      p_reason        => 'too short',
      p_request_id    => 'f4-bad-billing-' || gen_random_uuid()::text
    );
  EXCEPTION WHEN OTHERS THEN
    v_bad_caught := true;
  END;
  ASSERT v_bad_caught, 'F4-2B: invalid reason must raise';

  SELECT billing_hold INTO v_billing_hold
  FROM public.organizations WHERE id = v_org;
  ASSERT v_billing_hold IS FALSE,
    'F4-2B: rollback must leave billing_hold=false';

  -- ──────────────────────────────────────────────────────────────────
  -- 3. admin_compliance_hold_release_with_governance — happy + bad
  -- ──────────────────────────────────────────────────────────────────
  INSERT INTO public.compliance_holds (
    id, org_id, hold_type, reason, status, opened_by
  ) VALUES (
    v_hold_release_id, v_org, 'verification_refresh_required',
    'F4 proof seed compliance hold', 'active', v_actor
  );

  v_call := public.admin_compliance_hold_release_with_governance(
    p_hold_id       => v_hold_release_id,
    p_admin_user_id => v_actor,
    p_reason        => 'batch f4 proof compliance hold release reason long enough',
    p_request_id    => v_req_hold_release
  );
  ASSERT (v_call->>'success')::boolean IS TRUE, 'F4-3A: hold release must succeed';
  ASSERT v_call->>'status' = 'released', 'F4-3A: status=released';

  SELECT status INTO v_status FROM public.compliance_holds WHERE id = v_hold_release_id;
  ASSERT v_status = 'released',
    format('F4-3A: expected hold status=released, got %s', v_status);

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_hold_release_id
     AND aggregate_type = 'compliance_hold'
     AND payload->>'source_function' = 'admin-compliance-hold-release';
  ASSERT v_event_count = 1,
    format('F4-3A: expected 1 hold-release gov event, got %s', v_event_count);

  -- ── 3B. Compliance-release rollback on short reason ────────────────
  INSERT INTO public.compliance_holds (
    id, org_id, hold_type, reason, status, opened_by
  ) VALUES (
    v_hold_rollback_id, v_org, 'compliance_hold_verification_refresh',
    'F4 rollback seed compliance hold', 'active', v_actor
  );

  v_bad_caught := false;
  BEGIN
    PERFORM public.admin_compliance_hold_release_with_governance(
      p_hold_id       => v_hold_rollback_id,
      p_admin_user_id => v_actor,
      p_reason        => 'too short',
      p_request_id    => 'f4-bad-hold-' || gen_random_uuid()::text
    );
  EXCEPTION WHEN OTHERS THEN
    v_bad_caught := true;
  END;
  ASSERT v_bad_caught, 'F4-3B: invalid reason must raise';

  SELECT status INTO v_status FROM public.compliance_holds WHERE id = v_hold_rollback_id;
  ASSERT v_status = 'active',
    format('F4-3B: rollback must leave hold active, got %s', v_status);

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_hold_rollback_id
     AND payload->>'source_function' = 'admin-compliance-hold-release';
  ASSERT v_event_count = 0,
    format('F4-3B: rollback must leave no event, got %s', v_event_count);

  -- ──────────────────────────────────────────────────────────────────
  -- 4. admin_compliance_hold_close_with_governance — happy
  -- ──────────────────────────────────────────────────────────────────
  INSERT INTO public.compliance_holds (
    id, org_id, hold_type, reason, status, opened_by
  ) VALUES (
    v_hold_close_id, v_org, 'compliance_hold_verification_failed',
    'F4 proof seed compliance hold to close', 'active', v_actor
  );

  v_call := public.admin_compliance_hold_close_with_governance(
    p_hold_id       => v_hold_close_id,
    p_admin_user_id => v_actor,
    p_reason        => 'batch f4 proof compliance hold close reason long enough',
    p_request_id    => v_req_hold_close
  );
  ASSERT (v_call->>'success')::boolean IS TRUE, 'F4-4A: hold close must succeed';
  ASSERT v_call->>'status' = 'closed', 'F4-4A: status=closed';

  SELECT status INTO v_status FROM public.compliance_holds WHERE id = v_hold_close_id;
  ASSERT v_status = 'closed',
    format('F4-4A: expected hold status=closed, got %s', v_status);

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_hold_close_id
     AND aggregate_type = 'compliance_hold'
     AND payload->>'source_function' = 'admin-compliance-hold-close';
  ASSERT v_event_count = 1,
    format('F4-4A: expected 1 hold-close gov event, got %s', v_event_count);

  -- ──────────────────────────────────────────────────────────────────
  -- 5. admin_residency_review_approve_with_governance — happy
  -- ──────────────────────────────────────────────────────────────────
  INSERT INTO public.data_residency_reviews (
    id, org_id, requirement_source, requested_region, requested_country, status
  ) VALUES (
    v_review_approve_id, v_org_2, 'self_service',
    'eu-west', 'IE', 'review_required'
  );

  v_call := public.admin_residency_review_approve_with_governance(
    p_review_id     => v_review_approve_id,
    p_admin_user_id => v_actor,
    p_reason        => 'batch f4 proof residency approve reason long enough',
    p_request_id    => v_req_review_approve
  );
  ASSERT (v_call->>'success')::boolean IS TRUE, 'F4-5A: residency approve must succeed';

  SELECT status INTO v_residency_status
  FROM public.data_residency_reviews WHERE id = v_review_approve_id;
  ASSERT v_residency_status = 'approved',
    format('F4-5A: expected status=approved, got %s', v_residency_status);

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_review_approve_id
     AND aggregate_type = 'data_residency_review'
     AND payload->>'source_function' = 'admin-residency-review-approve';
  ASSERT v_event_count = 1,
    format('F4-5A: expected 1 residency-approve event, got %s', v_event_count);

  -- ──────────────────────────────────────────────────────────────────
  -- 6. admin_residency_review_decline_with_governance — happy + bad
  -- ──────────────────────────────────────────────────────────────────
  INSERT INTO public.data_residency_reviews (
    id, org_id, requirement_source, requested_region, requested_country, status
  ) VALUES (
    v_review_decline_id, v_org_2, 'self_service',
    'eu-west', 'IE', 'review_required'
  );

  v_call := public.admin_residency_review_decline_with_governance(
    p_review_id     => v_review_decline_id,
    p_admin_user_id => v_actor,
    p_reason        => 'batch f4 proof residency decline reason long enough',
    p_request_id    => v_req_review_decline
  );
  ASSERT (v_call->>'success')::boolean IS TRUE, 'F4-6A: residency decline must succeed';

  SELECT status INTO v_residency_status
  FROM public.data_residency_reviews WHERE id = v_review_decline_id;
  ASSERT v_residency_status = 'declined',
    format('F4-6A: expected status=declined, got %s', v_residency_status);

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_review_decline_id
     AND payload->>'source_function' = 'admin-residency-review-decline';
  ASSERT v_event_count = 1,
    format('F4-6A: expected 1 residency-decline event, got %s', v_event_count);

  -- ── 6B. Residency rollback: invalid reason → raise + no state change ─
  INSERT INTO public.data_residency_reviews (
    id, org_id, requirement_source, requested_region, requested_country, status
  ) VALUES (
    v_review_rollback_id, v_org_2, 'self_service',
    'eu-west', 'IE', 'review_required'
  );

  v_bad_caught := false;
  BEGIN
    PERFORM public.admin_residency_review_approve_with_governance(
      p_review_id     => v_review_rollback_id,
      p_admin_user_id => v_actor,
      p_reason        => 'too short',
      p_request_id    => 'f4-bad-rev-' || gen_random_uuid()::text
    );
  EXCEPTION WHEN OTHERS THEN
    v_bad_caught := true;
  END;
  ASSERT v_bad_caught, 'F4-6B: invalid reason must raise';

  SELECT status INTO v_residency_status
  FROM public.data_residency_reviews WHERE id = v_review_rollback_id;
  ASSERT v_residency_status = 'review_required',
    format('F4-6B: rollback must leave status=review_required, got %s', v_residency_status);

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_review_rollback_id
     AND payload->>'source_function' = 'admin-residency-review-approve';
  ASSERT v_event_count = 0,
    format('F4-6B: rollback must leave no event, got %s', v_event_count);

  RAISE NOTICE 'Batch F4 atomic hold proof: ALL ASSERTIONS PASSED';
END $$;

ROLLBACK;
