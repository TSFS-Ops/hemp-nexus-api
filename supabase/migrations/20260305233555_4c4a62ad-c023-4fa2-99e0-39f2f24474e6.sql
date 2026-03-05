
-- 1. Extend organizations with KYB profile fields
ALTER TABLE public.organizations 
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS trading_name text,
  ADD COLUMN IF NOT EXISTS registration_number text,
  ADD COLUMN IF NOT EXISTS address jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS jurisdictions text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tax_number text,
  ADD COLUMN IF NOT EXISTS vat_number text,
  ADD COLUMN IF NOT EXISTS authorised_signatory text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS industry text;

-- 2. Notifications table (realtime-enabled)
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- 3. Match notes / comments
CREATE TABLE IF NOT EXISTS public.match_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.match_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view match notes" ON public.match_notes
  FOR SELECT USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users create match notes" ON public.match_notes
  FOR INSERT WITH CHECK (auth.uid() = user_id AND org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

-- 4. Deal terms per match
CREATE TABLE IF NOT EXISTS public.deal_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  proposed_by uuid,
  payment_terms text,
  delivery_terms text,
  inspection_terms text,
  penalty_terms text,
  partial_shipment boolean DEFAULT false,
  amendment_notes text,
  version integer DEFAULT 1,
  status text DEFAULT 'proposed',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.deal_terms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view deal terms" ON public.deal_terms
  FOR SELECT USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Org members create deal terms" ON public.deal_terms
  FOR INSERT WITH CHECK (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

-- 5. Disputes
CREATE TABLE IF NOT EXISTS public.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  raised_by_org_id uuid NOT NULL REFERENCES public.organizations(id),
  raised_by_user_id uuid NOT NULL,
  reason text NOT NULL,
  evidence_notes text,
  status text DEFAULT 'open',
  resolution_outcome text,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members view disputes" ON public.disputes
  FOR SELECT USING (raised_by_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()) OR public.is_admin(auth.uid()));

CREATE POLICY "Org members create disputes" ON public.disputes
  FOR INSERT WITH CHECK (raised_by_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Org members update disputes" ON public.disputes
  FOR UPDATE USING (raised_by_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

-- 6. Team invitations
CREATE TABLE IF NOT EXISTS public.team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text DEFAULT 'org_member',
  invited_by uuid NOT NULL,
  status text DEFAULT 'pending',
  accepted_at timestamptz,
  expires_at timestamptz DEFAULT (now() + interval '7 days'),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins manage invitations" ON public.team_invitations
  FOR ALL USING (public.is_org_admin(auth.uid(), org_id));

CREATE POLICY "Invited users view invitations" ON public.team_invitations
  FOR SELECT USING (email IN (SELECT email FROM public.profiles WHERE id = auth.uid()));
