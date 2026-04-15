-- Immutable outreach log for engagement tracking
CREATE TABLE public.engagement_outreach_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  engagement_id UUID NOT NULL REFERENCES public.poi_engagements(id) ON DELETE RESTRICT,
  admin_user_id UUID NOT NULL,
  admin_email TEXT NOT NULL,
  admin_name TEXT,
  contact_method TEXT NOT NULL CHECK (contact_method IN ('email', 'phone', 'linkedin', 'whatsapp', 'in_person', 'other')),
  contact_detail TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_outreach_logs_engagement ON public.engagement_outreach_logs(engagement_id);
CREATE INDEX idx_outreach_logs_admin ON public.engagement_outreach_logs(admin_user_id);

-- Enable RLS
ALTER TABLE public.engagement_outreach_logs ENABLE ROW LEVEL SECURITY;

-- Only platform admins can read
CREATE POLICY "Admins can view outreach logs"
ON public.engagement_outreach_logs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- No direct inserts from client — service role only (edge function)
-- No UPDATE or DELETE policies at all

-- Immutability trigger — prevent any UPDATE or DELETE
CREATE OR REPLACE FUNCTION public.prevent_outreach_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'Outreach log is append-only. No mutations permitted.';
END;
$$;

CREATE TRIGGER enforce_outreach_log_immutability
BEFORE UPDATE OR DELETE ON public.engagement_outreach_logs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_outreach_log_mutation();