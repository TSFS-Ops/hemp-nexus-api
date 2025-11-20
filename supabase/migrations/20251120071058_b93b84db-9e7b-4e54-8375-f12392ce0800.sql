-- Create webhook_deliveries table to track all delivery attempts
CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  webhook_endpoint_id UUID NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  response_status_code INTEGER,
  response_body TEXT,
  error_message TEXT,
  delivery_attempt INTEGER NOT NULL DEFAULT 1,
  delivered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org_id ON public.webhook_deliveries(org_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_endpoint_id ON public.webhook_deliveries(webhook_endpoint_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at ON public.webhook_deliveries(created_at DESC);

-- Enable RLS
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Users can view their org's webhook deliveries
CREATE POLICY "Users can view their org's webhook deliveries"
  ON public.webhook_deliveries
  FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Service role can insert webhook deliveries
CREATE POLICY "Service role can insert webhook deliveries"
  ON public.webhook_deliveries
  FOR INSERT
  WITH CHECK (
    (auth.jwt() ->> 'role') = 'service_role'
  );