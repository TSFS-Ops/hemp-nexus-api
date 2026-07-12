-- ============================================================
-- Institutional Funder Evidence Workspace — Batch 1
-- Canonical data foundation (additive only)
-- ============================================================

-- 1. Extend existing p5_batch3_funder_organisations (nullable additions only) ----
ALTER TABLE public.p5_batch3_funder_organisations
  ADD COLUMN IF NOT EXISTS approval_status text,
  ADD COLUMN IF NOT EXISTS requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS contact_person_name text,
  ADD COLUMN IF NOT EXISTS contact_phone text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'p5b3_funder_orgs_approval_status_chk'
  ) THEN
    ALTER TABLE public.p5_batch3_funder_organisations
      ADD CONSTRAINT p5b3_funder_orgs_approval_status_chk
      CHECK (approval_status IS NULL OR approval_status IN
        ('admin_created','requested','approved','rejected','suspended'));
  END IF;
END $$;

-- 2. funder_org_onboarding_requests -----------------------------------------
CREATE TABLE IF NOT EXISTS public.funder_org_onboarding_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_name text NOT NULL,
  registration_number text,
  jurisdiction text,
  website text,
  approved_email_domain text,
  primary_contact_name text NOT NULL,
  primary_contact_email text NOT NULL,
  primary_contact_phone text,
  funder_type text NOT NULL
    CHECK (funder_type IN ('commercial_bank','dfi','mdb','treasury_entity','eca','private_debt_fund')),
  reason_for_access text,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','under_review','approved','rejected','withdrawn')),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  approval_funder_organisation_id uuid REFERENCES public.p5_batch3_funder_organisations(id) ON DELETE SET NULL,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.funder_org_onboarding_requests TO authenticated;
GRANT ALL ON public.funder_org_onboarding_requests TO service_role;
ALTER TABLE public.funder_org_onboarding_requests ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fw_onboarding_pending_domain
  ON public.funder_org_onboarding_requests(lower(approved_email_domain))
  WHERE status IN ('submitted','under_review') AND approved_email_domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fw_onboarding_status
  ON public.funder_org_onboarding_requests(status);

CREATE POLICY "fw_onboarding_admin_all" ON public.funder_org_onboarding_requests
  FOR ALL TO authenticated
  USING (public.p5b3_is_platform_admin())
  WITH CHECK (public.p5b3_is_platform_admin());
CREATE POLICY "fw_onboarding_requester_select" ON public.funder_org_onboarding_requests
  FOR SELECT TO authenticated
  USING (requested_by = auth.uid());
CREATE POLICY "fw_onboarding_self_insert" ON public.funder_org_onboarding_requests
  FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid());

-- 3. funder_deal_releases ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funder_deal_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funder_organisation_id uuid NOT NULL REFERENCES public.p5_batch3_funder_organisations(id) ON DELETE CASCADE,
  deal_reference text NOT NULL,
  evidence_pack_id uuid,
  evidence_pack_version text,
  release_status text NOT NULL DEFAULT 'draft'
    CHECK (release_status IN ('draft','active','expired','revoked')),
  released_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  released_at timestamptz,
  release_reason text,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revocation_reason text,
  can_view_evidence_summary boolean NOT NULL DEFAULT true,
  can_view_evidence_room boolean NOT NULL DEFAULT true,
  can_download_compiled_pack boolean NOT NULL DEFAULT false,
  can_view_raw_documents boolean NOT NULL DEFAULT false,
  can_download_raw_documents boolean NOT NULL DEFAULT false,
  can_view_unmasked_sensitive_details boolean NOT NULL DEFAULT false,
  buyer_consent_status text NOT NULL DEFAULT 'pending'
    CHECK (buyer_consent_status IN ('not_required','pending','granted','declined','overridden')),
  seller_consent_status text NOT NULL DEFAULT 'pending'
    CHECK (seller_consent_status IN ('not_required','pending','granted','declined','overridden')),
  admin_override_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.funder_deal_releases TO authenticated;
GRANT ALL ON public.funder_deal_releases TO service_role;
ALTER TABLE public.funder_deal_releases ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_fw_release_org  ON public.funder_deal_releases(funder_organisation_id);
CREATE INDEX IF NOT EXISTS idx_fw_release_deal ON public.funder_deal_releases(deal_reference);
CREATE INDEX IF NOT EXISTS idx_fw_release_status ON public.funder_deal_releases(release_status);

CREATE POLICY "fw_release_admin_all" ON public.funder_deal_releases
  FOR ALL TO authenticated
  USING (public.p5b3_is_platform_admin())
  WITH CHECK (public.p5b3_is_platform_admin());
CREATE POLICY "fw_release_funder_select" ON public.funder_deal_releases
  FOR SELECT TO authenticated
  USING (funder_organisation_id = public.p5b3_current_funder_org());

-- 4. funder_release_consents -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funder_release_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES public.funder_deal_releases(id) ON DELETE CASCADE,
  party_type text NOT NULL CHECK (party_type IN ('buyer','seller')),
  party_id uuid,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','granted','declined','overridden','not_required')),
  captured_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  captured_at timestamptz,
  source text,
  override_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.funder_release_consents TO authenticated;
GRANT ALL ON public.funder_release_consents TO service_role;
ALTER TABLE public.funder_release_consents ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_fw_consent_release ON public.funder_release_consents(release_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fw_consent_release_party
  ON public.funder_release_consents(release_id, party_type);

CREATE POLICY "fw_consent_admin_all" ON public.funder_release_consents
  FOR ALL TO authenticated
  USING (public.p5b3_is_platform_admin())
  WITH CHECK (public.p5b3_is_platform_admin());
CREATE POLICY "fw_consent_funder_select" ON public.funder_release_consents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.funder_deal_releases r
      WHERE r.id = release_id
        AND r.funder_organisation_id = public.p5b3_current_funder_org()
    )
  );

-- 5. funder_pack_versions ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funder_pack_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES public.funder_deal_releases(id) ON DELETE CASCADE,
  pack_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','generated','sealed','superseded','revoked','failed')),
  storage_bucket text,
  storage_path text,
  file_sha256 text,
  manifest_sha256 text,
  watermark_template text,
  generated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  generated_at timestamptz,
  sealed_at timestamptz,
  download_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, version)
);
GRANT SELECT ON public.funder_pack_versions TO authenticated;
GRANT ALL ON public.funder_pack_versions TO service_role;
ALTER TABLE public.funder_pack_versions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_fw_pack_release ON public.funder_pack_versions(release_id);

CREATE POLICY "fw_pack_admin_all" ON public.funder_pack_versions
  FOR ALL TO authenticated
  USING (public.p5b3_is_platform_admin())
  WITH CHECK (public.p5b3_is_platform_admin());
CREATE POLICY "fw_pack_funder_select" ON public.funder_pack_versions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.funder_deal_releases r
      WHERE r.id = release_id
        AND r.funder_organisation_id = public.p5b3_current_funder_org()
    )
  );

-- Sealed-pack immutability guard
CREATE OR REPLACE FUNCTION public.fw_pack_versions_seal_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'sealed' AND NEW.status NOT IN ('superseded','revoked') THEN
    IF NEW.file_sha256 IS DISTINCT FROM OLD.file_sha256
       OR NEW.manifest_sha256 IS DISTINCT FROM OLD.manifest_sha256
       OR NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket
       OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
       OR NEW.pack_id IS DISTINCT FROM OLD.pack_id
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.sealed_at IS DISTINCT FROM OLD.sealed_at THEN
      RAISE EXCEPTION 'fw.pack_sealed_immutable: cannot mutate sealed pack version %', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS fw_pack_versions_seal_guard_trg ON public.funder_pack_versions;
CREATE TRIGGER fw_pack_versions_seal_guard_trg
  BEFORE UPDATE ON public.funder_pack_versions
  FOR EACH ROW EXECUTE FUNCTION public.fw_pack_versions_seal_guard();

-- 6. funder_usage_events (billing-ready log only) --------------------------
CREATE TABLE IF NOT EXISTS public.funder_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funder_organisation_id uuid REFERENCES public.p5_batch3_funder_organisations(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deal_reference text,
  release_id uuid REFERENCES public.funder_deal_releases(id) ON DELETE SET NULL,
  pack_version_id uuid REFERENCES public.funder_pack_versions(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'organisation_requested','organisation_approved','organisation_rejected',
    'deal_released','deal_access_revoked',
    'pack_generated','pack_downloaded',
    'raw_document_viewed','raw_document_downloaded',
    'rfi_created','rfi_answered','decision_recorded',
    'user_invited','user_deactivated'
  )),
  event_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.funder_usage_events TO authenticated;
GRANT ALL ON public.funder_usage_events TO service_role;
ALTER TABLE public.funder_usage_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_fw_usage_org
  ON public.funder_usage_events(funder_organisation_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_fw_usage_type
  ON public.funder_usage_events(event_type);

CREATE POLICY "fw_usage_admin_all" ON public.funder_usage_events
  FOR ALL TO authenticated
  USING (public.p5b3_is_platform_admin())
  WITH CHECK (public.p5b3_is_platform_admin());
CREATE POLICY "fw_usage_funder_select" ON public.funder_usage_events
  FOR SELECT TO authenticated
  USING (funder_organisation_id = public.p5b3_current_funder_org());

-- Updated-at triggers (reuse existing p5b3_set_updated_at)
DROP TRIGGER IF EXISTS fw_onboarding_updated_at ON public.funder_org_onboarding_requests;
CREATE TRIGGER fw_onboarding_updated_at BEFORE UPDATE ON public.funder_org_onboarding_requests
  FOR EACH ROW EXECUTE FUNCTION public.p5b3_set_updated_at();
DROP TRIGGER IF EXISTS fw_release_updated_at ON public.funder_deal_releases;
CREATE TRIGGER fw_release_updated_at BEFORE UPDATE ON public.funder_deal_releases
  FOR EACH ROW EXECUTE FUNCTION public.p5b3_set_updated_at();
DROP TRIGGER IF EXISTS fw_consent_updated_at ON public.funder_release_consents;
CREATE TRIGGER fw_consent_updated_at BEFORE UPDATE ON public.funder_release_consents
  FOR EACH ROW EXECUTE FUNCTION public.p5b3_set_updated_at();
DROP TRIGGER IF EXISTS fw_pack_updated_at ON public.funder_pack_versions;
CREATE TRIGGER fw_pack_updated_at BEFORE UPDATE ON public.funder_pack_versions
  FOR EACH ROW EXECUTE FUNCTION public.p5b3_set_updated_at();

-- 7. Helper functions -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.funder_role_for_v1(p_role public.p5_batch3_funder_role)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_role
    WHEN 'funder_org_admin' THEN 'admin'
    WHEN 'funder_approver'  THEN 'approver'
    WHEN 'funder_reviewer'  THEN 'reviewer'
    WHEN 'funder_viewer'    THEN 'viewer'
    WHEN 'external_adviser' THEN 'external_adviser'
  END;
$$;

CREATE OR REPLACE FUNCTION public.fw_current_funder_org_v1()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.p5b3_current_funder_org();
$$;

CREATE OR REPLACE FUNCTION public.fw_is_funder_org_approved_v1(p_funder_organisation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.p5_batch3_funder_organisations o
    WHERE o.id = p_funder_organisation_id
      AND o.status = 'active'
      AND (o.approval_status IS NULL OR o.approval_status IN ('approved','admin_created'))
  );
$$;

CREATE OR REPLACE FUNCTION public.fw_has_deal_release_v1(p_deal_reference text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.funder_deal_releases r
    WHERE r.deal_reference = p_deal_reference
      AND r.funder_organisation_id = public.p5b3_current_funder_org()
      AND r.release_status = 'active'
      AND (r.expires_at IS NULL OR r.expires_at > now())
      AND r.revoked_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.fw_can_view_raw_documents_v1(p_release_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.funder_deal_releases r
    WHERE r.id = p_release_id
      AND r.funder_organisation_id = public.p5b3_current_funder_org()
      AND r.release_status = 'active'
      AND r.can_view_raw_documents = true
      AND (r.expires_at IS NULL OR r.expires_at > now())
      AND r.revoked_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.fw_can_download_compiled_pack_v1(p_release_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.funder_deal_releases r
    WHERE r.id = p_release_id
      AND r.funder_organisation_id = public.p5b3_current_funder_org()
      AND r.release_status = 'active'
      AND r.can_download_compiled_pack = true
      AND (r.expires_at IS NULL OR r.expires_at > now())
      AND r.revoked_at IS NULL
  );
$$;

-- 8. Audit + usage helpers (reuse existing p5_batch3_funder_audit_events) --
CREATE OR REPLACE FUNCTION public.fw_audit(
  p_action text, p_funder_org uuid, p_object_type text, p_object_id uuid,
  p_prior jsonb, p_new jsonb, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.p5_batch3_funder_audit_events(
    user_id, funder_organisation_id, action, object_type, object_id,
    prior_state, new_state, reason_code, source_channel
  ) VALUES (
    auth.uid(), p_funder_org, p_action, p_object_type, p_object_id,
    p_prior, p_new, p_reason, 'fw_v1'
  );
END; $$;

CREATE OR REPLACE FUNCTION public.fw_record_usage(
  p_funder_org uuid, p_deal_reference text, p_release_id uuid,
  p_pack_version_id uuid, p_event_type text, p_metadata jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.funder_usage_events(
    funder_organisation_id, actor_user_id, deal_reference, release_id,
    pack_version_id, event_type, event_metadata
  ) VALUES (
    p_funder_org, auth.uid(), p_deal_reference, p_release_id,
    p_pack_version_id, p_event_type, coalesce(p_metadata,'{}'::jsonb)
  );
END; $$;

-- 9. RPCs -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fw_request_funder_onboarding_v1(
  p_organisation_name text, p_registration_number text, p_jurisdiction text,
  p_website text, p_approved_email_domain text, p_primary_contact_name text,
  p_primary_contact_email text, p_primary_contact_phone text,
  p_funder_type text, p_reason_for_access text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'fw.forbidden: authentication required';
  END IF;
  IF coalesce(trim(p_organisation_name),'') = '' THEN
    RAISE EXCEPTION 'fw.validation: organisation_name required';
  END IF;
  IF coalesce(trim(p_primary_contact_name),'') = '' THEN
    RAISE EXCEPTION 'fw.validation: primary_contact_name required';
  END IF;
  IF coalesce(trim(p_primary_contact_email),'') = '' THEN
    RAISE EXCEPTION 'fw.validation: primary_contact_email required';
  END IF;
  IF p_funder_type NOT IN ('commercial_bank','dfi','mdb','treasury_entity','eca','private_debt_fund') THEN
    RAISE EXCEPTION 'fw.validation: funder_type not allowed in V1';
  END IF;
  IF p_approved_email_domain IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.funder_org_onboarding_requests
    WHERE lower(approved_email_domain) = lower(p_approved_email_domain)
      AND status IN ('submitted','under_review')
  ) THEN
    RAISE EXCEPTION 'fw.duplicate: pending onboarding request already exists for this domain';
  END IF;

  INSERT INTO public.funder_org_onboarding_requests(
    organisation_name, registration_number, jurisdiction, website,
    approved_email_domain, primary_contact_name, primary_contact_email,
    primary_contact_phone, funder_type, reason_for_access, status, requested_by
  ) VALUES (
    p_organisation_name, p_registration_number, p_jurisdiction, p_website,
    p_approved_email_domain, p_primary_contact_name, p_primary_contact_email,
    p_primary_contact_phone, p_funder_type, p_reason_for_access, 'submitted', auth.uid()
  ) RETURNING id INTO v_id;

  PERFORM public.fw_audit('funder_onboarding.requested', NULL, 'onboarding_request', v_id,
    NULL, jsonb_build_object('organisation_name', p_organisation_name, 'funder_type', p_funder_type), NULL);
  PERFORM public.fw_record_usage(NULL, NULL, NULL, NULL, 'organisation_requested',
    jsonb_build_object('onboarding_request_id', v_id, 'funder_type', p_funder_type));
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.fw_admin_approve_funder_org_v1(
  p_request_id uuid, p_notes_internal text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req record; v_org_id uuid;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'fw.forbidden: only platform_admin may approve funder onboarding';
  END IF;
  SELECT * INTO v_req FROM public.funder_org_onboarding_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'fw.not_found: onboarding request'; END IF;
  IF v_req.status IN ('approved','rejected','withdrawn') THEN
    RAISE EXCEPTION 'fw.invalid_state: request already %', v_req.status;
  END IF;

  INSERT INTO public.p5_batch3_funder_organisations(
    name, registration_number, jurisdiction, contact_email, status,
    notes_internal, created_by,
    approval_status, requested_at, approved_by, approved_at,
    contact_person_name, contact_phone
  ) VALUES (
    v_req.organisation_name, v_req.registration_number, v_req.jurisdiction,
    v_req.primary_contact_email, 'active', p_notes_internal, auth.uid(),
    'approved', v_req.created_at, auth.uid(), now(),
    v_req.primary_contact_name, v_req.primary_contact_phone
  ) RETURNING id INTO v_org_id;

  UPDATE public.funder_org_onboarding_requests
     SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
         approval_funder_organisation_id = v_org_id
   WHERE id = p_request_id;

  PERFORM public.fw_audit('funder_onboarding.approved', v_org_id, 'onboarding_request', p_request_id,
    to_jsonb(v_req), jsonb_build_object('funder_organisation_id', v_org_id), NULL);
  PERFORM public.fw_record_usage(v_org_id, NULL, NULL, NULL, 'organisation_approved',
    jsonb_build_object('onboarding_request_id', p_request_id));
  RETURN v_org_id;
END; $$;

CREATE OR REPLACE FUNCTION public.fw_admin_reject_funder_org_v1(
  p_request_id uuid, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req record;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'fw.forbidden: only platform_admin may reject funder onboarding';
  END IF;
  IF coalesce(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'fw.validation: rejection reason required';
  END IF;
  SELECT * INTO v_req FROM public.funder_org_onboarding_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'fw.not_found: onboarding request'; END IF;
  IF v_req.status IN ('approved','rejected','withdrawn') THEN
    RAISE EXCEPTION 'fw.invalid_state: request already %', v_req.status;
  END IF;

  UPDATE public.funder_org_onboarding_requests
     SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
         rejection_reason = p_reason
   WHERE id = p_request_id;

  PERFORM public.fw_audit('funder_onboarding.rejected', NULL, 'onboarding_request', p_request_id,
    to_jsonb(v_req), jsonb_build_object('status','rejected'), p_reason);
  PERFORM public.fw_record_usage(NULL, NULL, NULL, NULL, 'organisation_rejected',
    jsonb_build_object('onboarding_request_id', p_request_id, 'reason', p_reason));
END; $$;

CREATE OR REPLACE FUNCTION public.fw_admin_release_deal_v1(
  p_funder_organisation_id uuid, p_deal_reference text,
  p_evidence_pack_id uuid, p_evidence_pack_version text,
  p_release_reason text, p_expires_at timestamptz,
  p_can_download_compiled_pack boolean,
  p_can_view_raw_documents boolean, p_can_download_raw_documents boolean,
  p_can_view_unmasked_sensitive_details boolean,
  p_buyer_consent_status text, p_seller_consent_status text,
  p_admin_override_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_buyer text;
  v_seller text;
  v_override text;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'fw.forbidden: only platform_admin may release funder deals';
  END IF;
  IF NOT public.fw_is_funder_org_approved_v1(p_funder_organisation_id) THEN
    RAISE EXCEPTION 'fw.forbidden: funder organisation not approved/active';
  END IF;
  IF coalesce(trim(p_release_reason),'') = '' THEN
    RAISE EXCEPTION 'fw.validation: release_reason required';
  END IF;
  IF coalesce(trim(p_deal_reference),'') = '' THEN
    RAISE EXCEPTION 'fw.validation: deal_reference required';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'fw.validation: expires_at must be in the future';
  END IF;

  v_buyer    := coalesce(p_buyer_consent_status,'pending');
  v_seller   := coalesce(p_seller_consent_status,'pending');
  v_override := trim(coalesce(p_admin_override_reason,''));

  IF v_buyer  NOT IN ('not_required','pending','granted','declined','overridden')
     OR v_seller NOT IN ('not_required','pending','granted','declined','overridden') THEN
    RAISE EXCEPTION 'fw.validation: invalid consent status';
  END IF;

  -- Consent gate: block release unless both parties are granted/not_required,
  -- OR an explicit non-empty admin override reason is supplied.
  IF NOT (v_buyer IN ('granted','not_required') AND v_seller IN ('granted','not_required')) THEN
    IF v_override = '' THEN
      RAISE EXCEPTION 'fw.consent_required: buyer/seller consent missing and no admin_override_reason';
    END IF;
    IF v_buyer  NOT IN ('granted','not_required') THEN v_buyer  := 'overridden'; END IF;
    IF v_seller NOT IN ('granted','not_required') THEN v_seller := 'overridden'; END IF;
  END IF;

  INSERT INTO public.funder_deal_releases(
    funder_organisation_id, deal_reference, evidence_pack_id, evidence_pack_version,
    release_status, released_by, released_at, release_reason, expires_at,
    can_download_compiled_pack, can_view_raw_documents, can_download_raw_documents,
    can_view_unmasked_sensitive_details,
    buyer_consent_status, seller_consent_status, admin_override_reason
  ) VALUES (
    p_funder_organisation_id, p_deal_reference, p_evidence_pack_id, p_evidence_pack_version,
    'active', auth.uid(), now(), p_release_reason, p_expires_at,
    coalesce(p_can_download_compiled_pack,false), coalesce(p_can_view_raw_documents,false),
    coalesce(p_can_download_raw_documents,false), coalesce(p_can_view_unmasked_sensitive_details,false),
    v_buyer, v_seller, nullif(v_override,'')
  ) RETURNING id INTO v_id;

  INSERT INTO public.funder_release_consents(release_id, party_type, status, captured_by, captured_at, source, override_reason)
    VALUES (v_id, 'buyer',  v_buyer,  auth.uid(), now(), 'admin_release_rpc',
            CASE WHEN v_buyer  = 'overridden' THEN nullif(v_override,'') END);
  INSERT INTO public.funder_release_consents(release_id, party_type, status, captured_by, captured_at, source, override_reason)
    VALUES (v_id, 'seller', v_seller, auth.uid(), now(), 'admin_release_rpc',
            CASE WHEN v_seller = 'overridden' THEN nullif(v_override,'') END);

  PERFORM public.fw_audit('funder_deal.released', p_funder_organisation_id, 'funder_deal_release', v_id,
    NULL, jsonb_build_object(
      'deal_reference', p_deal_reference,
      'buyer_consent_status', v_buyer,
      'seller_consent_status', v_seller,
      'admin_override_reason', nullif(v_override,'')
    ), p_release_reason);
  IF v_override <> '' THEN
    PERFORM public.fw_audit('funder_deal.consent_overridden', p_funder_organisation_id,
      'funder_deal_release', v_id, NULL,
      jsonb_build_object('buyer', v_buyer, 'seller', v_seller), v_override);
  END IF;
  PERFORM public.fw_record_usage(p_funder_organisation_id, p_deal_reference, v_id, NULL,
    'deal_released',
    jsonb_build_object('evidence_pack_id', p_evidence_pack_id,
                       'evidence_pack_version', p_evidence_pack_version));
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.fw_admin_revoke_deal_release_v1(
  p_release_id uuid, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r record;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'fw.forbidden';
  END IF;
  IF coalesce(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'fw.validation: revocation reason required';
  END IF;
  SELECT * INTO v_r FROM public.funder_deal_releases WHERE id = p_release_id FOR UPDATE;
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'fw.not_found: release'; END IF;
  IF v_r.release_status = 'revoked' THEN
    RAISE EXCEPTION 'fw.invalid_state: already revoked';
  END IF;

  UPDATE public.funder_deal_releases
     SET release_status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
         revocation_reason = p_reason
   WHERE id = p_release_id;

  PERFORM public.fw_audit('funder_deal.revoked', v_r.funder_organisation_id,
    'funder_deal_release', p_release_id,
    to_jsonb(v_r), jsonb_build_object('release_status','revoked'), p_reason);
  PERFORM public.fw_record_usage(v_r.funder_organisation_id, v_r.deal_reference, p_release_id, NULL,
    'deal_access_revoked', jsonb_build_object('reason', p_reason));
END; $$;

-- 10. Lock down EXECUTE (revoke public/anon; grant authenticated + service_role) --
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'fw\_%' ESCAPE '\' OR p.proname = 'funder_role_for_v1')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC', r.proname, r.args);
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', r.proname, r.args);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', r.proname, r.args);
  END LOOP;
END $$;