
DROP POLICY IF EXISTS registry_source_files_read_auth ON public.registry_source_files;

CREATE POLICY registry_source_files_read_admin
  ON public.registry_source_files
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
  );
