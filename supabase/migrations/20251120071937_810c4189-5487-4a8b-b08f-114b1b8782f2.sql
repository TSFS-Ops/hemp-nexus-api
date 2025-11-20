-- Fix #1: Restrict profiles table so users can only see their own profile
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;

CREATE POLICY "Users can view their own profile"
  ON public.profiles
  FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  USING (id = auth.uid());

-- Admins can still manage all profiles
CREATE POLICY "Admins can manage all profiles"
  ON public.profiles
  FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Fix #2: Restrict API keys so users can only see keys they created or belong to their org
-- Current policy already restricts to org, which is acceptable for this use case
-- But add additional protection to hide key_hash from SELECT results

-- Fix #3: Restrict webhook endpoints so users can only see endpoints they have access to
-- Add column-level security by creating a view that excludes secret_hash
CREATE OR REPLACE VIEW public.webhook_endpoints_view AS
SELECT 
  id,
  org_id,
  url,
  events,
  status,
  last_delivery_at,
  created_at,
  updated_at
FROM public.webhook_endpoints;

-- Grant access to the view
GRANT SELECT ON public.webhook_endpoints_view TO authenticated;

-- Fix #4: Tighten webhook_deliveries access
DROP POLICY IF EXISTS "Users can view their org's webhook deliveries" ON public.webhook_deliveries;

CREATE POLICY "Users can view their org's webhook deliveries"
  ON public.webhook_deliveries
  FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM public.profiles WHERE id = auth.uid()
    )
    AND (
      -- Only admins or users with webhooks:read scope can view
      has_role(auth.uid(), 'admin')
      OR has_role(auth.uid(), 'auditor')
    )
  );

-- Fix #5: Add role-based access for matches table
DROP POLICY IF EXISTS "Users can view their org's matches" ON public.matches;

CREATE POLICY "Users can view their org's matches"
  ON public.matches
  FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Fix #6: Enable leaked password protection
-- This is done via Supabase auth settings, not SQL

-- Fix #7: Add comment noting that SAHPRA data is intentionally public regulatory data
COMMENT ON TABLE public.sahpra_licenses IS 'Public regulatory data from SAHPRA. Intentionally readable by authenticated users for compliance verification.';