-- Privacy Batch 2: profiles colleague privacy
-- Drop overly permissive colleague SELECT policy
DROP POLICY IF EXISTS "Org members can view colleagues in same org" ON public.profiles;

-- Replace org admin policy with one routed via is_org_admin (admin must be admin of viewer's own org, viewing colleague in same org)
DROP POLICY IF EXISTS "Org admins can view profiles in their org" ON public.profiles;

CREATE POLICY "Org admins can view full profiles in their org"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  is_org_admin(auth.uid(), org_id)
);

-- Note: "Users can view their own profile" and "Platform admins can manage all profiles" remain untouched.

-- Safe redacted colleague view: no email, no deletion metadata
CREATE OR REPLACE VIEW public.org_colleagues_v
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.org_id,
  p.full_name,
  p.status,
  p.selected_persona
FROM public.profiles p
WHERE p.org_id IS NOT NULL
  AND is_same_org(auth.uid(), p.id);

GRANT SELECT ON public.org_colleagues_v TO authenticated;

COMMENT ON VIEW public.org_colleagues_v IS
  'Privacy Batch 2: redacted colleague directory. Exposes non-sensitive identity fields only (id, org_id, full_name, status, selected_persona). Excludes email and all sensitive/deletion metadata. SECURITY INVOKER so underlying profiles RLS is enforced for the calling user.';