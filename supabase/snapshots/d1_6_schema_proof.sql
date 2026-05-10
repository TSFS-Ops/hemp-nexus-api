-- D1.6 schema proof. Read-only. Returns one row of named boolean assertions.
-- Verifies Option C: admin-recorded disputes can omit token hash; token-based
-- disputes still require it.

WITH
src_col AS (
  SELECT data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='poi_engagements'
    AND column_name='dispute_source'
),
src_check AS (
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conname='poi_engagements_dispute_source_check'
),
req_check AS (
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conname='poi_engagements_dispute_required_fields'
)
SELECT
  ((SELECT data_type FROM src_col) = 'text'
   AND (SELECT is_nullable FROM src_col) = 'YES')                              AS dispute_source_column_nullable_text,
  ((SELECT def FROM src_check) ILIKE '%counterparty_token%'
   AND (SELECT def FROM src_check) ILIKE '%admin_report%')                     AS dispute_source_check_present,
  ((SELECT def FROM req_check) ILIKE '%dispute_source IS NULL%'
   AND (SELECT def FROM req_check) ILIKE '%dispute_source IS NOT NULL%'
   AND (SELECT def FROM req_check) ILIKE '%counterparty_token%'
   AND (SELECT def FROM req_check) ILIKE '%admin_report%'
   AND (SELECT def FROM req_check) ILIKE '%disputed_by_token_hash IS NOT NULL%') AS dispute_required_fields_source_aware;
