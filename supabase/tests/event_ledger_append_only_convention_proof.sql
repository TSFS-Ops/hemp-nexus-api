-- Event-ledger append-only convention proof (Option A containment).
--
-- This file is documentation + catalog-only assertions. It does NOT mutate
-- production data. It is rollback-wrapped so even introspection that records
-- temp objects leaves no trace.
--
-- What this proves today:
--   1. RLS is enabled on token_ledger, match_events, poi_events.
--   2. No RLS policy grants UPDATE or DELETE on these tables to the ordinary
--      `authenticated` role (ordinary users cannot mutate ledger/event rows).
--   3. No immutability trigger (BEFORE UPDATE/DELETE/TRUNCATE raising an
--      `append_only`-style exception) exists on these tables yet — therefore
--      service_role / table owner paths can still mutate, which is the
--      remaining backend gap that Option B/C will address in a later batch.
--
-- This is intentionally non-destructive. Run with:
--   psql -f supabase/tests/event_ledger_append_only_convention_proof.sql

BEGIN;

-- 1. RLS enabled on all three tables.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname, c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('token_ledger', 'match_events', 'poi_events')
  LOOP
    IF NOT r.relrowsecurity THEN
      RAISE EXCEPTION 'RLS is NOT enabled on public.% (append-only convention guard)', r.relname;
    END IF;
  END LOOP;
END $$;

-- 2. No UPDATE/DELETE policy targets the `authenticated` role on these tables.
--    (SELECT/INSERT policies are fine; we only block ordinary-user mutation.)
DO $$
DECLARE
  bad_count INT;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('token_ledger', 'match_events', 'poi_events')
    AND cmd IN ('UPDATE', 'DELETE')
    AND 'authenticated' = ANY (roles);

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Found % UPDATE/DELETE policy(ies) granting ordinary `authenticated` users mutation rights on ledger/event tables.',
      bad_count;
  END IF;
END $$;

-- 3. Document remaining gap: no immutability trigger yet.
--    This block intentionally does NOT fail; it surfaces the latent gap so
--    operators reading the proof know service_role/owner mutability is still
--    possible until Option B/C lands triggers.
DO $$
DECLARE
  trig_count INT;
BEGIN
  SELECT COUNT(*) INTO trig_count
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('token_ledger', 'match_events', 'poi_events')
    AND NOT t.tgisinternal
    AND t.tgname ILIKE '%append_only%';

  RAISE NOTICE 'Append-only trigger count across (token_ledger, match_events, poi_events) = %. Expected 0 in current Option A phase.', trig_count;
END $$;

ROLLBACK;
