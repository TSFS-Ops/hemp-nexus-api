
DROP POLICY IF EXISTS "registry_import_batches_read_auth" ON public.registry_import_batches;

CREATE POLICY "registry_import_batches_read_admin"
ON public.registry_import_batches
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'platform_admin'::app_role)
  OR public.has_role(auth.uid(), 'compliance_owner'::app_role)
);
