CREATE TABLE IF NOT EXISTS public.engagement_outreach_drafts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES public.poi_engagements(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','approved','rejected')),
  draft_subject text NOT NULL,
  draft_body text NOT NULL,
  context_summary text,
  model text,
  ai_confidence text CHECK (ai_confidence IS NULL OR ai_confidence IN ('low','medium','high')),
  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  review_note text,
  regenerated_from uuid REFERENCES public.engagement_outreach_drafts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eod_engagement_id ON public.engagement_outreach_drafts(engagement_id);
CREATE INDEX IF NOT EXISTS idx_eod_org_id ON public.engagement_outreach_drafts(org_id);
CREATE INDEX IF NOT EXISTS idx_eod_status ON public.engagement_outreach_drafts(status);

GRANT SELECT, INSERT, UPDATE ON public.engagement_outreach_drafts TO authenticated;
GRANT ALL ON public.engagement_outreach_drafts TO service_role;

ALTER TABLE public.engagement_outreach_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins can view drafts"
  ON public.engagement_outreach_drafts
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "admins can insert drafts"
  ON public.engagement_outreach_drafts
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "admins can update drafts"
  ON public.engagement_outreach_drafts
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_engagement_outreach_drafts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_eod_updated_at ON public.engagement_outreach_drafts;
CREATE TRIGGER trg_eod_updated_at
  BEFORE UPDATE ON public.engagement_outreach_drafts
  FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_outreach_drafts_updated_at();