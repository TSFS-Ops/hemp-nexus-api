—……──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────—-- Refund provider-settlement separation — atomicity & integrity proof.
--
-- Live-DB proof, wrapped in BEGIN…ROLLBACK so nothing persists.
--
--   A. approve_refund sets provider_settlement_status='not_submitted'.
--   B. decline_refund sets provider_settlement_status='not_applicable'.
--   C. mark_refund_provider_settled is idempotent on the same provider
--      refund reference (second call returns deduplicated=true; no second
--      audit row; balance unchanged).
--   D. mark_refund_provider_settled rejects a conflicting reference and
--      opens a refund_settlement_conflict risk item.
--   E. mark_refund_manually_settled_with_governance enforces notes >= 20,
--      writes exactly ONE admin.hq_decision_recorded event, leaves
--      balance untouched, and is idempotent on (refund, request_id).
--   F. The trigger blocks setting provider_settlement_status='provider_completed'
--      without provider_refund_reference + provider_settled_at.
--   G. surface_unsettled_refunds opens one risk item for a stale
--      approved+not_submitted refund and auto-resolves it after
--      settlement.

BEGIN;

DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_actor uuid;
  v_purchase_a uuid := gen_random_uuid();
  v_purchase_b uuid := gen_random_uuid();
  v_purchase_c uuid := gen_random_uuid();
  v_purchase_d uuid := gen_random_uuid();
  v_refund_a uuid := gen_random_uuid();
  v_refund_b uuid := gen_random_uuid();
  v_refund_c uuid := gen_random_uuid();
  v_refund_d uuid := gen_random_uuid();
  v_call_a jsonb;
  v_call_b jsonb;
  v_settle_1 jsonb;
  v_settle_2 jsonb;
  v_settle_conflict jsonb;
  v_manual_1 jsonb;
  v_manual_2 jsonb;
  v_sweep_1 jsonb;
  v_sweep_2 jsonb;
  v_event_count int;
  v_risk_count int;
  v_balance_before int;
  v_balance_after int;
  v_balance_mid int;
  v_settlement text;
  v_caught boolean;
BEGIN
  SELECT id INTO v_actor FROM public.profiles ORDER BY created_at LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'proof: no profile available to seed actor';
  END IF;

  INSERT INTO public.organizations (id, name, is_demo)
  VALUES (v_org, 'refund-settlement proof org', false)
  ON CONFLICT (id) DO NOTHING;

  -- Seed a balance so approve_refund's GREATEST(0, balance - …) leaves
  -- a clean post-state we can assert on.
  INSERT INTO public.token_balances (org_id, balance)
  VALUES (v_org, 100)
  ON CONFLICT (org_id) DO UPDATE SET balance = EXCLUDED.balance;

  INSERT INTO public.token_purchases (id, org_id, paystack_reference, package_id, token_amount, amount_usd, status)
  VALUES
    (v_purchase_a, v_org, 'rps-A-' || v_purchase_a::text, 'single', 10, 10, 'completed'),
    (v_purchase_b, v_org, 'rps-B-' || v_purchase_b::text, 'single', 10, 10, 'completed'),
    (v_purchase_c, v_org, 'rps-C-' || v_purchase_c::text, 'single', 10, 10, 'completed'),
    (v_purchase_d, v_org, 'rps-D-' || v_purchase_d::text, 'single', 10, 10, 'completed');

  -- Seed four pending refunds.
  INSERT INTO public.refund_requests (
    id, org_id, requested_by, token_purchase_id,
    reason_code, reason_detail, status,
    credits_at_request, credits_used_at_request, created_at
  ) VALUES
    (v_refund_a, v_org, v_actor, v_purchase_a, 'other', 'proof seed reason aaaaaaaaaaaaaaaa', 'pending', 10, 0, now()),
    (v_refund_b, v_org, v_actor, v_purchase_b, 'other', 'proof seed reason bbbbbbbbbbbbbbbb', 'pending', 10, 0, now()),
    (v_refund_c, v_org, v_actor, v_purchase_c, 'other', 'proof seed reason cccccccccccccccc', 'pending', 10, 0, now()),
    (v_refund_d, v_org, v_actor, v_purchase_d, 'other', 'proof seed reason dddddddddddddddd', 'pending', 10, 0, now());

  -- ── A. approve_refund sets not_submitted ───────────────────────────
  v_call_a := public.approve_refund(
    p_refund_request_id => v_refund_a,
    p_admin_user_id     => v_actor,
    p_reason            => 'proof A: approve produces not_submitted settlement state'
  );
  ASSERT (v_call_a->>'success')::boolean IS TRUE, 'A: approve must succeed';

  SELECT provider_settlement_status INTO v_settlement
  FROM public.refund_requests WHERE id = v_refund_a;
  ASSERT v_settlement = 'not_submitted',
    format('A: expected not_submitted, got %s', v_settlement);

  -- ── B. decline_refund sets not_applicable ──────────────────────────
  v_call_b := public.decline_refund(
    p_refund_request_id => v_refund_b,
    p_admin_user_id     => v_actor,
    p_reason            => 'proof B: decline produces not_applicable settlement state'
  );
  ASSERT (v_call_b->>'success')::boolean IS TRUE, 'B: decline must succeed';

  SELECT provider_settlement_status INTO v_settlement
  FROM public.refund_requests WHERE id = v_refund_b;
  ASSERT v_settlement = 'not_applicable',
    format('B: expected not_applicable, got %s', v_settlement);

  -- ── C. mark_refund_provider_settled idempotency ───────────────────
  SELECT balance INTO v_balance_before FROM public.token_balances WHERE org_id = v_org;

  v_settle_1 := public.mark_refund_provider_settled(
    p_refund_request_id => v_refund_a,
    p_provider_refund_reference => 'PSTK_REF_001',
    p_amount => 10,
    p_currency => 'USD',
    p_provider_event_id => 'evt_PSTK_REF_001');
  ASSERT (v_settle_1->>'success')::boolean IS TRUE, 'C: first settle must succeed';
  ASSERT (v_settle_1->>'deduplicated')::boolean IS FALSE, 'C: first call must not be deduped';

  SELECT balance INTO v_balance_mid FROM public.token_balances WHERE org_id = v_org;
  ASSERT v_balance_before - v_balance_mid = 10,
        format('C: first settle must finally deduct exactly the 10 reserved credits, before=%s mid=%s',
          v_balance_before, v_balance_mid);

v_settle_2 := public.mark_refund_provider_settled(
    p_refund_request_id => v_refund_a,
    p_provider_refund_reference => 'PSTK_REF_001',
    p_amount => 10,
    p_currency => 'USD',
    p_provider_event_id => 'evt_PSTK_REF_001');
  ASSERT (v_settle_2->>'success')::boolean IS TRUE, 'C: second settle must succeed';
  ASSERT (v_settle_2->>'deduplicated')::boolean IS TRUE, 'C: second call must be deduped';

  SELECT balance INTO v_balance_after FROM public.token_balances WHERE org_id = v_org;
  ASSERT v_balance_mid = v_balance_after,
        format('C: deduped retry must NOT double-deduct, mid=%s after=%s',
          v_balance_mid, v_balance_after);

  SELECT count(*) INTO v_event_count
  FROM public.audit_logs
  WHERE entity_id = v_refund_a AND action = 'billing.refund_provider_settled';
  ASSERT v_event_count = 1,
    format('C: expected exactly 1 settled audit row, got %s', v_event_count);

  -- ── D. Conflicting reference ──────────────────────────────────────
  v_settle_conflict := public.mark_refund_provider_settled(
    p_refund_request_id => v_refund_a,
    p_provider_refund_reference => 'PSTK_REF_999_DIFFERENT',
    p_amount => 10,
    p_currency => 'USD',
    p_provider_event_id => 'evt_PSTK_REF_999');
  ASSERT (v_settle_conflict->>'success')::boolean IS FALSE,
    'D: conflicting reference must NOT succeed';
  ASSERT v_settle_conflict->>'code' = 'REFUND_SETTLEMENT_CONFLICT',
    format('D: expected REFUND_SETTLEMENT_CONFLICT, got %s', v_settle_conflict->>'code');

  SELECT count(*) INTO v_risk_count
  FROM public.admin_risk_items
  WHERE kind = 'refund_settlement_conflict'
    AND dedup_key = 'refund_settlement_conflict:' || v_refund_a::text || ':PSTK_REF_999_DIFFERENT';
  ASSERT v_risk_count = 1,
    format('D: expected 1 conflict risk item, got %s', v_risk_count);

  -- ── E. mark_refund_manually_settled_with_governance ───────────────
  PERFORM public.approve_refund(
    p_refund_request_id => v_refund_c,
    p_admin_user_id     => v_actor,
    p_reason            => 'proof E: approve refund_c so it can be manually settled'
  );

  SELECT balance INTO v_balance_before FROM public.token_balances WHERE org_id = v_org;

  v_manual_1 := public.mark_refund_manually_settled_with_governance(
    p_refund_request_id => v_refund_c,
    p_admin_user_id     => v_actor,
    p_notes             => 'proof E: dashboard receipt id PSTK-DASH-123 issued offline',
    p_request_id        => 'proof-E-req-1');
  ASSERT (v_manual_1->>'success')::boolean IS TRUE, 'E: manual settle must succeed';
  ASSERT (v_manual_1->>'deduplicated')::boolean IS FALSE, 'E: first manual call must not dedupe';

  SELECT balance INTO v_balance_mid FROM public.token_balances WHERE org_id = v_org;
  ASSERT v_balance_before - v_balance_mid = 10,
        format('E: manual settle must finally deduct exactly the 10 reserved credits, before=%s mid=%s',
          v_balance_before, v_balance_mid);

v_manual_2 := public.mark_refund_manually_settled_with_governance(
    p_refund_request_id => v_refund_c,
    p_admin_user_id     => v_actor,
    p_notes             => 'proof E: dashboard receipt id PSTK-DASH-123 issued offline',
    p_request_id        => 'proof-E-req-1');
  ASSERT (v_manual_2->>'deduplicated')::boolean IS TRUE,
    'E: idempotent retry must dedupe';

  SELECT balance INTO v_balance_after FROM public.token_balances WHERE org_id = v_org;
  ASSERT v_balance_mid = v_balance_after,
        format('E: idempotent retry must NOT double-deduct, mid=%s after=%s',
          v_balance_mid, v_balance_after);

  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE aggregate_id = v_refund_c
    AND event_type = 'admin.hq_decision_recorded'
    AND payload->>'source_function' = 'admin-refund-mark-settled';
  ASSERT v_event_count = 1,
    format('E: expected exactly 1 governance event, got %s', v_event_count);

  -- Notes < 20 chars must be rejected.
  v_caught := false;
  BEGIN
    PERFORM public.mark_refund_manually_settled_with_governance(
      p_refund_request_id => v_refund_c,
      p_admin_user_id     => v_actor,
      p_notes             => 'too short',
      p_request_id        => 'proof-E-bad-1');
    v_caught := false;
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  ASSERT v_caught, 'E: notes < 20 chars must raise';

  -- ── F. Trigger blocks invalid provider_completed transition ───────
  v_caught := false;
  BEGIN
    UPDATE public.refund_requests
      SET provider_settlement_status = 'provider_completed'
      WHERE id = v_refund_a;
    v_caught := false;
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  -- v_refund_a is already provider_completed with a reference, so the
  -- UPDATE above is a no-op; instead, exercise the trigger by trying
  -- on a fresh approved row.
  PERFORM public.approve_refund(
    p_refund_request_id => v_refund_d,
    p_admin_user_id     => v_actor,
    p_reason            => 'proof F: approve refund_d so trigger can be exercised'
  );

  v_caught := false;
  BEGIN
    UPDATE public.refund_requests
      SET provider_settlement_status = 'provider_completed',
          provider_refund_reference = NULL,
          provider_settled_at = NULL
      WHERE id = v_refund_d;
    v_caught := false;
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  ASSERT v_caught,
    'F: trigger must block provider_completed without reference + settled_at';

  -- ── G. surface_unsettled_refunds opens + auto-resolves ────────────
  -- Backdate refund_d's reviewed_at so it qualifies as stale (>1 min).
  UPDATE public.refund_requests
    SET reviewed_at = now() - interval '2 days'
    WHERE id = v_refund_d;

  v_sweep_1 := public.surface_unsettled_refunds(1, 10);
  ASSERT (v_sweep_1->>'success')::boolean IS TRUE, 'G: sweep must succeed';

  SELECT count(*) INTO v_risk_count
  FROM public.admin_risk_items
  WHERE kind = 'refund_settlement_pending'
    AND dedup_key = 'refund_settlement_pending:' || v_refund_d::text
    AND status NOT IN ('resolved','closed');
  ASSERT v_risk_count = 1,
    format('G: expected 1 open settlement-pending item, got %s', v_risk_count);

  -- Mark refund_d settled, then sweep again — risk item auto-resolves.
  PERFORM public.mark_refund_provider_settled(
    p_refund_request_id => v_refund_d,
    p_provider_refund_reference => 'PSTK_REF_D',
    p_amount => 10, p_currency => 'USD',
    p_provider_event_id => 'evt_PSTK_REF_D');

  v_sweep_2 := public.surface_unsettled_refunds(1, 10);
  ASSERT (v_sweep_2->>'success')::boolean IS TRUE, 'G: second sweep must succeed';

  SELECT count(*) INTO v_risk_count
  FROM public.admin_risk_items
  WHERE kind = 'refund_settlement_pending'
    AND dedup_key = 'refund_settlement_pending:' || v_refund_d::text
    AND status NOT IN ('resolved','closed');
  ASSERT v_risk_count = 0,
    format('G: settlement-pending item must auto-resolve, still open=%s', v_risk_count);

  RAISE NOTICE 'Refund provider-settlement proof: ALL ASSERTIONS PASSED';
END $$;

ROLLBACK;
