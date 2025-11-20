-- Create comprehensive API request logs table
CREATE TABLE public.api_request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  api_key_id UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_time_ms INTEGER NOT NULL,
  request_body JSONB,
  response_body JSONB,
  error_message TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_id TEXT,
  idempotency_key TEXT
);

-- Add indexes for common queries
CREATE INDEX idx_api_request_logs_org_id ON public.api_request_logs(org_id);
CREATE INDEX idx_api_request_logs_api_key_id ON public.api_request_logs(api_key_id);
CREATE INDEX idx_api_request_logs_created_at ON public.api_request_logs(created_at DESC);
CREATE INDEX idx_api_request_logs_endpoint ON public.api_request_logs(endpoint);
CREATE INDEX idx_api_request_logs_status_code ON public.api_request_logs(status_code);
CREATE INDEX idx_api_request_logs_request_id ON public.api_request_logs(request_id);

-- Enable RLS
ALTER TABLE public.api_request_logs ENABLE ROW LEVEL SECURITY;

-- Admins can view all logs
CREATE POLICY "Admins can view all API request logs"
ON public.api_request_logs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Service role can insert logs
CREATE POLICY "Service role can insert API request logs"
ON public.api_request_logs
FOR INSERT
TO authenticated
WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- Users can view their org's logs
CREATE POLICY "Users can view their org's API request logs"
ON public.api_request_logs
FOR SELECT
TO authenticated
USING (
  org_id IN (
    SELECT org_id FROM public.profiles WHERE id = auth.uid()
  )
);

-- Create admin actions audit table
CREATE TABLE public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add index
CREATE INDEX idx_admin_audit_logs_admin_user_id ON public.admin_audit_logs(admin_user_id);
CREATE INDEX idx_admin_audit_logs_created_at ON public.admin_audit_logs(created_at DESC);
CREATE INDEX idx_admin_audit_logs_action ON public.admin_audit_logs(action);

-- Enable RLS
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view admin audit logs
CREATE POLICY "Admins can view admin audit logs"
ON public.admin_audit_logs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Service role can insert admin audit logs
CREATE POLICY "Service role can insert admin audit logs"
ON public.admin_audit_logs
FOR INSERT
TO authenticated
WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- Add key_history column to api_keys for rotation tracking
ALTER TABLE public.api_keys
ADD COLUMN IF NOT EXISTS key_history JSONB DEFAULT '[]'::jsonb;