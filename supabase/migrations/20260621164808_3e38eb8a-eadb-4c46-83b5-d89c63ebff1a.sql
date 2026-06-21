
-- registry_source_file_pages
DROP POLICY IF EXISTS registry_source_file_pages_read_auth ON public.registry_source_file_pages;
CREATE POLICY registry_source_file_pages_read_admin
  ON public.registry_source_file_pages
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
  );

-- registry_readiness_states
DROP POLICY IF EXISTS registry_readiness_states_read_authenticated ON public.registry_readiness_states;
CREATE POLICY registry_readiness_states_read_admin
  ON public.registry_readiness_states
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
  );

-- registry_provenance_events
DROP POLICY IF EXISTS registry_provenance_events_read_auth ON public.registry_provenance_events;
CREATE POLICY registry_provenance_events_read_admin
  ON public.registry_provenance_events
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
  );

-- registry_modules
DROP POLICY IF EXISTS registry_modules_read_authenticated ON public.registry_modules;
CREATE POLICY registry_modules_read_admin
  ON public.registry_modules
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
  );
