-- Create matches table for Trade.Izenzo API v1
CREATE TABLE IF NOT EXISTS public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'matched' CHECK (status IN ('matched', 'settled')),
  hash TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  buyer_name TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  seller_name TEXT NOT NULL,
  commodity TEXT NOT NULL,
  quantity_amount NUMERIC NOT NULL,
  quantity_unit TEXT NOT NULL,
  price_amount NUMERIC NOT NULL,
  price_currency TEXT NOT NULL,
  terms TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  settled_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

-- Policy: API keys can manage all matches (via service role)
CREATE POLICY "Service role can manage all matches"
ON public.matches
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Policy: Authenticated users can view matches
CREATE POLICY "Authenticated users can view matches"
ON public.matches
FOR SELECT
TO authenticated
USING (true);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_matches_status ON public.matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_created_at ON public.matches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_buyer_id ON public.matches(buyer_id);
CREATE INDEX IF NOT EXISTS idx_matches_seller_id ON public.matches(seller_id);