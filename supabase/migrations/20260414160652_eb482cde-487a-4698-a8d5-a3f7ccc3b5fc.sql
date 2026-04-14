
-- Create engagement status enum
CREATE TYPE public.engagement_status AS ENUM (
  'notification_sent',
  'contacted',
  'accepted',
  'declined',
  'expired'
);

CREATE TYPE public.counterparty_type AS ENUM (
  'known',
  'unknown'
);

-- Create poi_engagements table
CREATE TABLE public.poi_engagements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id),
  counterparty_email TEXT,
  counterparty_org_id UUID REFERENCES public.organizations(id),
  counterparty_type public.counterparty_type NOT NULL DEFAULT 'unknown',
  engagement_status public.engagement_status NOT NULL DEFAULT 'notification_sent',
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '30 days'),
  contacted_at TIMESTAMP WITH TIME ZONE,
  responded_at TIMESTAMP WITH TIME ZONE,
  admin_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_match_engagement UNIQUE (match_id)
);

-- Index for auto-link lookup by email
CREATE INDEX idx_poi_engagements_counterparty_email 
  ON public.poi_engagements (counterparty_email) 
  WHERE counterparty_email IS NOT NULL;

-- Index for admin queue filtering
CREATE INDEX idx_poi_engagements_status 
  ON public.poi_engagements (engagement_status, counterparty_type);

-- Index for expiry countdown
CREATE INDEX idx_poi_engagements_expires_at 
  ON public.poi_engagements (expires_at) 
  WHERE engagement_status NOT IN ('accepted', 'declined', 'expired');

-- Trigger for updated_at
CREATE TRIGGER update_poi_engagements_updated_at
  BEFORE UPDATE ON public.poi_engagements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.poi_engagements ENABLE ROW LEVEL SECURITY;

-- Policy: Match participants can view their own engagements
CREATE POLICY "Match participants can view engagements"
  ON public.poi_engagements
  FOR SELECT
  TO authenticated
  USING (
    public.is_match_participant(auth.uid(), match_id)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- Policy: Only service role can insert (edge functions handle creation)
CREATE POLICY "Service role can insert engagements"
  ON public.poi_engagements
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Policy: Only service role can update (edge functions handle transitions)
CREATE POLICY "Service role can update engagements"
  ON public.poi_engagements
  FOR UPDATE
  TO service_role
  USING (true);

-- Auto-link function: when a user registers, check if their email matches a pending engagement
CREATE OR REPLACE FUNCTION public.auto_link_counterparty_on_registration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  -- Get the new user's org_id from their profile
  SELECT org_id INTO v_org_id FROM profiles WHERE id = NEW.id;
  
  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Link any pending engagements where email matches
  UPDATE poi_engagements
  SET counterparty_org_id = v_org_id,
      counterparty_type = 'known',
      engagement_status = 'contacted'
  WHERE counterparty_email = NEW.email
    AND counterparty_org_id IS NULL
    AND engagement_status IN ('notification_sent', 'contacted');

  RETURN NEW;
END;
$$;

-- Trigger on profiles table (fires after profile creation via handle_new_user)
CREATE TRIGGER trg_auto_link_counterparty
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_link_counterparty_on_registration();

-- Enable realtime for engagement status updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.poi_engagements;
