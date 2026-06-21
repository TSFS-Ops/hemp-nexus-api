
-- Helper expression: has_role(auth.uid(), 'platform_admin') OR has_role(auth.uid(), 'compliance_owner')

DROP POLICY IF EXISTS registry_country_coverage_events_read_auth ON public.registry_country_coverage_events;
CREATE POLICY registry_country_coverage_events_read_admin ON public.registry_country_coverage_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin') OR public.has_role(auth.uid(), 'compliance_owner'));

DROP POLICY IF EXISTS registry_data_sources_read_auth ON public.registry_data_sources;
CREATE POLICY registry_data_sources_read_admin ON public.registry_data_sources
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin') OR public.has_role(auth.uid(), 'compliance_owner'));

DROP POLICY IF EXISTS registry_field_provenance_read_auth ON public.registry_field_provenance;
CREATE POLICY registry_field_provenance_read_admin ON public.registry_field_provenance
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin') OR public.has_role(auth.uid(), 'compliance_owner'));

DROP POLICY IF EXISTS registry_import_batch_rows_read_auth ON public.registry_import_batch_rows;
CREATE POLICY registry_import_batch_rows_read_admin ON public.registry_import_batch_rows
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin') OR public.has_role(auth.uid(), 'compliance_owner'));

DROP POLICY IF EXISTS registry_import_batch_events_read_auth ON public.registry_import_batch_events;
CREATE POLICY registry_import_batch_events_read_admin ON public.registry_import_batch_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin') OR public.has_role(auth.uid(), 'compliance_owner'));

DROP POLICY IF EXISTS registry_import_record_validation_results_read_auth ON public.registry_import_record_validation_results;
CREATE POLICY registry_import_record_validation_results_read_admin ON public.registry_import_record_validation_results
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin') OR public.has_role(auth.uid(), 'compliance_owner'));

DROP POLICY IF EXISTS registry_import_duplicate_candidates_read_auth ON public.registry_import_duplicate_candidates;
CREATE POLICY registry_import_duplicate_candidates_read_admin ON public.registry_import_duplicate_candidates
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin') OR public.has_role(auth.uid(), 'compliance_owner'));

DROP POLICY IF EXISTS registry_import_quarantine_read_auth ON public.registry_import_quarantine;
CREATE POLICY registry_import_quarantine_read_admin ON public.registry_import_quarantine
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin') OR public.has_role(auth.uid(), 'compliance_owner'));

DROP POLICY IF EXISTS registry_import_approval_events_read_auth ON public.registry_import_approval_events;
CREATE POLICY registry_import_approval_events_read_admin ON public.registry_import_approval_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin') OR public.has_role(auth.uid(), 'compliance_owner'));

DROP POLICY IF EXISTS registry_import_publish_events_read_auth ON public.registry_import_publish_events;
CREATE POLICY registry_import_publish_events_read_admin ON public.registry_import_publish_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin') OR public.has_role(auth.uid(), 'compliance_owner'));

DROP POLICY IF EXISTS registry_import_field_mappings_read_auth ON public.registry_import_field_mappings;
CREATE POLICY registry_import_field_mappings_read_admin ON public.registry_import_field_mappings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin') OR public.has_role(auth.uid(), 'compliance_owner'));

DROP POLICY IF EXISTS registry_source_licences_read_auth ON public.registry_source_licences;
CREATE POLICY registry_source_licences_read_admin ON public.registry_source_licences
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin') OR public.has_role(auth.uid(), 'compliance_owner'));
