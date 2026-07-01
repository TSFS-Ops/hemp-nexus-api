-- Batch J1 — token_ledger append-only allowlist proof.
-- Rollback-only. Requires table-owner / service-role privileges to
-- exercise the trigger; under sandbox roles RLS/privilege checks fire
-- before the trigger and the trigger message will not be observed.
--
-- Coverage:
--   * arbitrary UPDATE blocked with token_ledger_append_only;
--   * DELETE blocked with token_ledger_append_only;
--   * approved credit -> credit_purchase promotion succeeds when all
--     protected fields unchanged and approved marker is present;
--   * promotion blocked if token amount / balance / org / request id changes;
--   * promotion blocked when neither promoted_by nor repaired_by is present;
--   * Batch B1 token_ledger_no_truncate_trg remains present.

BEGIN;

-- Fixture: minimal skeletal 'credit' row.
DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_id  uuid;
  v_msg text;
BEGIN
  INSERT INTO public.token_ledger (
    org_id, endpoint, tokens_burned, outcome, remaining_balance,
    request_id, action_type, metadata, is_demo
  ) VALUES (
    v_org, 'payment:test', 0, 'allowed', 100,
    'J1-proof-' || v_org::text, 'credit', '{}'::jsonb, false
  )
  RETURNING id INTO v_id;

  -- 1) DELETE must be blocked.
  BEGIN
    DELETE FROM public.token_ledger WHERE id = v_id;
    RAISE EXCEPTION 'PROOF FAIL: DELETE should have been blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%token_ledger_append_only%' THEN
      RAISE EXCEPTION 'PROOF FAIL: DELETE blocked but wrong message: %', v_msg;
    END IF;
  END;

  -- 2) Arbitrary UPDATE (change tokens_burned) must be blocked.
  BEGIN
    UPDATE public.token_ledger SET tokens_burned = 5 WHERE id = v_id;
    RAISE EXCEPTION 'PROOF FAIL: tokens_burned change should have been blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%token_ledger_append_only%' THEN
      RAISE EXCEPTION 'PROOF FAIL: UPDATE blocked but wrong message: %', v_msg;
    END IF;
  END;

  -- 3) Promotion without approved marker must be blocked.
  BEGIN
    UPDATE public.token_ledger
       SET action_type = 'credit_purchase',
           metadata    = jsonb_build_object('random','value')
     WHERE id = v_id;
    RAISE EXCEPTION 'PROOF FAIL: promotion without marker should have been blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%promoted_by%' AND v_msg NOT LIKE '%repaired_by%' THEN
      RAISE EXCEPTION 'PROOF FAIL: marker rejection but wrong message: %', v_msg;
    END IF;
  END;

  -- 4) Promotion that also changes protected column must be blocked.
  BEGIN
    UPDATE public.token_ledger
       SET action_type = 'credit_purchase',
           remaining_balance = 999,
           metadata    = jsonb_build_object('promoted_by','test')
     WHERE id = v_id;
    RAISE EXCEPTION 'PROOF FAIL: promotion with protected-column change should have been blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%protected column%' THEN
      RAISE EXCEPTION 'PROOF FAIL: expected protected-column violation, got: %', v_msg;
    END IF;
  END;

  -- 5) Approved promotion (credit -> credit_purchase, promoted_by marker,
  --    no protected-column change) must succeed.
  UPDATE public.token_ledger
     SET action_type = 'credit_purchase',
         endpoint    = 'payment:test',
         metadata    = jsonb_build_object('promoted_by','atomic_paid_credit_purchase','promoted_at', now())
   WHERE id = v_id;

  IF (SELECT action_type FROM public.token_ledger WHERE id = v_id) <> 'credit_purchase' THEN
    RAISE EXCEPTION 'PROOF FAIL: approved promotion did not apply';
  END IF;

  -- 6) Second promotion attempt (already credit_purchase) must be blocked
  --    because OLD.action_type is no longer 'credit'.
  BEGIN
    UPDATE public.token_ledger
       SET metadata = jsonb_build_object('promoted_by','x')
     WHERE id = v_id;
    RAISE EXCEPTION 'PROOF FAIL: post-promotion UPDATE should have been blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%token_ledger_append_only%' THEN
      RAISE EXCEPTION 'PROOF FAIL: post-promotion UPDATE blocked but wrong message: %', v_msg;
    END IF;
  END;

  -- 7) Batch B1 TRUNCATE trigger still present.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'token_ledger_no_truncate_trg'
      AND tgrelid = 'public.token_ledger'::regclass
  ) THEN
    RAISE EXCEPTION 'PROOF FAIL: Batch B1 token_ledger_no_truncate_trg missing';
  END IF;

  RAISE NOTICE 'Batch J1 proof: all cases passed';
END $$;

ROLLBACK;
