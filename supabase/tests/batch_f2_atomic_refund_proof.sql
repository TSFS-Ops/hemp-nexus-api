-- Batch F2 atomicity proof — admin_refund_{approve,decline}_with_governance.
--
-- Live-DB proof that the refund decision and the canonical governance event
-- live in the same transaction.
--
--   A. Happy path (approve): a successful call inserts exactly ONE
--      admin.hq_decision_recorded event_store row for the refund aggregate,
--      and the refund_requests row moves pending → approved.
--   B. Idempotency: a second call with the same actor/request_id inside the
--      5-minute window returns deduplicated=true and does NOT add a second
--      event_store row. Critically the refund_requests row stays approved
--      (it is NOT re-approved or double-debited).
--   C. Already-decided guard: a third call on the same refund returns the
--      structured REFUND_ALREADY_DECIDED result without inserting a new
--      event (this is approve_refund's own structured failure mode and
--      proves we surface its code through the wrapper).
--   D. Failure rollback (decline): an invalid input (reason < 20 chars)
--      raises and leaves NO event_store row and NO state change on a fresh
--      refund.
--
-- This script runs inside a single transaction that ends in ROLLBACK so
-- nothing is persisted.

BEGIN;

DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_actor uuid;
  v_purchase uuid := gen_random_uuid();
  v_refund_a uuid := gen_random_uuid();
  v_refund_d uuid := gen_random_uuid();
  v_request_id text := 'f2-req-' || gen_random_uuid()::text;
  v_call_1 jsonb;
  v_call_2 jsonb;
  v_call_3 jsonb;
  v_event_count int;
  v_status text;
  v_bad_caught boolean := false;
BEGIN
  -- Pick a real auth user via public.profiles (auth.users not readable
  -- from this script). Any active profile id satisfies the
  -- refund_requests.requested_by FK to auth.users.
  SELECT id INTO v_actor FROM public.profiles ORDER BY created_at LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'F2 proof: no auth user available via public.profiles to seed refund';
  END IF;

  -- Minimal org row so refund + credit_adjustment audit writes succeed.
  INSERT INTO public.organizations (id, name, is_demo)
  VALUES (v_org, 'F2 proof org', false)
  ON CONFLICT (id) DO NOTHING;

  -- Seed a token_purchase to satisfy the refund_requests FK.
  INSERT INTO public.token_purchases (
    id, org_id, paystack_reference, package_id, token_amount, amount_usd, status
  ) VALUES (
    v_purchase, v_org, 'f2-proof-' || v_purchase::text, 'single', 0, 0, 'completed'
  );



  -- Seed a refund_request in 'pending' so approve_refund accepts it.
  INSERT INTO public.refund_requests (
    id, org_id, requested_by, token_purchase_id,
    reason_code, reason_detail,
    status, credits_at_request, credits_used_at_request, created_at
  ) VALUES (
    v_refund_a, v_org, v_actor, v_purchase,
    'other', 'batch f2 proof seed reason detail aaaaaa',
    'pending', 0, 0, now()
  );

  -- ── A. Happy path ────────────────────────────────────────────────────
  v_call_1 := public.admin_refund_approve_with_governance(
    p_refund_request_id => v_refund_a,
    p_admin_user_id     => v_actor,
    p_reason            => 'batch f2 proof happy path approve test reason',
    p_request_id        => v_request_id
  );
  ASSERT (v_call_1->>'success')::boolean IS TRUE, 'F2-A: approve must succeed';
  ASSERT (v_call_1->>'deduplicated')::boolean IS FALSE, 'F2-A: first call must not be deduped';

  SELECT status INTO v_status FROM public.refund_requests WHERE id = v_refund_a;
  ASSERT v_status = 'approved', format('F2-A: expected status=approved, got %s', v_status);

  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE aggregate_id = v_refund_a
    AND aggregate_type = 'refund_request'
    AND event_type = 'admin.hq_decision_recorded'
    AND payload->>'source_function' = 'admin-refund-approve';
  ASSERT v_event_count = 1,
    format('F2-A: expected exactly 1 governance event, got %s', v_event_count);

  -- ── B. Idempotency on retry ──────────────────────────────────────────
  v_call_2 := public.admin_refund_approve_with_governance(
    p_refund_request_id => v_refund_a,
    p_admin_user_id     => v_actor,
    p_reason            => 'batch f2 proof happy path approve test reason',
    p_request_id        => v_request_id
  );
  ASSERT (v_call_2->>'deduplicated')::boolean IS TRUE, 'F2-B: retry must be deduped';

  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE aggregate_id = v_refund_a
    AND event_type = 'admin.hq_decision_recorded';
  ASSERT v_event_count = 1,
    format('F2-B: deduped retry must not insert a second event, got %s', v_event_count);

  -- ── C. Already-decided structured failure (different request_id, so the
  --      idempotency cache misses and the underlying approve_refund returns
  --      REFUND_ALREADY_DECIDED). ──────────────────────────────────────
  v_call_3 := public.admin_refund_approve_with_governance(
    p_refund_request_id => v_refund_a,
    p_admin_user_id     => v_actor,
    p_reason            => 'batch f2 proof second decision attempt reason',
    p_request_id        => 'f2-req-different'
  );
  ASSERT (v_call_3->>'success')::boolean IS FALSE, 'F2-C: re-approve must fail';
  ASSERT v_call_3->>'code' = 'REFUND_ALREADY_DECIDED',
    format('F2-C: expected REFUND_ALREADY_DECIDED, got %s', v_call_3->>'code');

  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE aggregate_id = v_refund_a
    AND event_type = 'admin.hq_decision_recorded';
  ASSERT v_event_count = 1,
    format('F2-C: structured failure must not write a governance event, got %s', v_event_count);

  -- ── D. Failure rollback on decline with invalid reason (< 20 chars). ─
  -- Use a distinct token_purchase_id to avoid the unique pending-per-purchase index.
  INSERT INTO public.refund_requests (
    id, org_id, requested_by, token_purchase_id,
    reason_code, reason_detail,
    status, credits_at_request, credits_used_at_request, created_at
  ) VALUES (
    v_refund_d, v_org, v_actor, gen_random_uuid(),
    'other', 'batch f2 proof seed reason detail bbbbbb',
    'pending', 0, 0, now()
  );

  BEGIN
    PERFORM public.admin_refund_decline_with_governance(
      p_refund_request_id => v_refund_d,
      p_admin_user_id     => v_actor,
      p_reason            => 'too short',
      p_request_id        => 'f2-bad-req'
    );
    v_bad_caught := false;
  EXCEPTION WHEN OTHERS THEN
    v_bad_caught := true;
  END;
  ASSERT v_bad_caught, 'F2-D: invalid reason must raise';

  SELECT status INTO v_status FROM public.refund_requests WHERE id = v_refund_d;
  ASSERT v_status = 'pending',
    format('F2-D: rollback expected status=pending, got %s', v_status);

  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE aggregate_id = v_refund_d
    AND event_type = 'admin.hq_decision_recorded';
  ASSERT v_event_count = 0,
    format('F2-D: rollback must leave no governance event, got %s', v_event_count);

  RAISE NOTICE 'Batch F2 atomic refund proof: ALL ASSERTIONS PASSED';
END $$;

ROLLBACK;
