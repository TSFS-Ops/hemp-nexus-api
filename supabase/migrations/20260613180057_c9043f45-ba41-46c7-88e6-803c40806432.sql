
CREATE OR REPLACE FUNCTION public.facilitation_case_visible(_user uuid, _case uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.facilitation_cases fc
    WHERE fc.id = _case
      AND (
        fc.requesting_org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = _user)
        OR fc.case_owner_id = _user
        OR public.is_admin(_user)
        OR public.has_role(_user, 'compliance_analyst'::public.app_role)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.facilitation_case_visible(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.facilitation_case_visible(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS fevd_select ON storage.objects;
DROP POLICY IF EXISTS fevd_insert ON storage.objects;

CREATE POLICY fevd_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'facilitation-evidence'
    AND public.facilitation_case_visible(
      auth.uid(),
      NULLIF(split_part(name, '/', 1), '')::uuid
    )
  );

CREATE POLICY fevd_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'facilitation-evidence'
    AND public.facilitation_case_visible(
      auth.uid(),
      NULLIF(split_part(name, '/', 1), '')::uuid
    )
  );
