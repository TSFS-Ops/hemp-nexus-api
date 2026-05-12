ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

ALTER TABLE public.poi_engagements
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_matches_is_demo
  ON public.matches (is_demo)
  WHERE is_demo = true;

CREATE INDEX IF NOT EXISTS idx_poi_engagements_is_demo_status
  ON public.poi_engagements (is_demo, engagement_status);

COMMENT ON COLUMN public.matches.is_demo IS
  'Phase 1 demo isolation primitive. When true, lifecycle/SLA/notification/billing paths must skip this row and HQ panels must hide it by default.';
COMMENT ON COLUMN public.poi_engagements.is_demo IS
  'Phase 1 demo isolation primitive. When true, lifecycle/SLA/notification/billing paths must skip this row and HQ panels must hide it by default.';