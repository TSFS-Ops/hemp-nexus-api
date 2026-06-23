-- =============================================================
-- SQL proof: atomic_paid_credit_purchase + repair_skeletal_paid_credit
-- =============================================================
-- Pre-PayFast hardening. Verifies:
--   1. Same reference credits exactly once.
--   2. Retry returns already_credited:true, balance unchanged.
--   3. Pre-existing skeletal action_type='credit' row is promoted in
--      place by the RPC, balance untouched.
--   4. repair_skeletal_paid_credit promotes paid-skeletal rows that
--      match token_purchases, balance unchanged, idempotent.
--   5. repair_skeletal_paid_credit IGNORES skeletal rows with no
--      matching token_purchases row.
--
-- Wrapped in BEGIN…ROLLBACK so live tables are untouched.
-- =============================================================

BEGIN;

DO $$
DECLARE
  v_org_id           uuid := gen_random_uuid();
  v_ref_a            text := 'proof-ref-A-' || gen_random_uuid()::text;
  v_ref_b            text := 'proof-ref-B-' || gen_random_uuid()::text;
  v_ref_c_skeletal   text := 'proof-ref-C-' || gen_random_uuid()::text;
  v_ref_d_orphan     text := 'proof-ref-D-' || gen_random_uuid()::text;
  v_result           jsonb;
  v_balance_snap     integer;
  v_balance_now      integer;
  v_ledger_count     integer;
  v_action_type      text;
  v_repaired_count   integer;
BEGIN
  -- Seed an isolated organisation (token_balances row is auto-created
  -- by a trigger and starts at 0).
  INSERT INTO organizations (id, name) VALUES (v_org_id, 'proof-org-' || v_org_id::text);

  -- ── 1. First call credits the org and writes a credit_purchase row.
  v_result := public.atomic_paid_credit_purchase(
    v_org_id, 10, v_ref_a, 'payment:test', '{"package_id":"pkg_proof"}'::jsonb
  );
  ASSERT (v_result->>'already_credited')::boolean = false, '1a: should not be already_credited';
  ASSERT (v_result->>'new_balance')::int = 10, '1b: balance must be 10';

  SELECT balance INTO v_balance_now FROM token_balances WHERE org_id = v_org_id;
  ASSERT v_balance_now = 10, '1c: actual balance must be 10';

  SELECT count(*) INTO v_ledger_count FROM token_ledger WHERE request_id = v_ref_a;
  ASSERT v_ledger_count = 1, '1d: exactly one ledger row for ref A';

  SELECT action_type INTO v_action_type FROM token_ledger WHERE request_id = v_ref_a;
  ASSERT v_action_type = 'credit_purchase', '1e: ledger row must be credit_purchase';

  -- ── 2. Retry with the same reference must NOT double-credit.
  v_result := public.atomic_paid_credit_purchase(
    v_org_id, 10, v_ref_a, 'payment:test', '{"package_id":"pkg_proof"}'::jsonb
  );
  ASSERT (v_result->>'already_credited')::boolean = true, '2a: retry should be already_credited';
  ASSERT (v_result->>'new_balance')::int = 10, '2b: retry balance must still be 10';

  SELECT balance INTO v_balance_now FROM token_balances WHERE org_id = v_org_id;
  ASSERT v_balance_now = 10, '2c: actual balance must still be 10';

  SELECT count(*) INTO v_ledger_count FROM token_ledger WHERE request_id = v_ref_a;
  ASSERT v_ledger_count = 1, '2d: still exactly one ledger row';

  -- ── 3. Pre-existing skeletal credit row → promoted in place by RPC.
  --       Insert directly into token_ledger to simulate a partial run
  --       where the old code wrote 'credit' and died before promotion.
  --       We do NOT manually touch token_balances (RLS); we simply
  --       snapshot it before/after and assert no change.
  INSERT INTO token_ledger (
    org_id, endpoint, tokens_burned, outcome, remaining_balance,
    request_id, action_type, metadata
  ) VALUES (
    v_org_id, 'payment:legacy-skeleton', 0, 'allowed', 10,
    v_ref_c_skeletal, 'credit',
    jsonb_build_object('legacy', true)
  );
  SELECT balance INTO v_balance_snap FROM token_balances WHERE org_id = v_org_id;

  v_result := public.atomic_paid_credit_purchase(
    v_org_id, 15, v_ref_c_skeletal, 'payment:test', '{"promoted_via":"proof"}'::jsonb
  );
  ASSERT (v_result->>'already_credited')::boolean = true, '3a: skeletal row → already_credited';
  ASSERT (v_result->>'promoted')::boolean = true, '3b: skeletal row → promoted=true';

  SELECT balance INTO v_balance_now FROM token_balances WHERE org_id = v_org_id;
  ASSERT v_balance_now = v_balance_snap, '3c: balance unchanged after skeletal promotion';

  SELECT action_type INTO v_action_type FROM token_ledger WHERE request_id = v_ref_c_skeletal;
  ASSERT v_action_type = 'credit_purchase', '3d: skeletal row is now credit_purchase';

  -- ── 4. repair_skeletal_paid_credit promotes a paid-skeletal row that
  --       matches token_purchases, balance untouched, idempotent.
  INSERT INTO token_ledger (
    org_id, endpoint, tokens_burned, outcome, remaining_balance,
    request_id, action_type, metadata, created_at
  ) VALUES (
    v_org_id, 'payment:paystack', 0, 'allowed', 10,
    v_ref_b, 'credit',
    jsonb_build_object('credited', 5),
    now() - interval '1 hour'
  );
  INSERT INTO token_purchases (
    org_id, paystack_reference, token_amount, amount_usd, currency, status
  ) VALUES (
    v_org_id, v_ref_b, 5, 5.00, 'USD', 'completed'
  );
  SELECT balance INTO v_balance_snap FROM token_balances WHERE org_id = v_org_id;

  SELECT count(*) INTO v_repaired_count
  FROM public.repair_skeletal_paid_credit(15, 100)
  WHERE reference = v_ref_b;
  ASSERT v_repaired_count = 1, '4a: exactly one row promoted by sweeper for ref B';

  SELECT action_type INTO v_action_type FROM token_ledger WHERE request_id = v_ref_b;
  ASSERT v_action_type = 'credit_purchase', '4b: ref B promoted to credit_purchase';

  SELECT balance INTO v_balance_now FROM token_balances WHERE org_id = v_org_id;
  ASSERT v_balance_now = v_balance_snap, '4c: balance untouched after sweeper';

  SELECT count(*) INTO v_repaired_count
  FROM public.repair_skeletal_paid_credit(15, 100)
  WHERE reference = v_ref_b;
  ASSERT v_repaired_count = 0, '4d: sweeper is idempotent for ref B';

  -- ── 5. Orphan skeletal credit row (no matching token_purchases) is
  --       IGNORED by the sweeper.
  INSERT INTO token_ledger (
    org_id, endpoint, tokens_burned, outcome, remaining_balance,
    request_id, action_type, metadata, created_at
  ) VALUES (
    v_org_id, 'admin_top_up:proof', 0, 'allowed', 10,
    v_ref_d_orphan, 'credit',
    jsonb_build_object('source','admin_top_up'),
    now() - interval '1 hour'
  );

  SELECT count(*) INTO v_repaired_count
  FROM public.repair_skeletal_paid_credit(15, 100)
  WHERE reference = v_ref_d_orphan;
  ASSERT v_repaired_count = 0, '5a: orphan (no token_purchases match) ignored';

  SELECT action_type INTO v_action_type FROM token_ledger WHERE request_id = v_ref_d_orphan;
  ASSERT v_action_type = 'credit', '5b: orphan row still action_type=credit';

  RAISE NOTICE 'atomic_paid_credit_purchase proof: ALL ASSERTIONS PASSED';
END $$;

ROLLBACK;
