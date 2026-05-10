-- D1.5 schema proof. Read-only. Returns one row of named boolean assertions.

WITH
poi_cols AS (
  SELECT array_agg(column_name ORDER BY column_name) AS names
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='poi_engagements'
    AND column_name IN ('operational_state','operational_state_set_at','operational_state_set_by')
),
match_cols AS (
  SELECT array_agg(column_name ORDER BY column_name) AS names
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='matches'
    AND column_name IN ('buyer_authorised_user_id','seller_authorised_user_id')
),
op_check AS (
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conname='poi_engagements_operational_state_check'
),
op_set_by_fk AS (
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conname='poi_engagements_operational_state_set_by_fk'
),
buyer_fk AS (
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conname='matches_buyer_authorised_user_fk'
),
seller_fk AS (
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conname='matches_seller_authorised_user_fk'
),
idx_op AS (
  SELECT indexdef AS def FROM pg_indexes
  WHERE schemaname='public' AND indexname='idx_poi_engagements_operational_state'
),
idx_op_by AS (
  SELECT indexdef AS def FROM pg_indexes
  WHERE schemaname='public' AND indexname='idx_poi_engagements_operational_state_set_by'
),
idx_buyer AS (
  SELECT indexdef AS def FROM pg_indexes
  WHERE schemaname='public' AND indexname='idx_matches_buyer_authorised_user'
),
idx_seller AS (
  SELECT indexdef AS def FROM pg_indexes
  WHERE schemaname='public' AND indexname='idx_matches_seller_authorised_user'
)
SELECT
  ((SELECT names FROM poi_cols)   = ARRAY['operational_state','operational_state_set_at','operational_state_set_by']) AS poi_engagements_three_columns,
  ((SELECT names FROM match_cols) = ARRAY['buyer_authorised_user_id','seller_authorised_user_id'])                    AS matches_two_columns,
  ((SELECT def FROM op_check) ILIKE '%binding_review_required%'
   AND (SELECT def FROM op_check) ILIKE '%contact_missing%'
   AND (SELECT def FROM op_check) ILIKE '%cancelled_for_email_change%'
   AND (SELECT def FROM op_check) ILIKE '%suppressed_or_test_review%')                                                 AS operational_state_check_full_list,
  ((SELECT def FROM op_set_by_fk) ILIKE '%REFERENCES auth.users(id)%'
   AND (SELECT def FROM op_set_by_fk) ILIKE '%ON DELETE SET NULL%')                                                    AS operational_state_set_by_fk_ok,
  ((SELECT def FROM buyer_fk)  ILIKE '%REFERENCES auth.users(id)%' AND (SELECT def FROM buyer_fk)  ILIKE '%ON DELETE SET NULL%') AS buyer_authorised_fk_ok,
  ((SELECT def FROM seller_fk) ILIKE '%REFERENCES auth.users(id)%' AND (SELECT def FROM seller_fk) ILIKE '%ON DELETE SET NULL%') AS seller_authorised_fk_ok,
  ((SELECT def FROM idx_op)    ILIKE '%operational_state IS NOT NULL%')                AS idx_operational_state_present,
  ((SELECT def FROM idx_op_by) ILIKE '%operational_state_set_by IS NOT NULL%')         AS idx_operational_state_set_by_present,
  ((SELECT def FROM idx_buyer) ILIKE '%buyer_authorised_user_id IS NOT NULL%')         AS idx_matches_buyer_authorised_present,
  ((SELECT def FROM idx_seller)ILIKE '%seller_authorised_user_id IS NOT NULL%')        AS idx_matches_seller_authorised_present;
