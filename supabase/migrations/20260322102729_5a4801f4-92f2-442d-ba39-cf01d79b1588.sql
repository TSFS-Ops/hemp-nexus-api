
-- 1. Trade Orders table (persistent order book)
CREATE TABLE IF NOT EXISTS public.trade_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL,
  side text NOT NULL CHECK (side IN ('bid', 'offer')),
  product text NOT NULL,
  price numeric,
  price_currency text DEFAULT 'USD',
  volume numeric,
  volume_unit text DEFAULT 'MT',
  location text,
  additional_info text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'filled', 'cancelled', 'expired')),
  expires_at timestamptz DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trade_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org orders"
  ON public.trade_orders FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert own org orders"
  ON public.trade_orders FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update own org orders"
  ON public.trade_orders FOR UPDATE TO authenticated
  USING (org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Authenticated users can browse active orders"
  ON public.trade_orders FOR SELECT TO authenticated
  USING (status = 'active');

-- 2. Pod milestone dependencies
ALTER TABLE public.pod_milestones
  ADD COLUMN IF NOT EXISTS depends_on uuid REFERENCES public.pod_milestones(id),
  ADD COLUMN IF NOT EXISTS sequence_order integer DEFAULT 0;

-- 3. Magic bytes verified flag on documents
ALTER TABLE public.match_documents
  ADD COLUMN IF NOT EXISTS magic_bytes_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS server_detected_mime text;
