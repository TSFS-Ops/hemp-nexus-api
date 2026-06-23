-- ============================================================
-- match_events append-only FREEZE proof.
--
-- Proves that public.match_events is protected against UPDATE,
-- DELETE and TRUNCATE by the assert_match_events_append_only()
-- trigger function in the DEFAULT (no-bypass) session state.
--
-- This proof MUST:
--   * never enable any bypass GUC (none exists for match_events);
--   * roll back at the end (no production rows touched);
--   * insert any seed rows inside the same transaction so they
--     vanish on ROLLBACK.
--
-- Scope: read/assert only. Does not alter triggers, RLS,
-- grants, ownership, or any unrelated subsystem.
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
     AND proname = 'assert_match_events_append_only';
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'PROOF_FAIL: assert_match_events_append_only() missing';
  END IF;
  IF NOT v_sdef THEN
    RAISE EXCEPTION 'PROOF_FAIL: assert_match_events_append_only() is not SECURITY DEFINER';
  END IF;
END $$;

-- 2. Row-level UPDATE/DELETE trigger and statement-level TRUNCATE trigger present.
DO $$
DECLARE
  v_row_trg   int;
  v_trunc_trg int;
BEGIN
  SELECT count(*) INTO v_row_trg
    FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgname = 'match_events_no_mutate_trg'
     AND tgrelid = 'public.match_events'::regclass;
  IF v_row_trg <> 1 THEN
    RAISE EXCEPTION 'PROOF_FAIL: match_events_no_mutate_trg missing (found %)', v_row_trg;
  END IF;

  SELECT count(*) INTO v_trunc_trg
    FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgname = 'match_events_no_truncate_trg'
     AND tgrelid = 'public.match_events'::regclass;
  IF v_trunc_trg <> 1 THEN
    RAISE EXCEPTION 'PROOF_FAIL: match_events_no_truncate_trg missing (found %)', v_trunc_trg;
  END IF;
END $$;

-- 3. Seed one disposable row (rolled back) and prove INSERT still works.
DO $$
DECLARE
  v_match_id uuid;
  v_org_id   uuid;
BEGIN
  SELECT id, org_id INTO v_match_id, v_org_id FROM public.matches LIMIT 1;
  IF v_match_id IS NULL THEN
    RAISE NOTICE 'PROOF_SKIP: no matches row available to seed match_events; skipping INSERT/UPDATE/DELETE assertions';
    RETURN;
  END IF;

  INSERT INTO public.match_events (match_id, org_id, event_type, event_data, payload_hash)
  VALUES (v_match_id, v_org_id, 'freeze_proof_seed', '{"freeze":"proof"}'::jsonb, repeat('0', 64));

  -- 4. UPDATE must raise MATCH_EVENTS_APPEND_ONLY.
  DECLARE v_err text;
  BEGIN
    BEGIN
      UPDATE public.match_events SET event_type = 'mutated' WHERE event_type = 'freeze_proof_seed';
      RAISE EXCEPTION 'PROOF_FAIL: match_events UPDATE was permitted';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF position('MATCH_EVENTS_APPEND_ONLY' in v_err) = 0 THEN
        RAISE EXCEPTION 'PROOF_FAIL: unexpected UPDATE error: %', v_err;
      END IF;
    END;
  END;

  -- 5. DELETE must raise MATCH_EVENTS_APPEND_ONLY.
  DECLARE v_err text;
  BEGIN
    BEGIN
      DELETE FROM public.match_events WHERE event_type = 'freeze_proof_seed';
      RAISE EXCEPTION 'PROOF_FAIL: match_events DELETE was permitted';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF position('MATCH_EVENTS_APPEND_ONLY' in v_err) = 0 THEN
        RAISE EXCEPTION 'PROOF_FAIL: unexpected DELETE error: %', v_err;
      END IF;
    END;
  END;
END $$;

-- 6. TRUNCATE must raise MATCH_EVENTS_APPEND_ONLY (independent of seed availability).
DO $$
DECLARE v_err text;
BEGIN
  BEGIN
    TRUNCATE TABLE public.match_events;
    RAISE EXCEPTION 'PROOF_FAIL: match_events TRUNCATE was permitted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF position('MATCH_EVENTS_APPEND_ONLY' in v_err) = 0 THEN
      RAISE EXCEPTION 'PROOF_FAIL: unexpected TRUNCATE error: %', v_err;
    END IF;
  END;
END $$;

-- All proofs passed. Discard seed rows and any side effects.
ROLLBACK;
