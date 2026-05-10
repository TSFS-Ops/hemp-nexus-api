-- D1 schema proof. Read-only. Executed by scripts/check-d1-drift.mjs.
-- Returns one row with named boolean assertions; any FALSE means drift.

WITH
enum_vals AS (
  SELECT array_agg(v ORDER BY v) AS vals
  FROM (SELECT unnest(enum_range(NULL::engagement_status))::text AS v) t
),
new_cols AS (
  SELECT array_agg(column_name ORDER BY column_name) AS names
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'poi_engagements'
    AND column_name IN (
      'cancelled_at','cancelled_reason','cancelled_by_user_id',
      'replacement_engagement_id','binding_candidates','binding_resolution',
      'disputed_at','disputed_by_token_hash','dispute_reason','dispute_metadata'
    )
),
replacement_fk AS (
  SELECT pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conname  = 'poi_engagements_replacement_fk'
    AND conrelid = 'public.poi_engagements'::regclass
),
expires_default AS (
  SELECT column_default AS def
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'poi_engagements'
    AND column_name  = 'expires_at'
),
entry_type_check AS (
  SELECT pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conname = 'engagement_outreach_logs_entry_type_check'
),
canonical_index AS (
  SELECT indexdef AS def
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname  = 'uq_poi_engagements_one_current_per_match'
),
legacy_index AS (
  SELECT count(*) AS c
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname  = 'uq_poi_engagements_one_current_per_match_legacy'
),
predicate_violations AS (
  SELECT count(*) AS c FROM (
    SELECT match_id
    FROM public.poi_engagements
    WHERE engagement_status NOT IN ('expired','declined','cancelled_email_change')
    GROUP BY match_id HAVING count(*) > 1
  ) v
)
SELECT
  -- A. enum contains both new values
  ((SELECT vals FROM enum_vals) @> ARRAY['cancelled_email_change','disputed_being_named']::text[]) AS enum_has_new_values,
  -- B. all 10 new columns exist
  (array_length((SELECT names FROM new_cols), 1) = 10)                                              AS all_10_columns_present,
  -- C. replacement FK exists and contains ON DELETE RESTRICT
  ((SELECT def FROM replacement_fk) IS NOT NULL
   AND (SELECT def FROM replacement_fk) ILIKE '%ON DELETE RESTRICT%')                              AS replacement_fk_on_delete_restrict,
  -- D. expires_at default is 7 days
  ((SELECT def FROM expires_default) ILIKE '%7 days%')                                              AS expires_default_7_days,
  -- E. entry_type check contains the 5 new values
  ((SELECT def FROM entry_type_check) ILIKE '%binding_review_resolved%'
   AND (SELECT def FROM entry_type_check) ILIKE '%dispute_raised%'
   AND (SELECT def FROM entry_type_check) ILIKE '%dispute_resolved%'
   AND (SELECT def FROM entry_type_check) ILIKE '%''cancelled''%'
   AND (SELECT def FROM entry_type_check) ILIKE '%''replaced''%')                                   AS entry_type_check_expanded,
  -- F. canonical index excludes exactly expired, declined, cancelled_email_change
  ((SELECT def FROM canonical_index) ILIKE '%expired%'
   AND (SELECT def FROM canonical_index) ILIKE '%declined%'
   AND (SELECT def FROM canonical_index) ILIKE '%cancelled_email_change%')                          AS canonical_index_excludes_inactive,
  -- G. canonical index does NOT exclude disputed_being_named (it stays active)
  ((SELECT def FROM canonical_index) NOT ILIKE '%disputed_being_named%')                            AS canonical_index_keeps_disputed_active,
  -- H. legacy index removed
  ((SELECT c FROM legacy_index) = 0)                                                                AS legacy_index_dropped,
  -- I. no current rows violate the new predicate
  ((SELECT c FROM predicate_violations) = 0)                                                        AS no_predicate_violations;
