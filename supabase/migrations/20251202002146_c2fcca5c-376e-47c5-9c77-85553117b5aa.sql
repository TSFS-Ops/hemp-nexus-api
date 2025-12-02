-- Create admin_risk_items table for persistent risk tracking
CREATE TABLE public.admin_risk_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  severity text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  resolved_at timestamp with time zone,
  resolved_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.admin_risk_items ENABLE ROW LEVEL SECURITY;

-- Only admins can manage risk items
CREATE POLICY "Admins can manage risk items"
  ON public.admin_risk_items
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Create admin_settings table for persistent settings
CREATE TABLE public.admin_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can manage settings
CREATE POLICY "Admins can manage settings"
  ON public.admin_settings
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Create trigger for updated_at
CREATE TRIGGER update_admin_risk_items_updated_at
  BEFORE UPDATE ON public.admin_risk_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_admin_settings_updated_at
  BEFORE UPDATE ON public.admin_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default settings
INSERT INTO public.admin_settings (key, value) VALUES
  ('general', '{"siteName": "Trade.Izenzo", "maintenanceMode": false, "allowNewRegistrations": true}'::jsonb),
  ('api', '{"rateLimit": 100, "defaultExpiry": 90, "requireApproval": false}'::jsonb),
  ('notifications', '{"emailAlerts": true, "slackWebhook": "", "alertThreshold": 10}'::jsonb)
ON CONFLICT (key) DO NOTHING;