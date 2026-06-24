
-- P-5 BATCH 2 — Stage 1 — KYC/KYB Evidence & Artefacts foundation

-- 1. ENUMS ----------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.p5b2_kyc_record_type AS ENUM (
    'company','director_officer','ubo_controller','authorised_rep',
    'counterparty','funder_entity','funder_contact','api_customer',
    'transaction_party','bank_account','invited_evidence_owner'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.p5b2_evidence_status AS ENUM (
    'missing','requested','uploaded','under_review','accepted',
    'accepted_with_warning','rejected','expired','replaced','waived',
    'provider_dependent','suspended_hold','revoked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.p5b2_evidence_rating AS ENUM (
    'strong','good','acceptable','weak','unusable','provider_dependent'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.p5b2_requirement_level AS ENUM (
    'mandatory','optional','conditional','not_required'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.p5b2_rejection_reason AS ENUM (
    'illegible_document','expired_document','wrong_document_type',
    'missing_page_or_incomplete_file','name_mismatch',
    'company_number_registration_mismatch','address_mismatch',
    'not_signed_not_dated','authority_insufficient','ownership_unclear',
    'bank_account_holder_mismatch','bank_evidence_stale_or_unofficial',
    'tax_vat_mismatch','unsupported_jurisdiction_or_format',
    'translation_or_notarisation_required','provider_check_required',
    'provider_failed_or_unavailable','suspected_fraud_or_tampering',
    'duplicate_document','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.p5b2_provider_status AS ENUM (
    'provider_ready_not_live_provider_verified',
    'provider_credentials_pending',
    'provider_result_pending',
    'provider_unavailable',
    'provider_failed',
    'manual_review_recorded_not_provider_verified'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.p5b2_replacement_reason AS ENUM (
    'expired','rejected','updated','correction','better_quality',
    'authority_changed','bank_details_changed','ownership_changed',
    'admin_correction','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. HELPER FUNCTIONS (defined BEFORE triggers reference them) ------------

CREATE OR REPLACE FUNCTION public.p5b2_has_any_role(_user_id uuid, _roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text = ANY(_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.p5b2_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.p5b2_append_only_block()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP;
END $$;

CREATE OR REPLACE FUNCTION public.p5b2_versions_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.evidence_item_id IS DISTINCT FROM OLD.evidence_item_id
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.file_storage_path IS DISTINCT FROM OLD.file_storage_path
     OR NEW.file_hash IS DISTINCT FROM OLD.file_hash
     OR NEW.file_size_bytes IS DISTINCT FROM OLD.file_size_bytes
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
     OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.uploader_role IS DISTINCT FROM OLD.uploader_role
     OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
     OR NEW.replacement_reason IS DISTINCT FROM OLD.replacement_reason
     OR NEW.replacement_note IS DISTINCT FROM OLD.replacement_note
     OR NEW.audit_reference IS DISTINCT FROM OLD.audit_reference THEN
    RAISE EXCEPTION 'p5_batch2_evidence_versions is append-only; immutable fields cannot be changed';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.p5b2_kyc_records_require_subject()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.counterparty_id IS NULL
     AND NEW.match_id IS NULL AND NEW.trade_request_id IS NULL
     AND NEW.programme_id IS NULL AND NEW.api_client_id IS NULL
     AND NEW.owner_user_id IS NULL THEN
    RAISE EXCEPTION 'p5_batch2_kyc_records requires at least one subject linkage';
  END IF;
  RETURN NEW;
END $$;

-- 3. KYC RECORDS ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.p5_batch2_kyc_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type public.p5b2_kyc_record_type NOT NULL,
  display_name text NOT NULL,
  jurisdiction text,
  entity_type text,
  organization_id   uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  counterparty_id   uuid REFERENCES public.counterparties(id) ON DELETE SET NULL,
  match_id          uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  trade_request_id  uuid REFERENCES public.trade_requests(id) ON DELETE SET NULL,
  programme_id      uuid REFERENCES public.programmes(id) ON DELETE SET NULL,
  api_client_id     uuid REFERENCES public.api_clients(id) ON DELETE SET NULL,
  owner_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_high_risk boolean NOT NULL DEFAULT false,
  notes_internal text,
  status_summary text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS p5b2_kyc_records_subject_required ON public.p5_batch2_kyc_records;
CREATE TRIGGER p5b2_kyc_records_subject_required BEFORE INSERT OR UPDATE
  ON public.p5_batch2_kyc_records
  FOR EACH ROW EXECUTE FUNCTION public.p5b2_kyc_records_require_subject();

DROP TRIGGER IF EXISTS p5b2_kyc_records_touch ON public.p5_batch2_kyc_records;
CREATE TRIGGER p5b2_kyc_records_touch BEFORE UPDATE
  ON public.p5_batch2_kyc_records
  FOR EACH ROW EXECUTE FUNCTION public.p5b2_touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_p5b2_kyc_records_org   ON public.p5_batch2_kyc_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_p5b2_kyc_records_cp    ON public.p5_batch2_kyc_records(counterparty_id);
CREATE INDEX IF NOT EXISTS idx_p5b2_kyc_records_type  ON public.p5_batch2_kyc_records(record_type);
CREATE INDEX IF NOT EXISTS idx_p5b2_kyc_records_owner ON public.p5_batch2_kyc_records(owner_user_id);

-- 4. RECORD LINKS ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.p5_batch2_record_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_record_id uuid NOT NULL REFERENCES public.p5_batch2_kyc_records(id) ON DELETE CASCADE,
  child_record_id  uuid NOT NULL REFERENCES public.p5_batch2_kyc_records(id) ON DELETE CASCADE,
  link_type text NOT NULL,
  effective_from date,
  effective_to date,
  ownership_pct numeric(6,3),
  notes_internal text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT p5b2_record_link_distinct CHECK (parent_record_id <> child_record_id),
  UNIQUE (parent_record_id, child_record_id, link_type)
);
CREATE INDEX IF NOT EXISTS idx_p5b2_record_links_parent ON public.p5_batch2_record_links(parent_record_id);
CREATE INDEX IF NOT EXISTS idx_p5b2_record_links_child  ON public.p5_batch2_record_links(child_record_id);

-- 5. EVIDENCE ITEMS -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.p5_batch2_evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES public.p5_batch2_kyc_records(id) ON DELETE CASCADE,
  category text NOT NULL,
  requirement_level public.p5b2_requirement_level NOT NULL DEFAULT 'mandatory',
  status public.p5b2_evidence_status NOT NULL DEFAULT 'missing',
  rating public.p5b2_evidence_rating,
  expiry_date date,
  provider_dependency boolean NOT NULL DEFAULT false,
  provider_status public.p5b2_provider_status,
  provider_name text,
  provider_live boolean NOT NULL DEFAULT false,
  provider_result_reference text,
  last_provider_attempt_at timestamptz,
  current_version_id uuid,
  current_rejection_reason public.p5b2_rejection_reason,
  customer_safe_note text,
  reviewer_note_internal text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  supports text[] NOT NULL DEFAULT '{}',
  is_suspended boolean NOT NULL DEFAULT false,
  is_waived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT p5b2_evidence_no_unsupported_live_claim
    CHECK (provider_live = false OR provider_result_reference IS NOT NULL)
);

DROP TRIGGER IF EXISTS p5b2_evidence_touch ON public.p5_batch2_evidence_items;
CREATE TRIGGER p5b2_evidence_touch BEFORE UPDATE
  ON public.p5_batch2_evidence_items
  FOR EACH ROW EXECUTE FUNCTION public.p5b2_touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_p5b2_evidence_record ON public.p5_batch2_evidence_items(record_id);
CREATE INDEX IF NOT EXISTS idx_p5b2_evidence_status ON public.p5_batch2_evidence_items(status);
CREATE INDEX IF NOT EXISTS idx_p5b2_evidence_provider ON public.p5_batch2_evidence_items(provider_dependency) WHERE provider_dependency;
CREATE INDEX IF NOT EXISTS idx_p5b2_evidence_expiry ON public.p5_batch2_evidence_items(expiry_date) WHERE expiry_date IS NOT NULL;

-- 6. EVIDENCE VERSIONS (append-only) --------------------------------------
CREATE TABLE IF NOT EXISTS public.p5_batch2_evidence_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_item_id uuid NOT NULL REFERENCES public.p5_batch2_evidence_items(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  file_storage_path text,
  file_hash text NOT NULL,
  file_size_bytes bigint,
  mime_type text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploader_role text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  replacement_reason public.p5b2_replacement_reason,
  replacement_note text,
  is_current boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  audit_reference text,
  UNIQUE (evidence_item_id, version_number)
);

DROP TRIGGER IF EXISTS p5b2_versions_no_update ON public.p5_batch2_evidence_versions;
CREATE TRIGGER p5b2_versions_no_update BEFORE UPDATE
  ON public.p5_batch2_evidence_versions
  FOR EACH ROW EXECUTE FUNCTION public.p5b2_versions_guard();

DROP TRIGGER IF EXISTS p5b2_versions_no_delete ON public.p5_batch2_evidence_versions;
CREATE TRIGGER p5b2_versions_no_delete BEFORE DELETE
  ON public.p5_batch2_evidence_versions
  FOR EACH ROW EXECUTE FUNCTION public.p5b2_append_only_block();

CREATE INDEX IF NOT EXISTS idx_p5b2_versions_item ON public.p5_batch2_evidence_versions(evidence_item_id, version_number DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_p5b2_versions_current ON public.p5_batch2_evidence_versions(evidence_item_id) WHERE is_current;

-- 7. REVIEW EVENTS (append-only) ------------------------------------------
CREATE TABLE IF NOT EXISTS public.p5_batch2_evidence_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_item_id uuid NOT NULL REFERENCES public.p5_batch2_evidence_items(id) ON DELETE RESTRICT,
  version_id uuid REFERENCES public.p5_batch2_evidence_versions(id) ON DELETE SET NULL,
  action text NOT NULL,
  previous_status public.p5b2_evidence_status,
  new_status public.p5b2_evidence_status,
  rejection_reason public.p5b2_rejection_reason,
  reviewer_note_internal text,
  customer_safe_note text,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text,
  actor_type text NOT NULL DEFAULT 'user',
  correlation_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS p5b2_review_events_no_update ON public.p5_batch2_evidence_review_events;
CREATE TRIGGER p5b2_review_events_no_update BEFORE UPDATE
  ON public.p5_batch2_evidence_review_events
  FOR EACH ROW EXECUTE FUNCTION public.p5b2_append_only_block();
DROP TRIGGER IF EXISTS p5b2_review_events_no_delete ON public.p5_batch2_evidence_review_events;
CREATE TRIGGER p5b2_review_events_no_delete BEFORE DELETE
  ON public.p5_batch2_evidence_review_events
  FOR EACH ROW EXECUTE FUNCTION public.p5b2_append_only_block();

CREATE INDEX IF NOT EXISTS idx_p5b2_review_events_item ON public.p5_batch2_evidence_review_events(evidence_item_id, created_at DESC);

-- 8. EVIDENCE PACKS -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.p5_batch2_evidence_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  counterparty_id uuid REFERENCES public.counterparties(id) ON DELETE SET NULL,
  match_id uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  trade_request_id uuid REFERENCES public.trade_requests(id) ON DELETE SET NULL,
  pack_reason text NOT NULL,
  pack_status text NOT NULL DEFAULT 'sealed',
  hash_chain_reference text,
  sealed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sealed_at timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid REFERENCES public.p5_batch2_evidence_packs(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.p5_batch2_evidence_pack_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id uuid NOT NULL REFERENCES public.p5_batch2_evidence_packs(id) ON DELETE CASCADE,
  evidence_item_id uuid NOT NULL REFERENCES public.p5_batch2_evidence_items(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES public.p5_batch2_evidence_versions(id) ON DELETE RESTRICT,
  snapshot_status public.p5b2_evidence_status NOT NULL,
  snapshot_rating public.p5b2_evidence_rating,
  snapshot_file_hash text NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS p5b2_pack_items_no_update ON public.p5_batch2_evidence_pack_items;
CREATE TRIGGER p5b2_pack_items_no_update BEFORE UPDATE
  ON public.p5_batch2_evidence_pack_items
  FOR EACH ROW EXECUTE FUNCTION public.p5b2_append_only_block();
DROP TRIGGER IF EXISTS p5b2_pack_items_no_delete ON public.p5_batch2_evidence_pack_items;
CREATE TRIGGER p5b2_pack_items_no_delete BEFORE DELETE
  ON public.p5_batch2_evidence_pack_items
  FOR EACH ROW EXECUTE FUNCTION public.p5b2_append_only_block();

CREATE INDEX IF NOT EXISTS idx_p5b2_packs_org ON public.p5_batch2_evidence_packs(organization_id);
CREATE INDEX IF NOT EXISTS idx_p5b2_pack_items_pack ON public.p5_batch2_evidence_pack_items(pack_id);

-- 9. WAIVERS --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.p5_batch2_evidence_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_item_id uuid NOT NULL REFERENCES public.p5_batch2_evidence_items(id) ON DELETE CASCADE,
  scope text NOT NULL,
  reason_text text NOT NULL,
  expires_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_p5b2_waivers_item ON public.p5_batch2_evidence_waivers(evidence_item_id);

-- 10. SENSITIVE ACCESS LOG (append-only) ----------------------------------
CREATE TABLE IF NOT EXISTS public.p5_batch2_sensitive_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_item_id uuid REFERENCES public.p5_batch2_evidence_items(id) ON DELETE SET NULL,
  version_id uuid REFERENCES public.p5_batch2_evidence_versions(id) ON DELETE SET NULL,
  record_id uuid REFERENCES public.p5_batch2_kyc_records(id) ON DELETE SET NULL,
  access_kind text NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text,
  reason_text text NOT NULL,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS p5b2_sensitive_access_no_update ON public.p5_batch2_sensitive_access_log;
CREATE TRIGGER p5b2_sensitive_access_no_update BEFORE UPDATE
  ON public.p5_batch2_sensitive_access_log
  FOR EACH ROW EXECUTE FUNCTION public.p5b2_append_only_block();
DROP TRIGGER IF EXISTS p5b2_sensitive_access_no_delete ON public.p5_batch2_sensitive_access_log;
CREATE TRIGGER p5b2_sensitive_access_no_delete BEFORE DELETE
  ON public.p5_batch2_sensitive_access_log
  FOR EACH ROW EXECUTE FUNCTION public.p5b2_append_only_block();

CREATE INDEX IF NOT EXISTS idx_p5b2_sensitive_access_actor
  ON public.p5_batch2_sensitive_access_log(actor_user_id, created_at DESC);

-- 11. GRANTS --------------------------------------------------------------
GRANT SELECT ON public.p5_batch2_kyc_records            TO authenticated;
GRANT ALL    ON public.p5_batch2_kyc_records            TO service_role;
GRANT SELECT ON public.p5_batch2_record_links           TO authenticated;
GRANT ALL    ON public.p5_batch2_record_links           TO service_role;
GRANT SELECT ON public.p5_batch2_evidence_items         TO authenticated;
GRANT ALL    ON public.p5_batch2_evidence_items         TO service_role;
GRANT SELECT ON public.p5_batch2_evidence_versions      TO authenticated;
GRANT INSERT, SELECT, UPDATE ON public.p5_batch2_evidence_versions TO service_role;
GRANT SELECT ON public.p5_batch2_evidence_review_events TO authenticated;
GRANT INSERT, SELECT ON public.p5_batch2_evidence_review_events TO service_role;
GRANT SELECT ON public.p5_batch2_evidence_packs         TO authenticated;
GRANT ALL    ON public.p5_batch2_evidence_packs         TO service_role;
GRANT SELECT ON public.p5_batch2_evidence_pack_items    TO authenticated;
GRANT INSERT, SELECT ON public.p5_batch2_evidence_pack_items TO service_role;
GRANT SELECT ON public.p5_batch2_evidence_waivers       TO authenticated;
GRANT ALL    ON public.p5_batch2_evidence_waivers       TO service_role;
GRANT SELECT ON public.p5_batch2_sensitive_access_log   TO authenticated;
GRANT INSERT, SELECT ON public.p5_batch2_sensitive_access_log TO service_role;

-- 12. RLS -----------------------------------------------------------------
ALTER TABLE public.p5_batch2_kyc_records            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p5_batch2_record_links           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p5_batch2_evidence_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p5_batch2_evidence_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p5_batch2_evidence_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p5_batch2_evidence_packs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p5_batch2_evidence_pack_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p5_batch2_evidence_waivers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p5_batch2_sensitive_access_log   ENABLE ROW LEVEL SECURITY;

CREATE POLICY p5b2_kyc_records_privileged_read ON public.p5_batch2_kyc_records
  FOR SELECT TO authenticated
  USING (public.p5b2_has_any_role(auth.uid(), ARRAY[
    'platform_admin','executive_approver','compliance_analyst','governance_reviewer',
    'operator_case_manager','auditor','auditor_read_only','developer_technical_admin']));

CREATE POLICY p5b2_kyc_records_org_read ON public.p5_batch2_kyc_records
  FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND organization_id IN (
    SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()));

CREATE POLICY p5b2_kyc_records_owner_read ON public.p5_batch2_kyc_records
  FOR SELECT TO authenticated
  USING (owner_user_id IS NOT NULL AND owner_user_id = auth.uid());

CREATE POLICY p5b2_record_links_privileged_read ON public.p5_batch2_record_links
  FOR SELECT TO authenticated
  USING (public.p5b2_has_any_role(auth.uid(), ARRAY[
    'platform_admin','executive_approver','compliance_analyst','governance_reviewer',
    'operator_case_manager','auditor','auditor_read_only','developer_technical_admin']));

CREATE POLICY p5b2_evidence_items_read ON public.p5_batch2_evidence_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.p5_batch2_kyc_records r
    WHERE r.id = record_id AND (
      public.p5b2_has_any_role(auth.uid(), ARRAY[
        'platform_admin','executive_approver','compliance_analyst','governance_reviewer',
        'operator_case_manager','auditor','auditor_read_only','developer_technical_admin'])
      OR (r.organization_id IS NOT NULL AND r.organization_id IN (
        SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()))
      OR (r.owner_user_id IS NOT NULL AND r.owner_user_id = auth.uid()))));

CREATE POLICY p5b2_versions_read ON public.p5_batch2_evidence_versions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.p5_batch2_evidence_items i
    JOIN public.p5_batch2_kyc_records r ON r.id = i.record_id
    WHERE i.id = evidence_item_id AND (
      public.p5b2_has_any_role(auth.uid(), ARRAY[
        'platform_admin','executive_approver','compliance_analyst','governance_reviewer',
        'operator_case_manager','auditor','auditor_read_only','developer_technical_admin'])
      OR (r.organization_id IS NOT NULL AND r.organization_id IN (
        SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()))
      OR (r.owner_user_id IS NOT NULL AND r.owner_user_id = auth.uid()))));

CREATE POLICY p5b2_review_events_privileged_read ON public.p5_batch2_evidence_review_events
  FOR SELECT TO authenticated
  USING (public.p5b2_has_any_role(auth.uid(), ARRAY[
    'platform_admin','executive_approver','compliance_analyst','governance_reviewer',
    'operator_case_manager','auditor','auditor_read_only','developer_technical_admin']));

CREATE POLICY p5b2_packs_privileged_read ON public.p5_batch2_evidence_packs
  FOR SELECT TO authenticated
  USING (public.p5b2_has_any_role(auth.uid(), ARRAY[
    'platform_admin','executive_approver','compliance_analyst','governance_reviewer',
    'operator_case_manager','auditor','auditor_read_only','developer_technical_admin']));

CREATE POLICY p5b2_packs_org_read ON public.p5_batch2_evidence_packs
  FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND organization_id IN (
    SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()));

CREATE POLICY p5b2_pack_items_read ON public.p5_batch2_evidence_pack_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.p5_batch2_evidence_packs pk
    WHERE pk.id = pack_id AND (
      public.p5b2_has_any_role(auth.uid(), ARRAY[
        'platform_admin','executive_approver','compliance_analyst','governance_reviewer',
        'operator_case_manager','auditor','auditor_read_only','developer_technical_admin'])
      OR (pk.organization_id IS NOT NULL AND pk.organization_id IN (
        SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())))));

CREATE POLICY p5b2_waivers_privileged_read ON public.p5_batch2_evidence_waivers
  FOR SELECT TO authenticated
  USING (public.p5b2_has_any_role(auth.uid(), ARRAY[
    'platform_admin','executive_approver','compliance_analyst','governance_reviewer',
    'auditor','auditor_read_only']));

CREATE POLICY p5b2_sensitive_access_privileged_read ON public.p5_batch2_sensitive_access_log
  FOR SELECT TO authenticated
  USING (public.p5b2_has_any_role(auth.uid(), ARRAY[
    'platform_admin','compliance_analyst','auditor','auditor_read_only']));
