
-- ============================================================
-- P-5 Batch 3 Stage 1 — Funder workflow DB foundation
-- (Tables first, helpers second, RLS/policies third.)
-- ============================================================

-- ---------- Enums ----------
CREATE TYPE public.p5_batch3_funder_role AS ENUM (
  'funder_viewer','funder_reviewer','funder_approver','funder_org_admin','external_adviser'
);
CREATE TYPE public.p5_batch3_funder_org_status AS ENUM ('active','suspended','closed');
CREATE TYPE public.p5_batch3_funder_user_status AS ENUM ('invited','active','deactivated');
CREATE TYPE public.p5_batch3_access_grant_status AS ENUM ('active','revoked','expired');
CREATE TYPE public.p5_batch3_funder_status AS ENUM (
  'awaiting_review','in_progress','interested','declined',
  'credit_review_pending','conditional_support','term_sheet_requested',
  'term_sheet_provided','funding_decision_submitted','exited'
);
CREATE TYPE public.p5_batch3_request_status AS ENUM (
  'draft','submitted','admin_review','approved_to_company','assigned',
  'response_pending','answered','follow_up_requested','rejected','closed','withdrawn'
);
CREATE TYPE public.p5_batch3_request_category AS ENUM (
  'commercial','financial','legal','technical','esg_impact','kyc_kyb','evidence',
  'governance_compliance','project_readiness','transaction_terms','security_collateral','other'
);
CREATE TYPE public.p5_batch3_outcome_type AS ENUM (
  'interested','not_interested','credit_review_pending','conditional_support',
  'term_sheet_requested','term_sheet_provided','funding_approved_subject_to_admin','declined'
);
CREATE TYPE public.p5_batch3_exit_reason AS ENUM (
  'funder_declined','funder_completed_review','transaction_closed','funding_completed',
  'access_expired','admin_revoked','policy_concern','duplicate_access','no_response','funder_withdrawn'
);

-- ---------- Updated-at trigger function ----------
CREATE OR REPLACE FUNCTION public.p5b3_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============================================================
-- 1. Tables (no policies yet)
-- ============================================================

CREATE TABLE public.p5_batch3_funder_organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  registration_number text,
  jurisdiction text,
  contact_email text,
  status public.p5_batch3_funder_org_status NOT NULL DEFAULT 'active',
  api_enabled boolean NOT NULL DEFAULT false,
  notes_internal text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE public.p5_batch3_funder_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  funder_organisation_id uuid NOT NULL REFERENCES public.p5_batch3_funder_organisations(id) ON DELETE CASCADE,
  role public.p5_batch3_funder_role NOT NULL,
  status public.p5_batch3_funder_user_status NOT NULL DEFAULT 'invited',
  display_name text,
  email text NOT NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  deactivated_at timestamptz,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (funder_organisation_id, email)
);

CREATE TABLE public.p5_batch3_funder_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funder_organisation_id uuid NOT NULL REFERENCES public.p5_batch3_funder_organisations(id) ON DELETE CASCADE,
  funder_user_id uuid NOT NULL REFERENCES public.p5_batch3_funder_users(id) ON DELETE CASCADE,
  transaction_reference text NOT NULL,
  deal_id uuid,
  evidence_pack_id uuid,
  evidence_pack_version text,
  role public.p5_batch3_funder_role NOT NULL,
  access_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  permitted_data_categories text[] NOT NULL DEFAULT ARRAY[]::text[],
  can_download boolean NOT NULL DEFAULT false,
  can_view_raw_documents boolean NOT NULL DEFAULT false,
  unmasked_bank_details boolean NOT NULL DEFAULT false,
  funder_status public.p5_batch3_funder_status NOT NULL DEFAULT 'awaiting_review',
  status public.p5_batch3_access_grant_status NOT NULL DEFAULT 'active',
  release_reason text NOT NULL,
  nda_reference text,
  released_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  released_at timestamptz NOT NULL DEFAULT now(),
  expiry_at timestamptz NOT NULL,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.p5_batch3_funder_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funder_organisation_id uuid NOT NULL REFERENCES public.p5_batch3_funder_organisations(id) ON DELETE CASCADE,
  funder_user_id uuid NOT NULL REFERENCES public.p5_batch3_funder_users(id) ON DELETE CASCADE,
  access_grant_id uuid REFERENCES public.p5_batch3_funder_access_grants(id) ON DELETE SET NULL,
  transaction_reference text NOT NULL,
  category public.p5_batch3_request_category NOT NULL,
  original_message text NOT NULL,
  admin_external_message text,
  status public.p5_batch3_request_status NOT NULL DEFAULT 'draft',
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_decision text,
  admin_reason text,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.p5_batch3_funder_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funder_organisation_id uuid NOT NULL REFERENCES public.p5_batch3_funder_organisations(id) ON DELETE CASCADE,
  funder_user_id uuid NOT NULL REFERENCES public.p5_batch3_funder_users(id) ON DELETE CASCADE,
  access_grant_id uuid REFERENCES public.p5_batch3_funder_access_grants(id) ON DELETE SET NULL,
  transaction_reference text NOT NULL,
  outcome_type public.p5_batch3_outcome_type NOT NULL,
  conditions text,
  term_sheet_document_id uuid,
  admin_review_status text NOT NULL DEFAULT 'pending',
  admin_reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.p5_batch3_funder_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_display_name text,
  funder_organisation_id uuid REFERENCES public.p5_batch3_funder_organisations(id) ON DELETE SET NULL,
  funder_user_id uuid REFERENCES public.p5_batch3_funder_users(id) ON DELETE SET NULL,
  role public.p5_batch3_funder_role,
  action text NOT NULL,
  transaction_reference text,
  object_type text,
  object_id uuid,
  prior_state jsonb,
  new_state jsonb,
  reason_code text,
  note text,
  document_version text,
  document_hash text,
  ip_address inet,
  device text,
  user_agent text,
  source_channel text NOT NULL DEFAULT 'system',
  success boolean NOT NULL DEFAULT true,
  correlation_id uuid
);

CREATE TABLE public.p5_batch3_funder_downloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funder_organisation_id uuid NOT NULL REFERENCES public.p5_batch3_funder_organisations(id) ON DELETE CASCADE,
  funder_user_id uuid NOT NULL REFERENCES public.p5_batch3_funder_users(id) ON DELETE CASCADE,
  access_grant_id uuid REFERENCES public.p5_batch3_funder_access_grants(id) ON DELETE SET NULL,
  transaction_reference text NOT NULL,
  evidence_pack_id uuid,
  evidence_pack_version text,
  file_name text NOT NULL,
  file_type text,
  watermark_text text NOT NULL,
  download_url_expires_at timestamptz NOT NULL,
  downloaded_at timestamptz NOT NULL DEFAULT now(),
  ip_address inet,
  user_agent text,
  success boolean NOT NULL DEFAULT true,
  revoked_at timestamptz
);

-- ============================================================
-- 2. Helper security-definer functions (tables now exist)
-- ============================================================
CREATE OR REPLACE FUNCTION public.p5b3_is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'platform_admin'::public.app_role);
$$;

CREATE OR REPLACE FUNCTION public.p5b3_current_funder_org()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT fu.funder_organisation_id
  FROM public.p5_batch3_funder_users fu
  WHERE fu.auth_user_id = auth.uid()
    AND fu.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.p5b3_has_active_grant(_transaction_ref text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.p5_batch3_funder_access_grants g
    JOIN public.p5_batch3_funder_users u ON u.id = g.funder_user_id
    WHERE u.auth_user_id = auth.uid()
      AND g.transaction_reference = _transaction_ref
      AND g.status = 'active'
      AND g.expiry_at > now()
      AND g.revoked_at IS NULL
  );
$$;

-- ============================================================
-- 3. GRANTs, RLS, Policies, Triggers, Indexes
-- ============================================================

-- ---- funder_organisations ----
GRANT SELECT ON public.p5_batch3_funder_organisations TO authenticated;
GRANT ALL ON public.p5_batch3_funder_organisations TO service_role;
ALTER TABLE public.p5_batch3_funder_organisations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b3_orgs_admin_all" ON public.p5_batch3_funder_organisations
  FOR ALL TO authenticated
  USING (public.p5b3_is_platform_admin())
  WITH CHECK (public.p5b3_is_platform_admin());
CREATE POLICY "p5b3_orgs_funder_self_select" ON public.p5_batch3_funder_organisations
  FOR SELECT TO authenticated
  USING (id = public.p5b3_current_funder_org());
CREATE TRIGGER p5b3_orgs_updated_at BEFORE UPDATE ON public.p5_batch3_funder_organisations
  FOR EACH ROW EXECUTE FUNCTION public.p5b3_set_updated_at();
CREATE INDEX idx_p5b3_orgs_status ON public.p5_batch3_funder_organisations(status);

-- ---- funder_users ----
GRANT SELECT ON public.p5_batch3_funder_users TO authenticated;
GRANT ALL ON public.p5_batch3_funder_users TO service_role;
ALTER TABLE public.p5_batch3_funder_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b3_users_admin_all" ON public.p5_batch3_funder_users
  FOR ALL TO authenticated
  USING (public.p5b3_is_platform_admin())
  WITH CHECK (public.p5b3_is_platform_admin());
CREATE POLICY "p5b3_users_same_org_select" ON public.p5_batch3_funder_users
  FOR SELECT TO authenticated
  USING (funder_organisation_id = public.p5b3_current_funder_org());
CREATE TRIGGER p5b3_users_updated_at BEFORE UPDATE ON public.p5_batch3_funder_users
  FOR EACH ROW EXECUTE FUNCTION public.p5b3_set_updated_at();
CREATE INDEX idx_p5b3_users_auth ON public.p5_batch3_funder_users(auth_user_id);
CREATE INDEX idx_p5b3_users_org ON public.p5_batch3_funder_users(funder_organisation_id);

-- ---- funder_access_grants ----
GRANT SELECT ON public.p5_batch3_funder_access_grants TO authenticated;
GRANT ALL ON public.p5_batch3_funder_access_grants TO service_role;
ALTER TABLE public.p5_batch3_funder_access_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b3_grants_admin_all" ON public.p5_batch3_funder_access_grants
  FOR ALL TO authenticated
  USING (public.p5b3_is_platform_admin())
  WITH CHECK (public.p5b3_is_platform_admin());
CREATE POLICY "p5b3_grants_self_select" ON public.p5_batch3_funder_access_grants
  FOR SELECT TO authenticated
  USING (
    funder_organisation_id = public.p5b3_current_funder_org()
    AND funder_user_id IN (
      SELECT id FROM public.p5_batch3_funder_users WHERE auth_user_id = auth.uid()
    )
    AND status = 'active'
    AND expiry_at > now()
    AND revoked_at IS NULL
  );
CREATE TRIGGER p5b3_grants_updated_at BEFORE UPDATE ON public.p5_batch3_funder_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.p5b3_set_updated_at();
CREATE INDEX idx_p5b3_grants_user ON public.p5_batch3_funder_access_grants(funder_user_id);
CREATE INDEX idx_p5b3_grants_org ON public.p5_batch3_funder_access_grants(funder_organisation_id);
CREATE INDEX idx_p5b3_grants_txref ON public.p5_batch3_funder_access_grants(transaction_reference);
CREATE INDEX idx_p5b3_grants_status ON public.p5_batch3_funder_access_grants(status, expiry_at);

-- ---- funder_requests ----
GRANT SELECT ON public.p5_batch3_funder_requests TO authenticated;
GRANT ALL ON public.p5_batch3_funder_requests TO service_role;
ALTER TABLE public.p5_batch3_funder_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b3_requests_admin_all" ON public.p5_batch3_funder_requests
  FOR ALL TO authenticated
  USING (public.p5b3_is_platform_admin())
  WITH CHECK (public.p5b3_is_platform_admin());
CREATE POLICY "p5b3_requests_self_select" ON public.p5_batch3_funder_requests
  FOR SELECT TO authenticated
  USING (
    funder_organisation_id = public.p5b3_current_funder_org()
    AND funder_user_id IN (
      SELECT id FROM public.p5_batch3_funder_users WHERE auth_user_id = auth.uid()
    )
    AND public.p5b3_has_active_grant(transaction_reference)
  );
CREATE TRIGGER p5b3_requests_updated_at BEFORE UPDATE ON public.p5_batch3_funder_requests
  FOR EACH ROW EXECUTE FUNCTION public.p5b3_set_updated_at();
CREATE INDEX idx_p5b3_requests_org ON public.p5_batch3_funder_requests(funder_organisation_id);
CREATE INDEX idx_p5b3_requests_txref ON public.p5_batch3_funder_requests(transaction_reference);
CREATE INDEX idx_p5b3_requests_status ON public.p5_batch3_funder_requests(status);

-- ---- funder_outcomes ----
GRANT SELECT ON public.p5_batch3_funder_outcomes TO authenticated;
GRANT ALL ON public.p5_batch3_funder_outcomes TO service_role;
ALTER TABLE public.p5_batch3_funder_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b3_outcomes_admin_all" ON public.p5_batch3_funder_outcomes
  FOR ALL TO authenticated
  USING (public.p5b3_is_platform_admin())
  WITH CHECK (public.p5b3_is_platform_admin());
CREATE POLICY "p5b3_outcomes_self_select" ON public.p5_batch3_funder_outcomes
  FOR SELECT TO authenticated
  USING (
    funder_organisation_id = public.p5b3_current_funder_org()
    AND funder_user_id IN (
      SELECT id FROM public.p5_batch3_funder_users WHERE auth_user_id = auth.uid()
    )
    AND public.p5b3_has_active_grant(transaction_reference)
  );
CREATE TRIGGER p5b3_outcomes_updated_at BEFORE UPDATE ON public.p5_batch3_funder_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.p5b3_set_updated_at();
CREATE INDEX idx_p5b3_outcomes_org ON public.p5_batch3_funder_outcomes(funder_organisation_id);
CREATE INDEX idx_p5b3_outcomes_txref ON public.p5_batch3_funder_outcomes(transaction_reference);

-- ---- funder_audit_events (append-only: no INSERT/UPDATE/DELETE policy for authenticated) ----
GRANT SELECT ON public.p5_batch3_funder_audit_events TO authenticated;
GRANT ALL ON public.p5_batch3_funder_audit_events TO service_role;
ALTER TABLE public.p5_batch3_funder_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b3_audit_admin_select" ON public.p5_batch3_funder_audit_events
  FOR SELECT TO authenticated
  USING (public.p5b3_is_platform_admin());
CREATE POLICY "p5b3_audit_self_select" ON public.p5_batch3_funder_audit_events
  FOR SELECT TO authenticated
  USING (
    funder_organisation_id = public.p5b3_current_funder_org()
    AND funder_user_id IN (
      SELECT id FROM public.p5_batch3_funder_users WHERE auth_user_id = auth.uid()
    )
    AND (transaction_reference IS NULL OR public.p5b3_has_active_grant(transaction_reference))
  );
CREATE INDEX idx_p5b3_audit_org ON public.p5_batch3_funder_audit_events(funder_organisation_id);
CREATE INDEX idx_p5b3_audit_txref ON public.p5_batch3_funder_audit_events(transaction_reference);
CREATE INDEX idx_p5b3_audit_action_time ON public.p5_batch3_funder_audit_events(action, occurred_at DESC);

-- ---- funder_downloads (append-only) ----
GRANT SELECT ON public.p5_batch3_funder_downloads TO authenticated;
GRANT ALL ON public.p5_batch3_funder_downloads TO service_role;
ALTER TABLE public.p5_batch3_funder_downloads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b3_downloads_admin_select" ON public.p5_batch3_funder_downloads
  FOR SELECT TO authenticated
  USING (public.p5b3_is_platform_admin());
CREATE POLICY "p5b3_downloads_self_select" ON public.p5_batch3_funder_downloads
  FOR SELECT TO authenticated
  USING (
    funder_organisation_id = public.p5b3_current_funder_org()
    AND funder_user_id IN (
      SELECT id FROM public.p5_batch3_funder_users WHERE auth_user_id = auth.uid()
    )
    AND public.p5b3_has_active_grant(transaction_reference)
  );
CREATE INDEX idx_p5b3_downloads_org ON public.p5_batch3_funder_downloads(funder_organisation_id);
CREATE INDEX idx_p5b3_downloads_txref ON public.p5_batch3_funder_downloads(transaction_reference);
CREATE INDEX idx_p5b3_downloads_time ON public.p5_batch3_funder_downloads(downloaded_at DESC);
