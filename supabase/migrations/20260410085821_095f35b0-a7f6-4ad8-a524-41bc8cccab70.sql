-- Add origin and destination country fields to matches for jurisdiction signal derivation
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS origin_country text,
  ADD COLUMN IF NOT EXISTS destination_country text;

-- Index for potential filtering
CREATE INDEX IF NOT EXISTS idx_matches_origin_country ON public.matches (origin_country) WHERE origin_country IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matches_destination_country ON public.matches (destination_country) WHERE destination_country IS NOT NULL;