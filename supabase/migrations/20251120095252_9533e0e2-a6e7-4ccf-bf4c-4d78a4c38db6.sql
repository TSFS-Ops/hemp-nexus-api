-- Add sandbox seed data for demo purposes
-- This creates realistic sample data for quickstart testing

-- Insert sample organization for sandbox testing (if not exists)
INSERT INTO public.organizations (id, name, status, sandbox_enabled, sahpra_verified)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Demo Pharmacy Ltd (Sandbox)',
  'active',
  true,
  true
) ON CONFLICT (id) DO NOTHING;

-- Insert sample data source
INSERT INTO public.data_sources (id, org_id, name, type, status, config)
VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Demo Medical Suppliers',
  'marketplace',
  'active',
  '{"sandbox": true}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Add event chaining columns to matches table for evidence trail
ALTER TABLE public.matches
ADD COLUMN IF NOT EXISTS event_chain_hash TEXT,
ADD COLUMN IF NOT EXISTS previous_event_hash TEXT;

-- Create match_events table for detailed timeline
CREATE TABLE IF NOT EXISTS public.match_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID,
  actor_api_key_id UUID,
  payload_hash TEXT NOT NULL,
  previous_event_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for match_events
CREATE INDEX IF NOT EXISTS idx_match_events_match ON public.match_events(match_id);
CREATE INDEX IF NOT EXISTS idx_match_events_created ON public.match_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_events_type ON public.match_events(event_type);

-- Enable RLS on match_events
ALTER TABLE public.match_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for match_events
CREATE POLICY "Users can view their org's match events"
  ON public.match_events
  FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Service role can insert match events"
  ON public.match_events
  FOR INSERT
  WITH CHECK (
    (auth.jwt() ->> 'role') = 'service_role'
  );

-- Function to generate event hash
CREATE OR REPLACE FUNCTION generate_event_hash(
  event_type TEXT,
  event_data JSONB,
  previous_hash TEXT
) RETURNS TEXT AS $$
DECLARE
  payload TEXT;
BEGIN
  payload := event_type || event_data::text || COALESCE(previous_hash, '');
  RETURN encode(digest(payload, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add comment
COMMENT ON TABLE public.match_events IS 'Tamper-evident event timeline for matches with hash chaining';

-- Create view for evidence packs
CREATE OR REPLACE VIEW public.match_evidence AS
SELECT 
  m.id as match_id,
  m.org_id,
  m.hash as match_hash,
  m.status,
  m.created_at as match_created_at,
  m.settled_at,
  jsonb_build_object(
    'buyer', jsonb_build_object('id', m.buyer_id, 'name', m.buyer_name),
    'seller', jsonb_build_object('id', m.seller_id, 'name', m.seller_name),
    'commodity', m.commodity,
    'quantity', jsonb_build_object('amount', m.quantity_amount, 'unit', m.quantity_unit),
    'price', jsonb_build_object('amount', m.price_amount, 'currency', m.price_currency),
    'terms', m.terms
  ) as match_data,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', me.id,
        'type', me.event_type,
        'timestamp', me.created_at,
        'data', me.event_data,
        'hash', me.payload_hash,
        'previousHash', me.previous_event_hash
      ) ORDER BY me.created_at ASC
    )
    FROM public.match_events me
    WHERE me.match_id = m.id
  ) as event_timeline
FROM public.matches m;