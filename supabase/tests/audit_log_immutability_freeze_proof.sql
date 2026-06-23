-- ============================================================
-- Audit-log immutability FREEZE proof (Option A).
--
-- Proves that public.audit_logs and public.admin_audit_logs are
-- protected against UPDATE/DELETE by the assert_audit_immutable()
-- trigger function in the DEFAULT (no-bypass) session state.
--
-- This proof MUST:
--   * never enable the app.allow_audit_cleanup bypass GUC;
--   * roll back at the end (no production rows touched);
--   * insert any seed rows inside the same transaction so they
--     vanish on ROLLBACK.
--
-- Scope: read/assert only. Does not alter triggers, the GUC, RLS,
-- grants, or any unrelated subsystem.
-- ============================================================

BEGIN;

-- 1. Trigger function exists and is SECURITY DEFINER.
DO $$
DECLARE
  v_kind  char;
  v_sdef  boolean;
BEGIN
  SELECT prokind, prosecdef INTO v_kind, v_sdef
    FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname = 'assert_audit_immutable';
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'PROOF_FAIL: assert_audit_immutable() missing';
  END IF;
  IF NOT v_sdef THEN
    RAISE EXCEPTION 'PROOF_FAIL: assert_audit_immutable() is not SECURITY DEFINER';
  END IF;
END $$;

-- 2. Both triggers present on the two audit tables.
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgname IN ('audit_logs_no_mutate_trg', 'admin_audit_logs_no_mutate_trg');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'PROOF_FAIL: expected 2 immutability triggers, found %', v_count;
  END IF;
END $$;

-- 3. Seed one disposable row in each table (rolled back).
INSERT INTO public.audit_logs (id, action)
  VALUES (gen_random_uuid(), 'freeze_proof_seed')
  RETURNING id \gset audit_

INSERT INTO public.admin_audit_logs (action, target_type, details)
  VALUES ('freeze_proof_seed', 'proof', jsonb_build_object('source','freeze_proof'))
  RETURNING id \gset admin_

-- 4. UPDATE on audit_logs must raise AUDIT_IMMUTABLE without the bypass.
DO $$
DECLARE
  v_err text;
BEGIN
  BEGIN
    UPDATE public.audit_logs SET action = 'mutated' WHERE action = 'freeze_proof_seed';
    RAISE EXCEPTION 'PROOF_FAIL: audit_logs UPDATE was permitted without bypass';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF position('AUDIT_IMMUTABLE' in v_err) = 0 THEN
      RAISE EXCEPTION 'PROOF_FAIL: unexpected error: %', v_err;
    END IF;
  END;
END $$;

-- 5. DELETE on audit_logs must raise AUDIT_IMMUTABLE.
DO $$
DECLARE v_err text;
BEGIN
  BEGIN
    DELETE FROM public.audit_logs WHERE action = 'freeze_proof_seed';
    RAISE EXCEPTION 'PROOF_FAIL: audit_logs DELETE was permitted without bypass';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF position('AUDIT_IMMUTABLE' in v_err) = 0 THEN
      RAISE EXCEPTION 'PROOF_FAIL: unexpected error: %', v_err;
    END IF;
  END;
END $$;

-- 6. UPDATE on admin_audit_logs must raise AUDIT_IMMUTABLE.
DO $$
DECLARE v_err text;
BEGIN
  BEGIN
    UPDATE public.admin_audit_logs SET action = 'mutated' WHERE action = 'freeze_proof_seed';
    RAISE EXCEPTION 'PROOF_FAIL: admin_audit_logs UPDATE was permitted without bypass';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF position('AUDIT_IMMUTABLE' in v_err) = 0 THEN
      RAISE EXCEPTION 'PROOF_FAIL: unexpected error: %', v_err;
    END IF;
  END;
END $$;

-- 7. DELETE on admin_audit_logs must raise AUDIT_IMMUTABLE.
DO $$
DECLARE v_err text;
BEGIN
  BEGIN
    DELETE FROM public.admin_audit_logs WHERE action = 'freeze_proof_seed';
    RAISE EXCEPTION 'PROOF_FAIL: admin_audit_logs DELETE was permitted without bypass';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF position('AUDIT_IMMUTABLE' in v_err) = 0 THEN
      RAISE EXCEPTION 'PROOF_FAIL: unexpected error: %', v_err;
    END IF;
  END;
END $$;

-- All proofs passed. Discard seed rows and any side effects.
ROLLBACK;
