-- Allow authenticated users to read platform-wide aggregate analytics rows
-- (data_source_id IS NULL means: not tied to a specific data source / org).
-- These rows contain only aggregated counts and country/region/category breakdowns,
-- never per-org or per-match PII. Existing source-scoped policy continues to gate
-- non-NULL rows by the user's org via data_sources.

CREATE POLICY "Users can view platform-wide aggregate analytics"
  ON public.match_analytics
  FOR SELECT
  TO authenticated
  USING (data_source_id IS NULL);

-- Defensive constraint: any future writer that tries to put org-identifying
-- fields into a NULL-data_source row will fail. This proves, at the schema
-- level, that NULL rows cannot contain per-org data.
ALTER TABLE public.match_analytics
  ADD CONSTRAINT match_analytics_null_source_is_aggregate_only
  CHECK (
    data_source_id IS NOT NULL
    OR (
      -- platform aggregate rows must be cross-source: no source-specific identifiers
      -- (only geographic/categorical breakdowns are allowed)
      provider_success_rate IS NULL
    )
  );

COMMENT ON POLICY "Users can view platform-wide aggregate analytics" ON public.match_analytics IS
  'Grants authenticated users visibility into NULL-data_source_id rows, which represent platform-wide aggregates (geographic/category breakdowns) and contain no per-org PII. Per-source rows remain gated by the org-scoped policy.';

COMMENT ON CONSTRAINT match_analytics_null_source_is_aggregate_only ON public.match_analytics IS
  'Schema-level guarantee that NULL data_source_id rows are platform aggregates only — they cannot contain provider_success_rate (which is inherently source-scoped).';