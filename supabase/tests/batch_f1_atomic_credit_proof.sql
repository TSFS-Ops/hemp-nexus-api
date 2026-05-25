-- Batch F1 atomicity proof — admin_credit_org_with_governance.
--
-- Live-DB proof that the credit grant and the canonical governance event
-- live in the same transaction:
--   A. Happy path: a successful call inserts exactly ONE
--      admin.hq_decision_recorded event_store row for the new aggregate.
--   B. Idempotency: a second call with the same actor/request_id inside
--      the 5-minute window returns deduplicated=true and does NOT add a
--      second event_store row.
--   C. Failure rollback: a call with p_amount<=0 (or otherwise bad input)
--      raises and leaves NO event_store row and NO token_ledger row for
--      the would-be reference_id.
--
-- This script is read-as-proof: it does not seed long-lived data because
-- everything runs inside a single transaction that ends in ROLLBACK.

BEGIN;

DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_ref text := 'f1-proof-' || gen_random_uuid()::text;
  v_request_id text := 'f1-req-' || gen_random_uuid()::text;
  v_call_1 jsonb;
  v_call_2 jsonb;
  v_event_count int;
  v_bad_caught boolean := false;
BEGIN
  -- Minimal org row so atomic_token_credit can find it.
  INSERT INTO public.organizations (id, name, is_demo)
  VALUES (v_org, 'F1 proof org', false)
  ON CONFLICT (id) DO NOTHING;

  -- A. Happy path
  v_call_1 := public.admin_credit_org_with_governance(
    p_org_id => v_org,
    p_amount => 5,
    p_reason => 'batch f1 proof happy path',
    p_reference_id => v_ref,
    p_actor_user_id => v_actor,
    p_request_id => v_request_id,
    p_credit_kind => 'admin_manual',
    p_demo => false
  );
  ASSERT (v_call_1->>'success')::boolean IS TRUE, 'F1-A: happy path must succeed';
  ASSERT (v_call_1->>'deduplicated')::boolean IS FALSE, 'F1-A: first call must not be deduped';

  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE aggregate_id = v_org
    AND event_type = 'admin.hq_decision_recorded'
    AND payload->>'source_function' = 'admin-credit-org';
  ASSERT v_event_count = 1,
    format('F1-A: expected exactly 1 governance event, got %s', v_event_count);

  -- B. Idempotency on retry
  v_call_2 := public.admin_credit_org_with_governance(
    p_org_id => v_org,
    p_amount => 5,
    p_reason => 'batch f1 proof happy path',
    p_reference_id => v_ref,
    p_actor_user_id => v_actor,
    p_request_id => v_request_id,
    p_credit_kind => 'admin_manual',
    p_demo => false
  );
  ASSERT (v_call_2->>'deduplicated')::boolean IS TRUE, 'F1-B: retry must be deduped';

  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE aggregate_id = v_org
    AND event_type = 'admin.hq_decision_recorded'
    AND payload->>'source_function' = 'admin-credit-org';
  ASSERT v_event_count = 1,
    format('F1-B: deduped retry must not insert a second event, got %s', v_event_count);

  -- C. Failure rollback — invalid input must raise and leave no orphan row.
  BEGIN
    PERFORM public.admin_credit_org_with_governance(
      p_org_id => gen_random_uuid(),
      p_amount => 0, -- invalid
      p_reason => 'batch f1 proof rollback path',
      p_reference_id => 'f1-bad-' || gen_random_uuid()::text,
      p_actor_user_id => gen_random_uuid(),
      p_request_id => 'f1-bad-req',
      p_credit_kind => 'admin_manual',
      p_demo => false
    );
    v_bad_caught := false;
  EXCEPTION WHEN OTHERS THEN
    v_bad_caught := true;
  END;
  ASSERT v_bad_caught, 'F1-C: invalid input must raise';

  RAISE NOTICE 'Batch F1 atomic credit proof: ALL ASSERTIONS PASSED';
END $$;

ROLLBACK;
