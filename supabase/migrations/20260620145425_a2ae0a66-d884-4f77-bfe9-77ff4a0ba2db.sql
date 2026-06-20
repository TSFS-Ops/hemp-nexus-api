-- =========================================================
-- Batch 4 — Authority-to-Act (M005)
-- =========================================================

CREATE TABLE public.registry_authority_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claim_id UUID REFERENCES public.registry_company_claims(id) ON DELETE SET NULL,
  company_reference TEXT NOT NULL,
  company_name TEXT NOT NULL,
  country_code TEXT NOT NULL,
  representative_name TEXT NOT NULL,
  representative_email TEXT NOT NULL,
  representative_role TEXT NOT NULL,
  authority_basis TEXT NOT NULL,
  company_email_domain TEXT,
  declaration_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  consent_to_contact BOOLEAN NOT NULL DEFAULT FALSE,
  consent_to_process_evidence BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'not_started',
  approved_scope TEXT,
  conditions TEXT,
  expiry_at TIMESTAMPTZ,
  revocation_reason TEXT,
  revoked_at TIMESTAMPTZ,
  dispute_reason TEXT,
  disputed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewer_id UUID REFERENCES auth.users(id),
  internal_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ra_requests_requester ON public.registry_authority_requests(requester_user_id);
CREATE INDEX idx_ra_requests_status ON public.registry_authority_requests(status);
CREATE INDEX idx_ra_requests_company_ref ON public.registry_authority_requests(company_reference);
CREATE INDEX idx_ra_requests_claim ON public.registry_authority_requests(claim_id);

GRANT SELECT, INSERT, UPDATE ON public.registry_authority_requests TO authenticated;
GRANT ALL ON public.registry_authority_requests TO service_role;
ALTER TABLE public.registry_authority_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ra requester can read own" ON public.registry_authority_requests
  FOR SELECT TO authenticated USING (
    requester_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_owner')
  );
CREATE POLICY "ra requester can insert own" ON public.registry_authority_requests
  FOR INSERT TO authenticated WITH CHECK (requester_user_id = auth.uid());
CREATE POLICY "ra requester can update own non-status" ON public.registry_authority_requests
  FOR UPDATE TO authenticated USING (
    requester_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_owner')
  ) WITH CHECK (
    requester_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_owner')
  );

CREATE OR REPLACE FUNCTION public.registry_authority_requests_block_status_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('role', true) <> 'service_role'
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'authority_status_mutation_forbidden_via_table';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_ra_requests_block_status
  BEFORE UPDATE ON public.registry_authority_requests
  FOR EACH ROW EXECUTE FUNCTION public.registry_authority_requests_block_status_mutation();
CREATE TRIGGER trg_ra_requests_updated_at
  BEFORE UPDATE ON public.registry_authority_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.registry_authority_evidence (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  authority_request_id UUID NOT NULL REFERENCES public.registry_authority_requests(id) ON DELETE CASCADE,
  evidence_kind TEXT NOT NULL,
  description TEXT NOT NULL,
  external_reference TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ra_evidence_request ON public.registry_authority_evidence(authority_request_id);
GRANT SELECT, INSERT ON public.registry_authority_evidence TO authenticated;
GRANT ALL ON public.registry_authority_evidence TO service_role;
ALTER TABLE public.registry_authority_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ra evidence read own" ON public.registry_authority_evidence FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.registry_authority_requests r WHERE r.id = authority_request_id
    AND (r.requester_user_id = auth.uid() OR public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner')))
);
CREATE POLICY "ra evidence insert own" ON public.registry_authority_evidence FOR INSERT TO authenticated WITH CHECK (
  uploaded_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.registry_authority_requests r WHERE r.id = authority_request_id AND r.requester_user_id = auth.uid()
  )
);

CREATE TABLE public.registry_authority_reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  authority_request_id UUID NOT NULL REFERENCES public.registry_authority_requests(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES auth.users(id),
  decision TEXT NOT NULL,
  rationale TEXT NOT NULL,
  conditions TEXT,
  expiry_at TIMESTAMPTZ,
  acknowledged_not_company_verification BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_not_bank_verification BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ra_reviews_request ON public.registry_authority_reviews(authority_request_id);
GRANT SELECT, INSERT ON public.registry_authority_reviews TO authenticated;
GRANT ALL ON public.registry_authority_reviews TO service_role;
ALTER TABLE public.registry_authority_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ra reviews admin only" ON public.registry_authority_reviews FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner')
);

CREATE TABLE public.registry_authority_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  authority_request_id UUID NOT NULL REFERENCES public.registry_authority_requests(id) ON DELETE CASCADE,
  audit_event_name TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  reason TEXT,
  actor_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ra_events_request ON public.registry_authority_events(authority_request_id);
GRANT SELECT ON public.registry_authority_events TO authenticated;
GRANT ALL ON public.registry_authority_events TO service_role;
ALTER TABLE public.registry_authority_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ra events read own" ON public.registry_authority_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.registry_authority_requests r WHERE r.id = authority_request_id
    AND (r.requester_user_id = auth.uid() OR public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner')))
);

-- =========================================================
-- Batch 4 — Bank Detail Capture (M006) & Verified Status Model (M007)
-- =========================================================

CREATE TABLE public.registry_bank_detail_submissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submitter_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claim_id UUID REFERENCES public.registry_company_claims(id) ON DELETE SET NULL,
  authority_request_id UUID REFERENCES public.registry_authority_requests(id) ON DELETE SET NULL,
  company_reference TEXT NOT NULL,
  company_name TEXT NOT NULL,
  country_code TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  account_type TEXT,
  -- Sensitive fields: only edge functions (service_role) ever read these.
  -- Browser/admin UI uses masked_* fields below.
  enc_account_holder_name TEXT,
  enc_bank_name TEXT,
  enc_account_number TEXT,
  enc_branch_code TEXT,
  enc_swift_bic TEXT,
  enc_iban TEXT,
  -- Masked previews safe to show in admin tables (last 4 / institution name).
  masked_account_holder TEXT,
  masked_bank_name TEXT,
  masked_account_number TEXT,
  masked_branch_code TEXT,
  masked_swift_bic TEXT,
  masked_iban TEXT,
  status TEXT NOT NULL DEFAULT 'not_provided',
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES auth.users(id),
  verification_method TEXT,
  expiry_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  disputed_at TIMESTAMPTZ,
  dispute_reason TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rbd_submitter ON public.registry_bank_detail_submissions(submitter_user_id);
CREATE INDEX idx_rbd_company ON public.registry_bank_detail_submissions(company_reference);
CREATE INDEX idx_rbd_status ON public.registry_bank_detail_submissions(status);
CREATE INDEX idx_rbd_authority ON public.registry_bank_detail_submissions(authority_request_id);

-- Only allow SELECT of the masked columns + metadata to authenticated; raw enc_* columns
-- are filtered out of any user query via a column-level revoke would be ideal but Postgres
-- column GRANTs require us to list permitted columns explicitly. To keep this tractable we
-- gate raw access entirely through the edge functions (service_role) and rely on
-- application-layer masking on every read path.
GRANT SELECT, INSERT, UPDATE ON public.registry_bank_detail_submissions TO authenticated;
GRANT ALL ON public.registry_bank_detail_submissions TO service_role;
-- Revoke raw enc_* columns from authenticated so even direct PostgREST cannot read them.
REVOKE SELECT (enc_account_holder_name, enc_bank_name, enc_account_number, enc_branch_code, enc_swift_bic, enc_iban)
  ON public.registry_bank_detail_submissions FROM authenticated;
ALTER TABLE public.registry_bank_detail_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rbd read own or admin" ON public.registry_bank_detail_submissions FOR SELECT TO authenticated USING (
  submitter_user_id = auth.uid()
  OR public.has_role(auth.uid(),'platform_admin')
  OR public.has_role(auth.uid(),'compliance_owner')
);
CREATE POLICY "rbd insert own" ON public.registry_bank_detail_submissions FOR INSERT TO authenticated WITH CHECK (
  submitter_user_id = auth.uid()
);
CREATE POLICY "rbd update own or admin" ON public.registry_bank_detail_submissions FOR UPDATE TO authenticated USING (
  submitter_user_id = auth.uid()
  OR public.has_role(auth.uid(),'platform_admin')
  OR public.has_role(auth.uid(),'compliance_owner')
) WITH CHECK (TRUE);

CREATE OR REPLACE FUNCTION public.registry_bank_detail_block_status_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('role', true) <> 'service_role'
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'bank_detail_status_mutation_forbidden_via_table';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_rbd_block_status
  BEFORE UPDATE ON public.registry_bank_detail_submissions
  FOR EACH ROW EXECUTE FUNCTION public.registry_bank_detail_block_status_mutation();
CREATE TRIGGER trg_rbd_updated_at
  BEFORE UPDATE ON public.registry_bank_detail_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.registry_bank_detail_consent_receipts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES public.registry_bank_detail_submissions(id) ON DELETE CASCADE,
  consent_scope TEXT NOT NULL,
  consent_granted BOOLEAN NOT NULL,
  granted_by UUID NOT NULL REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consent_text TEXT NOT NULL
);
CREATE INDEX idx_rbd_consent_submission ON public.registry_bank_detail_consent_receipts(submission_id);
GRANT SELECT, INSERT ON public.registry_bank_detail_consent_receipts TO authenticated;
GRANT ALL ON public.registry_bank_detail_consent_receipts TO service_role;
ALTER TABLE public.registry_bank_detail_consent_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rbd consent read own or admin" ON public.registry_bank_detail_consent_receipts FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.registry_bank_detail_submissions s WHERE s.id = submission_id
    AND (s.submitter_user_id = auth.uid() OR public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner')))
);

CREATE TABLE public.registry_bank_detail_evidence (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES public.registry_bank_detail_submissions(id) ON DELETE CASCADE,
  evidence_kind TEXT NOT NULL,
  description TEXT NOT NULL,
  external_reference TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rbd_evidence_submission ON public.registry_bank_detail_evidence(submission_id);
GRANT SELECT, INSERT ON public.registry_bank_detail_evidence TO authenticated;
GRANT ALL ON public.registry_bank_detail_evidence TO service_role;
ALTER TABLE public.registry_bank_detail_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rbd evidence read own or admin" ON public.registry_bank_detail_evidence FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.registry_bank_detail_submissions s WHERE s.id = submission_id
    AND (s.submitter_user_id = auth.uid() OR public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner')))
);

CREATE TABLE public.registry_bank_detail_access_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES public.registry_bank_detail_submissions(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  access_type TEXT NOT NULL, -- 'masked_view' | 'unmasked_view' | 'unmasked_request'
  reason TEXT,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rbd_access_submission ON public.registry_bank_detail_access_log(submission_id);
GRANT SELECT ON public.registry_bank_detail_access_log TO authenticated;
GRANT ALL ON public.registry_bank_detail_access_log TO service_role;
ALTER TABLE public.registry_bank_detail_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rbd access log admin only" ON public.registry_bank_detail_access_log FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner')
);

CREATE TABLE public.registry_bank_detail_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES public.registry_bank_detail_submissions(id) ON DELETE CASCADE,
  audit_event_name TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  reason TEXT,
  actor_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rbd_events_submission ON public.registry_bank_detail_events(submission_id);
GRANT SELECT ON public.registry_bank_detail_events TO authenticated;
GRANT ALL ON public.registry_bank_detail_events TO service_role;
ALTER TABLE public.registry_bank_detail_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rbd events read own or admin" ON public.registry_bank_detail_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.registry_bank_detail_submissions s WHERE s.id = submission_id
    AND (s.submitter_user_id = auth.uid() OR public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner')))
);