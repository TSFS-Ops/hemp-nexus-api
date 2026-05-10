-- D1-c: Swap unique current-engagement-per-match partial index.
-- New predicate excludes: expired, declined, cancelled_email_change.
-- Idempotent. Table is never left without the canonical unique index.

DO $$
DECLARE
  has_canonical boolean;
  has_v2        boolean;
  has_legacy    boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_poi_engagements_one_current_per_match')          INTO has_canonical;
  SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_poi_engagements_one_current_per_match_v2')       INTO has_v2;
  SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_poi_engagements_one_current_per_match_legacy')   INTO has_legacy;

  -- Build the v2 index if missing
  IF NOT has_v2 THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX uq_poi_engagements_one_current_per_match_v2
      ON public.poi_engagements USING btree (match_id)
      WHERE (engagement_status <> ALL (ARRAY[
        'expired'::engagement_status,
        'declined'::engagement_status,
        'cancelled_email_change'::engagement_status
      ]))
    $sql$;
  END IF;

  -- Move the existing canonical index out of the way (only if it still holds the canonical name)
  IF has_canonical THEN
    -- Re-check definition; if it already matches the v2 predicate, drop v2 instead and exit
    IF (SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND indexname='uq_poi_engagements_one_current_per_match')
       LIKE '%cancelled_email_change%' THEN
      -- Canonical is already updated; clean up the v2 helper
      DROP INDEX IF EXISTS public.uq_poi_engagements_one_current_per_match_v2;
      RETURN;
    END IF;

    ALTER INDEX public.uq_poi_engagements_one_current_per_match
      RENAME TO uq_poi_engagements_one_current_per_match_legacy;
  END IF;

  -- Rename v2 -> canonical
  ALTER INDEX public.uq_poi_engagements_one_current_per_match_v2
    RENAME TO uq_poi_engagements_one_current_per_match;

  -- Drop the legacy index
  DROP INDEX IF EXISTS public.uq_poi_engagements_one_current_per_match_legacy;
END $$;