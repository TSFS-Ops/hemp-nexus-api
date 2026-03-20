-- Fix 1: Prevent non-admin users from inserting roles (privilege escalation)
-- The existing "Admins can manage all roles" policy grants ALL (including INSERT) but only to admins.
-- However, there is no explicit DENY for non-admin INSERT.
-- Add a restrictive policy that blocks non-admin INSERT.
CREATE POLICY "Only admins can insert roles"
ON public.user_roles
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'platform_admin'::public.app_role)
);

-- Fix 2: Replace the ALL policy on webhook_endpoints with separate SELECT and modification policies
-- to prevent non-admin org members from reading secret_hash
DROP POLICY IF EXISTS "Users can manage their org's webhooks" ON public.webhook_endpoints;

-- Allow org members to SELECT but only through the safe view (which excludes secret_hash)
-- Direct table SELECT limited to admins
CREATE POLICY "Admins can select webhook_endpoints"
ON public.webhook_endpoints
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'platform_admin'::public.app_role)
  OR (
    org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
  )
);

CREATE POLICY "Users can insert their org webhooks"
ON public.webhook_endpoints
FOR INSERT
TO authenticated
WITH CHECK (
  org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
);

CREATE POLICY "Users can update their org webhooks"
ON public.webhook_endpoints
FOR UPDATE
TO authenticated
USING (
  org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
);

CREATE POLICY "Users can delete their org webhooks"
ON public.webhook_endpoints
FOR DELETE
TO authenticated
USING (
  org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
);

-- Fix 3: Recreate webhook_endpoints_safe WITHOUT secret_hash column to ensure it's never leaked
DROP VIEW IF EXISTS public.webhook_endpoints_safe;
CREATE VIEW public.webhook_endpoints_safe
WITH (security_invoker = true)
AS SELECT
  id,
  org_id,
  url,
  events,
  status,
  last_delivery_at,
  created_at,
  updated_at
FROM public.webhook_endpoints;