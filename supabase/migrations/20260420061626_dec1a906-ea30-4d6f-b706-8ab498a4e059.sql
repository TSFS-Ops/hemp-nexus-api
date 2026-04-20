-- Tighten profiles RLS: replace permissive 'admin' role with 'platform_admin' for cross-org access,
-- and add a scoped same-org SELECT policy so colleagues (not strangers) can see each other.

-- 1. Drop the over-broad legacy admin policies that use the generic 'admin' enum
DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;

-- 2. Helper: check whether two users share the same org (security definer to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_same_org(_viewer_id uuid, _target_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles v
    JOIN public.profiles t ON t.org_id = v.org_id
    WHERE v.id = _viewer_id
      AND t.id = _target_id
      AND v.org_id IS NOT NULL
  )
$$;

-- 3. Platform admins (true global super-users) can manage all profiles
CREATE POLICY "Platform admins can manage all profiles"
  ON public.profiles
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'platform_admin'));

-- 4. Org admins can read profiles within their own organisation (team management)
CREATE POLICY "Org admins can view profiles in their org"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'org_admin')
    AND public.is_same_org(auth.uid(), id)
  );

-- 5. Same-org members can view colleagues (needed for team UI; never crosses orgs)
CREATE POLICY "Org members can view colleagues in same org"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.is_same_org(auth.uid(), id)
  );