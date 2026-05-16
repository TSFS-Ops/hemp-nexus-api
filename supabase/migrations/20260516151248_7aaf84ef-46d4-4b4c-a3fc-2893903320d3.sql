ALTER TABLE public.poi_engagements
  ADD COLUMN IF NOT EXISTS superseded_by_engagement_id uuid
    REFERENCES public.poi_engagements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_poi_engagements_superseded_by
  ON public.poi_engagements (superseded_by_engagement_id)
  WHERE superseded_by_engagement_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_poi_engagements_active_match_email
  ON public.poi_engagements (match_id, lower(counterparty_email))
  WHERE counterparty_email IS NOT NULL
    AND engagement_status NOT IN (
      'cancelled_email_change',
      'cancelled_by_initiator',
      'expired',
      'declined'
    );

COMMENT ON COLUMN public.poi_engagements.superseded_by_engagement_id IS
  'Batch J Required Fix 4: when a cancelled-for-email-change row has a replacement engagement created, this points at the replacement so token-resolution endpoints can reject the old invite with ENGAGEMENT_SUPERSEDED.';