
-- Fix 1: poi_engagements SELECT policy — change 'admin' to 'platform_admin'
DROP POLICY IF EXISTS "Match participants can view engagements" ON public.poi_engagements;

CREATE POLICY "Match participants can view engagements"
  ON public.poi_engagements
  FOR SELECT
  TO authenticated
  USING (
    public.is_match_participant(auth.uid(), match_id)
    OR public.has_role(auth.uid(), 'platform_admin'::public.app_role)
  );

-- Fix 2: archived-records storage policy — change 'admin' to 'platform_admin'
DROP POLICY IF EXISTS "Admins can read archived records" ON storage.objects;

CREATE POLICY "Admins can read archived records"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'archived-records'
    AND public.has_role(auth.uid(), 'platform_admin'::public.app_role)
  );
