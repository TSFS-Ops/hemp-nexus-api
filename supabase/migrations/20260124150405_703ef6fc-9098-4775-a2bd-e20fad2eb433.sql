-- Create invites table for counterparty invite flow
CREATE TABLE public.invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_user_id UUID,
  from_org_id UUID NOT NULL,
  to_email TEXT,
  to_org_id UUID,
  search_query TEXT,
  search_results JSONB DEFAULT '[]'::jsonb,
  selected_result_id TEXT NOT NULL,
  selected_result_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  declined_reason TEXT,
  match_id UUID,
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days'),
  CONSTRAINT invites_status_check CHECK (status IN ('pending', 'accepted', 'declined', 'expired'))
);

-- Enable RLS
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

-- Create indexes for performance
CREATE INDEX idx_invites_from_org ON public.invites(from_org_id);
CREATE INDEX idx_invites_to_org ON public.invites(to_org_id);
CREATE INDEX idx_invites_to_email ON public.invites(to_email);
CREATE INDEX idx_invites_status ON public.invites(status);
CREATE INDEX idx_invites_created_at ON public.invites(created_at DESC);

-- RLS Policies

-- Users can view invites they sent
CREATE POLICY "Users can view their org sent invites" ON public.invites
  FOR SELECT USING (
    from_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  );

-- Users can create invites for their org
CREATE POLICY "Users can create invites for their org" ON public.invites
  FOR INSERT WITH CHECK (
    from_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  );

-- Recipients can view invites sent to their org
CREATE POLICY "Recipients can view invites to their org" ON public.invites
  FOR SELECT USING (
    to_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  );

-- Recipients can view invites sent to their email
CREATE POLICY "Recipients can view invites to their email" ON public.invites
  FOR SELECT USING (
    to_email IN (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Recipients can update (accept/decline) invites sent to them
CREATE POLICY "Recipients can accept decline invites to their org" ON public.invites
  FOR UPDATE USING (
    to_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Recipients can accept decline invites to their email" ON public.invites
  FOR UPDATE USING (
    to_email IN (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Senders can update their own invites (e.g., link match_id after confirmation)
CREATE POLICY "Senders can update their invites" ON public.invites
  FOR UPDATE USING (
    from_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  );

-- Admins can view all invites
CREATE POLICY "Admins can view all invites" ON public.invites
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- Service role can manage all invites
CREATE POLICY "Service role can manage invites" ON public.invites
  FOR ALL USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- Create trigger for updated_at
CREATE TRIGGER update_invites_updated_at
  BEFORE UPDATE ON public.invites
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();