
-- Add provenance to poi_engagements so the admin queue can distinguish
-- engagements created manually by a reviewer from engagements that were
-- created automatically when POI mint failed eligibility for ID-only
-- reasons (counterparty named but not yet a registered organisation).
ALTER TABLE public.poi_engagements
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'admin_manual';

-- Constrain to a known vocabulary. Using a CHECK rather than an enum so
-- new sources can be added without a migration churn (the existing audit
-- action values are also free-text strings).
ALTER TABLE public.poi_engagements
  DROP CONSTRAINT IF EXISTS poi_engagements_source_chk;
ALTER TABLE public.poi_engagements
  ADD CONSTRAINT poi_engagements_source_chk
    CHECK (source IN ('admin_manual', 'eligibility_soft_route'));

-- Backfill: every row created prior to this migration was created by the
-- admin path (no other code path inserted rows). The DEFAULT covers new
-- rows; this UPDATE covers the in-place backfill explicitly so the
-- migration is self-contained and the audit trail is unambiguous.
UPDATE public.poi_engagements
   SET source = 'admin_manual'
 WHERE source IS NULL OR source NOT IN ('admin_manual', 'eligibility_soft_route');

-- Index for the admin panel's "show only soft-routed" filter, which is
-- the high-cardinality lookup path.
CREATE INDEX IF NOT EXISTS poi_engagements_source_idx
  ON public.poi_engagements (source);
