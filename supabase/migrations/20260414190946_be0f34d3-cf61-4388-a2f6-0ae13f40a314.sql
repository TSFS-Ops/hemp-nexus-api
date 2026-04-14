
-- 1. Create the trade_requests table
CREATE TABLE public.trade_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  commodity TEXT,
  quantity_amount NUMERIC,
  quantity_unit TEXT,
  price_amount NUMERIC,
  price_currency TEXT DEFAULT 'ZAR',
  side TEXT CHECK (side IN ('buyer', 'seller')),
  location TEXT,
  match_type TEXT DEFAULT 'bilateral' CHECK (match_type IN ('bilateral', 'unilateral')),
  metadata JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'exhausted', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Add trade_request_id to matches
ALTER TABLE public.matches
  ADD COLUMN trade_request_id UUID REFERENCES public.trade_requests(id);

-- 3. Index for lookups
CREATE INDEX idx_trade_requests_org_id ON public.trade_requests(org_id);
CREATE INDEX idx_trade_requests_status ON public.trade_requests(status);
CREATE INDEX idx_matches_trade_request_id ON public.matches(trade_request_id);

-- 4. Enable RLS
ALTER TABLE public.trade_requests ENABLE ROW LEVEL SECURITY;

-- 5. RLS policies
CREATE POLICY "Users can view own org trade requests"
  ON public.trade_requests FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can create trade requests for own org"
  ON public.trade_requests FOR INSERT
  TO authenticated
  WITH CHECK (org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update own org trade requests"
  ON public.trade_requests FOR UPDATE
  TO authenticated
  USING (org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()));

-- Admins can view all
CREATE POLICY "Admins can view all trade requests"
  ON public.trade_requests FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 6. Updated_at trigger
CREATE TRIGGER update_trade_requests_updated_at
  BEFORE UPDATE ON public.trade_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
