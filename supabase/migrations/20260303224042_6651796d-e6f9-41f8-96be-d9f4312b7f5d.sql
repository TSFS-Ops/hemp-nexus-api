
-- Create append-only poi_events table for state transition history
CREATE TABLE public.poi_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  from_state text NOT NULL,
  to_state text NOT NULL,
  actor_user_id uuid,
  actor_api_key_id uuid,
  reason text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add poi_state column to matches
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS poi_state text NOT NULL DEFAULT 'DRAFT';

-- RLS
ALTER TABLE public.poi_events ENABLE ROW LEVEL SECURITY;

-- Append-only: only INSERT allowed via service role, no UPDATE/DELETE
CREATE POLICY "Service role can insert poi events"
  ON public.poi_events FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Users can view their org poi events"
  ON public.poi_events FOR SELECT
  USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY "Admins can view all poi events"
  ON public.poi_events FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Indexes
CREATE INDEX idx_poi_events_match_id ON public.poi_events(match_id);
CREATE INDEX idx_poi_events_created_at ON public.poi_events(created_at);
CREATE INDEX idx_matches_poi_state ON public.matches(poi_state);
