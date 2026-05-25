-- Batch F3 atomicity proof — admin_payment_dispute_{record,resolve_won,resolve_lost}_with_governance.
--
--   A. record happy path: record returns success + creates exactly 1
--      admin.hq_decision_recorded event for the new dispute aggregate.
--   B. resolve-won happy path: dispute moves open→won + 1 new gov event.
--   C. resolve-won idempotency: retry with same request_id is deduped.
--   D. resolve-won already-resolved structured failure: returns
--      DISPUTE_ALREADY_RESOLVED, no extra gov event.
--   E. resolve-lost rollback: invalid reason raises; second dispute stays
--      open, no gov event.
--
-- Runs in one transaction that ends in ROLLBACK.

BEGIN;

DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_actor uuid;
  v_purchase uuid := gen_random_uuid();
  v_purchase_2 uuid := gen_random_uuid();
  v_dispute_id uuid;
  v_dispute_id_2 uuid;
  v_request_id text := 'f3-req-' || gen_random_uuid()::text;
  v_request_id_won text := 'f3-won-' || gen_random_uuid()::text;
  v_call jsonb;
  v_call_2 jsonb;
  v_call_3 jsonb;
  v_event_count int;
  v_status text;
  v_bad_caught boolean := false;
BEGIN
  SELECT id INTO v_actor FROM public.profiles ORDER BY created_at LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'F3 proof: no auth user available via public.profiles';
  END IF;

  INSERT INTO public.organizations (id, name, is_demo)
  VALUES (v_org, 'F3 proof org', false)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.token_purchases (
    id, org_id, paystack_reference, package_id, token_amount, amount_usd, status
  ) VALUES
    (v_purchase,   v_org, 'f3-proof-1-' || v_purchase::text,   'single', 0, 0, 'completed'),
    (v_purchase_2, v_org, 'f3-proof-2-' || v_purchase_2::text, 'single', 0, 0, 'completed');

  -- ── A. record happy path ────────────────────────────────────────────
  v_call := public.admin_payment_dispute_record_with_governance(
    p_org_id                    => v_org,
    p_token_purchase_id         => v_purchase,
    p_provider                  => 'paystack',
    p_provider_dispute_reference=> 'f3-dispute-' || gen_random_uuid()::text,
    p_credits_issued            => 0,
    p_admin_user_id             => v_actor,
    p_reason                    => 'batch f3 proof manual dispute record reason',
    p_request_id                => v_request_id
  );
  ASSERT (v_call->>'success')::boolean IS TRUE, 'F3-A: record must succeed';
  v_dispute_id := (v_call->>'payment_dispute_id')::uuid;
  ASSERT v_dispute_id IS NOT NULL, 'F3-A: dispute id must be returned';

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_dispute_id
     AND aggregate_type = 'payment_dispute'
     AND event_type = 'admin.hq_decision_recorded'
     AND payload->>'source_function' = 'admin-payment-dispute-record';
  ASSERT v_event_count = 1,
    format('F3-A: expected 1 gov event, got %s', v_event_count);

  -- ── B. resolve-won happy path ───────────────────────────────────────
  v_call_2 := public.admin_payment_dispute_resolve_won_with_governance(
    p_payment_dispute_id => v_dispute_id,
    p_admin_user_id      => v_actor,
    p_reason             => 'batch f3 proof resolve-won decision reason',
    p_request_id         => v_request_id_won
  );
  ASSERT (v_call_2->>'success')::boolean IS TRUE, 'F3-B: resolve-won must succeed';
  ASSERT (v_call_2->>'deduplicated')::boolean IS FALSE, 'F3-B: first resolve must not dedupe';

  SELECT status INTO v_status FROM public.payment_disputes WHERE id = v_dispute_id;
  ASSERT v_status = 'won', format('F3-B: expected status=won, got %s', v_status);

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_dispute_id
     AND payload->>'source_function' = 'admin-payment-dispute-resolve-won';
  ASSERT v_event_count = 1,
    format('F3-B: expected 1 resolve-won gov event, got %s', v_event_count);

  -- ── C. resolve-won idempotency ──────────────────────────────────────
  v_call_3 := public.admin_payment_dispute_resolve_won_with_governance(
    p_payment_dispute_id => v_dispute_id,
    p_admin_user_id      => v_actor,
    p_reason             => 'batch f3 proof resolve-won decision reason',
    p_request_id         => v_request_id_won
  );
  ASSERT (v_call_3->>'deduplicated')::boolean IS TRUE,
    'F3-C: retry with same request_id must be deduped';

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_dispute_id
     AND payload->>'source_function' = 'admin-payment-dispute-resolve-won';
  ASSERT v_event_count = 1,
    format('F3-C: deduped retry must not insert second event, got %s', v_event_count);

  -- ── D. resolve-won already-resolved structured failure (different
  --      request_id so idempotency cache misses and underlying RPC returns
  --      DISPUTE_ALREADY_RESOLVED). ──────────────────────────────────────
  v_call_3 := public.admin_payment_dispute_resolve_won_with_governance(
    p_payment_dispute_id => v_dispute_id,
    p_admin_user_id      => v_actor,
    p_reason             => 'batch f3 proof second resolve attempt reason',
    p_request_id         => 'f3-different-req'
  );
  ASSERT (v_call_3->>'success')::boolean IS FALSE, 'F3-D: re-resolve must fail';
  ASSERT v_call_3->>'code' = 'DISPUTE_ALREADY_RESOLVED',
    format('F3-D: expected DISPUTE_ALREADY_RESOLVED, got %s', v_call_3->>'code');

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_dispute_id
     AND payload->>'source_function' = 'admin-payment-dispute-resolve-won';
  ASSERT v_event_count = 1,
    format('F3-D: structured failure must not write extra event, got %s', v_event_count);

  -- ── E. resolve-lost rollback on invalid reason ──────────────────────
  -- Seed a second open dispute on the second purchase.
  v_call := public.admin_payment_dispute_record_with_governance(
    p_org_id                    => v_org,
    p_token_purchase_id         => v_purchase_2,
    p_provider                  => 'paystack',
    p_provider_dispute_reference=> 'f3-dispute-2-' || gen_random_uuid()::text,
    p_credits_issued            => 0,
    p_admin_user_id             => v_actor,
    p_reason                    => 'batch f3 proof second dispute record reason',
    p_request_id                => 'f3-rec-2'
  );
  v_dispute_id_2 := (v_call->>'payment_dispute_id')::uuid;
  ASSERT v_dispute_id_2 IS NOT NULL, 'F3-E: second dispute must be created';

  BEGIN
    PERFORM public.admin_payment_dispute_resolve_lost_with_governance(
      p_payment_dispute_id => v_dispute_id_2,
      p_admin_user_id      => v_actor,
      p_reason             => 'too short',
      p_request_id         => 'f3-bad-req'
    );
    v_bad_caught := false;
  EXCEPTION WHEN OTHERS THEN
    v_bad_caught := true;
  END;
  ASSERT v_bad_caught, 'F3-E: invalid reason must raise';

  SELECT status INTO v_status FROM public.payment_disputes WHERE id = v_dispute_id_2;
  ASSERT v_status = 'open',
    format('F3-E: rollback expected status=open, got %s', v_status);

  SELECT count(*) INTO v_event_count FROM public.event_store
   WHERE aggregate_id = v_dispute_id_2
     AND payload->>'source_function' = 'admin-payment-dispute-resolve-lost';
  ASSERT v_event_count = 0,
    format('F3-E: rollback must leave no resolve-lost event, got %s', v_event_count);

  RAISE NOTICE 'Batch F3 atomic payment-dispute proof: ALL ASSERTIONS PASSED';
END $$;

ROLLBACK;
