-- Batch J1 — token_ledger append-only widened allowlist proof.
-- Rollback-only. Requires table-owner / service-role privileges to
-- reach the trigger; sandbox roles will be stopped by RLS/privilege
-- checks before the trigger raises.
--
-- Coverage:
--   1  arbitrary UPDATE blocked with token_ledger_append_only;
--   2  DELETE blocked with token_ledger_append_only;
--   3  credit -> credit_purchase allowed with promoted_by;
--   4  credit -> credit_purchase allowed with repaired_by;
--   5  credit -> credit_refund allowed with refund_reference;
--   6  credit -> credit_purchase blocked if remaining_balance changes;
--   7  credit -> credit_refund blocked if org_id changes;
--   8  credit -> credit_refund blocked if request_id changes;
--   9  promotion blocked without any approved marker;
--   10 metadata-only touch (credit -> credit) blocked;
--   11 post-promotion UPDATE of credit_purchase / credit_refund blocked;
--   12 Batch B1 token_ledger_no_truncate_trg still exists.

BEGIN;

DO $$
DECLARE
  v_org1 uuid := gen_random_uuid();
  v_org2 uuid := gen_random_uuid();
  v_id1  uuid;
  v_id2  uuid;
  v_id3  uuid;
  v_id4  uuid;
  v_id5  uuid;
  v_id6  uuid;
  v_msg  text;

  FUNCTION_LOCAL text := 'unused';
BEGIN
  -- Fixtures: multiple skeletal 'credit' rows.
  INSERT INTO public.token_ledger (org_id, endpoint, tokens_burned, outcome, remaining_balance, request_id, action_type, metadata, is_demo)
  VALUES (v_org1, 'payment:test', 0, 'allowed', 100, 'J1P-' || v_org1, 'credit', '{}'::jsonb, false)
  RETURNING id INTO v_id1;

  INSERT INTO public.token_ledger (org_id, endpoint, tokens_burned, outcome, remaining_balance, request_id, action_type, metadata, is_demo)
  VALUES (v_org1, 'payment:test', 0, 'allowed', 100, 'J1R-' || v_org1, 'credit', '{}'::jsonb, false)
  RETURNING id INTO v_id2;

  INSERT INTO public.token_ledger (org_id, endpoint, tokens_burned, outcome, remaining_balance, request_id, action_type, metadata, is_demo)
  VALUES (v_org1, 'payment:test', 0, 'allowed', 100, 'J1P2-' || v_org1, 'credit', '{}'::jsonb, false)
  RETURNING id INTO v_id3;

  INSERT INTO public.token_ledger (org_id, endpoint, tokens_burned, outcome, remaining_balance, request_id, action_type, metadata, is_demo)
  VALUES (v_org1, 'payment:test', 0, 'allowed', 100, 'J1R2-' || v_org1, 'credit', '{}'::jsonb, false)
  RETURNING id INTO v_id4;

  INSERT INTO public.token_ledger (org_id, endpoint, tokens_burned, outcome, remaining_balance, request_id, action_type, metadata, is_demo)
  VALUES (v_org1, 'payment:test', 0, 'allowed', 100, 'J1RC-' || v_org1, 'credit', '{}'::jsonb, false)
  RETURNING id INTO v_id5;

  INSERT INTO public.token_ledger (org_id, endpoint, tokens_burned, outcome, remaining_balance, request_id, action_type, metadata, is_demo)
  VALUES (v_org1, 'payment:test', 0, 'allowed', 100, 'J1MO-' || v_org1, 'credit', '{}'::jsonb, false)
  RETURNING id INTO v_id6;

  -- 1) Arbitrary UPDATE blocked (tokens_burned change on a non-promotion).
  BEGIN
    UPDATE public.token_ledger SET tokens_burned = 5 WHERE id = v_id1;
    RAISE EXCEPTION 'PROOF FAIL 1: arbitrary UPDATE should have been blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%token_ledger_append_only%' THEN
      RAISE EXCEPTION 'PROOF FAIL 1: wrong message: %', v_msg;
    END IF;
  END;

  -- 2) DELETE blocked.
  BEGIN
    DELETE FROM public.token_ledger WHERE id = v_id1;
    RAISE EXCEPTION 'PROOF FAIL 2: DELETE should have been blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%token_ledger_append_only%' THEN
      RAISE EXCEPTION 'PROOF FAIL 2: wrong message: %', v_msg;
    END IF;
  END;

  -- 3) credit -> credit_purchase allowed with promoted_by.
  UPDATE public.token_ledger
     SET action_type = 'credit_purchase',
         metadata    = jsonb_build_object('promoted_by','atomic_paid_credit_purchase','promoted_at', now())
   WHERE id = v_id1;
  IF (SELECT action_type FROM public.token_ledger WHERE id = v_id1) <> 'credit_purchase' THEN
    RAISE EXCEPTION 'PROOF FAIL 3: promoted_by promotion did not apply';
  END IF;

  -- 4) credit -> credit_purchase allowed with repaired_by.
  UPDATE public.token_ledger
     SET action_type = 'credit_purchase',
         metadata    = jsonb_build_object('repaired_by','repair_skeletal_paid_credit','repaired_at', now())
   WHERE id = v_id3;
  IF (SELECT action_type FROM public.token_ledger WHERE id = v_id3) <> 'credit_purchase' THEN
    RAISE EXCEPTION 'PROOF FAIL 4: repaired_by promotion did not apply';
  END IF;

  -- 5) credit -> credit_refund allowed with refund_reference.
  UPDATE public.token_ledger
     SET action_type = 'credit_refund',
         endpoint    = 'refund:paystack',
         metadata    = jsonb_build_object('refund_reference', 'J1R-' || v_org1, 'credits_reversed', 5)
   WHERE id = v_id2;
  IF (SELECT action_type FROM public.token_ledger WHERE id = v_id2) <> 'credit_refund' THEN
    RAISE EXCEPTION 'PROOF FAIL 5: refund_reference promotion did not apply';
  END IF;

  -- 6) credit -> credit_purchase blocked if remaining_balance changes.
  BEGIN
    UPDATE public.token_ledger
       SET action_type = 'credit_purchase',
           remaining_balance = 999,
           metadata    = jsonb_build_object('promoted_by','x')
     WHERE id = v_id6;
    RAISE EXCEPTION 'PROOF FAIL 6: promotion with remaining_balance change should have been blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%protected column%' THEN
      RAISE EXCEPTION 'PROOF FAIL 6: expected protected-column violation, got: %', v_msg;
    END IF;
  END;

  -- 7) credit -> credit_refund blocked if org_id changes.
  BEGIN
    UPDATE public.token_ledger
       SET action_type = 'credit_refund',
           org_id      = v_org2,
           metadata    = jsonb_build_object('refund_reference','x')
     WHERE id = v_id4;
    RAISE EXCEPTION 'PROOF FAIL 7: refund with org_id change should have been blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%protected column%' THEN
      RAISE EXCEPTION 'PROOF FAIL 7: expected protected-column violation, got: %', v_msg;
    END IF;
  END;

  -- 8) credit -> credit_refund blocked if request_id changes.
  BEGIN
    UPDATE public.token_ledger
       SET action_type = 'credit_refund',
           request_id  = 'DIFFERENT',
           metadata    = jsonb_build_object('refund_reference','x')
     WHERE id = v_id4;
    RAISE EXCEPTION 'PROOF FAIL 8: refund with request_id change should have been blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%protected column%' THEN
      RAISE EXCEPTION 'PROOF FAIL 8: expected protected-column violation, got: %', v_msg;
    END IF;
  END;

  -- 9) Promotion blocked without any approved marker.
  BEGIN
    UPDATE public.token_ledger
       SET action_type = 'credit_purchase',
           metadata    = jsonb_build_object('random','value')
     WHERE id = v_id4;
    RAISE EXCEPTION 'PROOF FAIL 9a: purchase promotion without marker should have been blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%metadata marker%' THEN
      RAISE EXCEPTION 'PROOF FAIL 9a: wrong message: %', v_msg;
    END IF;
  END;

  BEGIN
    UPDATE public.token_ledger
       SET action_type = 'credit_refund',
           metadata    = jsonb_build_object('random','value')
     WHERE id = v_id4;
    RAISE EXCEPTION 'PROOF FAIL 9b: refund promotion without marker should have been blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%metadata marker%' THEN
      RAISE EXCEPTION 'PROOF FAIL 9b: wrong message: %', v_msg;
    END IF;
  END;

  -- 10) Metadata-only touch (credit -> credit) blocked.
  BEGIN
    UPDATE public.token_ledger
       SET metadata = jsonb_build_object('note','tweak')
     WHERE id = v_id4;
    RAISE EXCEPTION 'PROOF FAIL 10: credit->credit metadata touch should have been blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%approved promotion%' THEN
      RAISE EXCEPTION 'PROOF FAIL 10: expected transition violation, got: %', v_msg;
    END IF;
  END;

  -- 11) Post-promotion UPDATE of an already-promoted row blocked.
  BEGIN
    UPDATE public.token_ledger
       SET metadata = jsonb_build_object('promoted_by','again')
     WHERE id = v_id1;  -- already credit_purchase from step 3
    RAISE EXCEPTION 'PROOF FAIL 11a: post-promotion UPDATE of credit_purchase should have been blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%approved promotion%' THEN
      RAISE EXCEPTION 'PROOF FAIL 11a: expected transition violation, got: %', v_msg;
    END IF;
  END;

  BEGIN
    UPDATE public.token_ledger
       SET metadata = jsonb_build_object('refund_reference','again')
     WHERE id = v_id2;  -- already credit_refund from step 5
    RAISE EXCEPTION 'PROOF FAIL 11b: post-promotion UPDATE of credit_refund should have been blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%approved promotion%' THEN
      RAISE EXCEPTION 'PROOF FAIL 11b: expected transition violation, got: %', v_msg;
    END IF;
  END;

  -- 12) Batch B1 truncate trigger still exists.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'token_ledger_no_truncate_trg'
      AND tgrelid = 'public.token_ledger'::regclass
  ) THEN
    RAISE EXCEPTION 'PROOF FAIL 12: Batch B1 token_ledger_no_truncate_trg missing';
  END IF;

  RAISE NOTICE 'Batch J1 widened allowlist proof: all cases passed';
END $$;

ROLLBACK;
