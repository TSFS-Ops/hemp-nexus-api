
-- =========================================================================
-- Batch 2 — Registry Provenance (M010), Country Coverage (M011),
-- Import Batches (M012). Shell tables only — no real registry data.
-- =========================================================================

-- ---------- M010: Data sources ---------------------------------------------
CREATE TABLE public.registry_data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN (
    'registry','licensed_dataset','seed_layer','company_claim',
    'admin_enrichment','provider_api','manual_review'
  )),
  countries text[] NOT NULL DEFAULT '{}',
  licence_status text NOT NULL DEFAULT 'unlicensed' CHECK (licence_status IN (
    'unlicensed','licence_pending','licensed','expired','revoked'
  )),
  commercial_use_allowed boolean NOT NULL DEFAULT false,
  public_display_allowed boolean NOT NULL DEFAULT false,
  api_output_allowed boolean NOT NULL DEFAULT false,
  outreach_allowed boolean NOT NULL DEFAULT false,
  institutional_demo_allowed boolean NOT NULL DEFAULT false,
  resale_restrictions text,
  source_reference_url text,
  imported_at timestamptz,
  refreshed_at timestamptz,
  stale_at timestamptz,
  owner_role text,
  evidence_url text,
  internal_notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_name)
);
GRANT SELECT ON public.registry_data_sources TO authenticated;
GRANT ALL ON public.registry_data_sources TO service_role;
ALTER TABLE public.registry_data_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "registry_data_sources_read_auth" ON public.registry_data_sources
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "registry_data_sources_write_admin" ON public.registry_data_sources
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'));

-- ---------- M010: Source licences / permitted-use -------------------------
CREATE TABLE public.registry_source_licences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.registry_data_sources(id) ON DELETE CASCADE,
  licence_reference text NOT NULL,
  permitted_uses text[] NOT NULL DEFAULT '{}',
  effective_from timestamptz,
  effective_to timestamptz,
  evidence_url text,
  recorded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.registry_source_licences TO authenticated;
GRANT ALL ON public.registry_source_licences TO service_role;
ALTER TABLE public.registry_source_licences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "registry_source_licences_read_auth" ON public.registry_source_licences
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "registry_source_licences_write_admin" ON public.registry_source_licences
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'));

-- ---------- M010: Field-level provenance metadata --------------------------
CREATE TABLE public.registry_field_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL, -- e.g. 'registry_company' (future)
  subject_id text NOT NULL,
  field_name text NOT NULL,
  source_id uuid NOT NULL REFERENCES public.registry_data_sources(id),
  raw_value text,
  confidence_band text NOT NULL DEFAULT 'unverified' CHECK (confidence_band IN (
    'unverified','low','medium','high','authoritative'
  )),
  verification_level text NOT NULL DEFAULT 'none' CHECK (verification_level IN (
    'none','dataset_present','admin_reviewed','claimant_attested',
    'authority_verified','provider_verified'
  )),
  observed_at timestamptz NOT NULL DEFAULT now(),
  evidence_url text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_registry_field_provenance_subject
  ON public.registry_field_provenance (subject_type, subject_id);
GRANT SELECT ON public.registry_field_provenance TO authenticated;
GRANT ALL ON public.registry_field_provenance TO service_role;
ALTER TABLE public.registry_field_provenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "registry_field_provenance_read_auth" ON public.registry_field_provenance
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "registry_field_provenance_write_admin" ON public.registry_field_provenance
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'));

-- ---------- M010: Provenance audit events ----------------------------------
CREATE TABLE public.registry_provenance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.registry_data_sources(id) ON DELETE CASCADE,
  provenance_id uuid REFERENCES public.registry_field_provenance(id) ON DELETE CASCADE,
  audit_event_name text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.registry_provenance_events TO authenticated;
GRANT ALL ON public.registry_provenance_events TO service_role;
ALTER TABLE public.registry_provenance_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "registry_provenance_events_read_auth" ON public.registry_provenance_events
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "registry_provenance_events_insert_admin" ON public.registry_provenance_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'));

-- ---------- M011: Country coverage ----------------------------------------
CREATE TABLE public.registry_country_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL UNIQUE,
  country_name text NOT NULL,
  coverage_state text NOT NULL DEFAULT 'no_coverage' CHECK (coverage_state IN (
    'no_coverage','seed_only','sample_only','dataset_acquired',
    'provider_api_available','imported_unverified','claim_enabled',
    'verification_enabled','api_demo_ready','production_ready','disabled'
  )),
  registry_data_state text NOT NULL DEFAULT 'no_coverage',
  claim_company_state text NOT NULL DEFAULT 'no_coverage',
  authority_verification_state text NOT NULL DEFAULT 'no_coverage',
  bank_detail_verification_state text NOT NULL DEFAULT 'no_coverage',
  api_output_state text NOT NULL DEFAULT 'no_coverage',
  outreach_state text NOT NULL DEFAULT 'no_coverage',
  demo_readiness_state text NOT NULL DEFAULT 'no_coverage',
  public_wording_allowed boolean NOT NULL DEFAULT false,
  internal_notes text,
  next_action text,
  evidence_url text,
  last_reviewed_at timestamptz,
  review_due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.registry_country_coverage TO authenticated;
GRANT ALL ON public.registry_country_coverage TO service_role;
ALTER TABLE public.registry_country_coverage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "registry_country_coverage_read_auth" ON public.registry_country_coverage
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "registry_country_coverage_write_admin" ON public.registry_country_coverage
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'));

-- ---------- M011: Coverage audit events ------------------------------------
CREATE TABLE public.registry_country_coverage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL,
  surface text NOT NULL DEFAULT 'coverage_state',
  previous_state text,
  new_state text NOT NULL,
  reason text NOT NULL,
  evidence_url text,
  business_decision_id uuid REFERENCES public.business_decisions(id),
  audit_event_name text NOT NULL,
  actor_id uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_registry_country_coverage_events_country
  ON public.registry_country_coverage_events (country_code);
GRANT SELECT ON public.registry_country_coverage_events TO authenticated;
GRANT ALL ON public.registry_country_coverage_events TO service_role;
ALTER TABLE public.registry_country_coverage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "registry_country_coverage_events_read_auth" ON public.registry_country_coverage_events
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "registry_country_coverage_events_insert_admin" ON public.registry_country_coverage_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'));

-- ---------- M012: Import batches ------------------------------------------
CREATE TABLE public.registry_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_reference text NOT NULL UNIQUE,
  source_id uuid REFERENCES public.registry_data_sources(id),
  country_code text,
  licence_reference text,
  permitted_uses text[] NOT NULL DEFAULT '{}',
  schema_version text NOT NULL DEFAULT 'v0',
  state text NOT NULL DEFAULT 'draft' CHECK (state IN (
    'draft','uploaded','validating','validation_failed','validated',
    'quarantined','pending_approval','approved','published',
    'rejected','rolled_back','cancelled'
  )),
  validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_url text,
  uploaded_by uuid REFERENCES auth.users(id),
  reviewer_id uuid REFERENCES auth.users(id),
  approver_id uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  published_at timestamptz,
  rolled_back_at timestamptz,
  internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.registry_import_batches TO authenticated;
GRANT ALL ON public.registry_import_batches TO service_role;
ALTER TABLE public.registry_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "registry_import_batches_read_auth" ON public.registry_import_batches
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "registry_import_batches_write_admin" ON public.registry_import_batches
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'));

-- ---------- M012: Import batch rows ---------------------------------------
CREATE TABLE public.registry_import_batch_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.registry_import_batches(id) ON DELETE CASCADE,
  row_number int NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_state text NOT NULL DEFAULT 'pending' CHECK (validation_state IN (
    'pending','passed','failed','quarantined','duplicate_candidate'
  )),
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  duplicate_of_subject_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_registry_import_batch_rows_batch
  ON public.registry_import_batch_rows (batch_id);
GRANT SELECT ON public.registry_import_batch_rows TO authenticated;
GRANT ALL ON public.registry_import_batch_rows TO service_role;
ALTER TABLE public.registry_import_batch_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "registry_import_batch_rows_read_auth" ON public.registry_import_batch_rows
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "registry_import_batch_rows_write_admin" ON public.registry_import_batch_rows
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'));

-- ---------- M012: Import batch audit events --------------------------------
CREATE TABLE public.registry_import_batch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.registry_import_batches(id) ON DELETE CASCADE,
  previous_state text,
  new_state text NOT NULL,
  reason text NOT NULL,
  audit_event_name text NOT NULL,
  evidence_url text,
  actor_id uuid REFERENCES auth.users(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_registry_import_batch_events_batch
  ON public.registry_import_batch_events (batch_id);
GRANT SELECT ON public.registry_import_batch_events TO authenticated;
GRANT ALL ON public.registry_import_batch_events TO service_role;
ALTER TABLE public.registry_import_batch_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "registry_import_batch_events_read_auth" ON public.registry_import_batch_events
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "registry_import_batch_events_insert_admin" ON public.registry_import_batch_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'));

-- ---------- updated_at triggers -------------------------------------------
CREATE TRIGGER trg_registry_data_sources_updated
  BEFORE UPDATE ON public.registry_data_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_registry_country_coverage_updated
  BEFORE UPDATE ON public.registry_country_coverage
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_registry_import_batches_updated
  BEFORE UPDATE ON public.registry_import_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Seed: 54-country shell at no_coverage --------------------------
INSERT INTO public.registry_country_coverage (country_code, country_name, coverage_state)
VALUES
  ('DZ','Algeria','no_coverage'),('AO','Angola','no_coverage'),('BJ','Benin','no_coverage'),
  ('BW','Botswana','no_coverage'),('BF','Burkina Faso','no_coverage'),('BI','Burundi','no_coverage'),
  ('CV','Cabo Verde','no_coverage'),('CM','Cameroon','no_coverage'),('CF','Central African Republic','no_coverage'),
  ('TD','Chad','no_coverage'),('KM','Comoros','no_coverage'),('CG','Congo','no_coverage'),
  ('CD','Democratic Republic of the Congo','no_coverage'),('DJ','Djibouti','no_coverage'),
  ('EG','Egypt','no_coverage'),('GQ','Equatorial Guinea','no_coverage'),('ER','Eritrea','no_coverage'),
  ('SZ','Eswatini','no_coverage'),('ET','Ethiopia','no_coverage'),('GA','Gabon','no_coverage'),
  ('GM','Gambia','no_coverage'),('GH','Ghana','no_coverage'),('GN','Guinea','no_coverage'),
  ('GW','Guinea-Bissau','no_coverage'),('CI',E'C\u00f4te d''Ivoire','no_coverage'),('KE','Kenya','no_coverage'),
  ('LS','Lesotho','no_coverage'),('LR','Liberia','no_coverage'),('LY','Libya','no_coverage'),
  ('MG','Madagascar','no_coverage'),('MW','Malawi','no_coverage'),('ML','Mali','no_coverage'),
  ('MR','Mauritania','no_coverage'),('MU','Mauritius','no_coverage'),('MA','Morocco','no_coverage'),
  ('MZ','Mozambique','no_coverage'),('NA','Namibia','no_coverage'),('NE','Niger','no_coverage'),
  ('NG','Nigeria','seed_only'),('RW','Rwanda','no_coverage'),('ST',E'S\u00e3o Tom\u00e9 and Pr\u00edncipe','no_coverage'),
  ('SN','Senegal','no_coverage'),('SC','Seychelles','no_coverage'),('SL','Sierra Leone','no_coverage'),
  ('SO','Somalia','no_coverage'),('ZA','South Africa','seed_only'),('SS','South Sudan','no_coverage'),
  ('SD','Sudan','no_coverage'),('TZ','Tanzania','no_coverage'),('TG','Togo','no_coverage'),
  ('TN','Tunisia','no_coverage'),('UG','Uganda','no_coverage'),('ZM','Zambia','no_coverage'),
  ('ZW','Zimbabwe','no_coverage')
ON CONFLICT (country_code) DO NOTHING;
