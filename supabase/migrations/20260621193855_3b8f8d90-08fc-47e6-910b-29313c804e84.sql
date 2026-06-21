-- Batch 14 — Bank Detail Verification Decision Layer
-- All new tables are admin/compliance only. No anon, no public.

-- ============================================================
-- 1. registry_bank_detail_verification_requests
-- ============================================================
CREATE TABLE public.registry_bank_detail_verification_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES public.registry_bank_detail_submissions(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_role TEXT,
  verification_mode TEXT NOT NULL DEFAULT 'not_available',
  verification_status TEXT NOT NULL DEFAULT 'not_started',
  business_decision_id UUID REFERENCES public.business_decisions(id) ON DELETE SET NULL,
  country_code TEXT,
  consent_ok BOOLEAN NOT NULL DEFAULT false,
  risk_ok BOOLEAN NOT NULL DEFAULT false,
  duplicate_ok BOOLEAN NOT NULL DEFAULT false,
  evidence_ok BOOLEAN NOT NULL DEFAULT false,
  country_supports_mode BOOLEAN NOT NULL DEFAULT false,
  blocking_gates JSONB NOT NULL DEFAULT '[]'::jsonb,
  initiated_reason TEXT,
  expires_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registry_bank_detail_verification_requests TO authenticated;
GRANT ALL ON public.registry_bank_detail_verification_requests TO service_role;
ALTER TABLE public.registry_bank_detail_verification_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b14_verif_req_read_admin" ON public.registry_bank_detail_verification_requests
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role) OR public.has_role(auth.uid(), 'compliance_owner'::app_role));
CREATE POLICY "b14_verif_req_write_admin" ON public.registry_bank_detail_verification_requests
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role) OR public.has_role(auth.uid(), 'compliance_owner'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'platform_admin'::app_role) OR public.has_role(auth.uid(), 'compliance_owner'::app_role));

-- ============================================================
-- 2. registry_bank_detail_verification_events
-- ============================================================
CREATE TABLE public.registry_bank_detail_verification_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID REFERENCES public.registry_bank_detail_verification_requests(id) ON DELETE CASCADE,
  submission_id UUID REFERENCES public.registry_bank_detail_submissions(id) ON DELETE CASCADE,
  audit_event_name TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.registry_bank_detail_verification_events TO authenticated;
GRANT ALL ON public.registry_bank_detail_verification_events TO service_role;
ALTER TABLE public.registry_bank_detail_verification_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b14_verif_events_read_admin" ON public.registry_bank_detail_verification_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role) OR public.has_role(auth.uid(), 'compliance_owner'::app_role));

-- ============================================================
-- 3. registry_bank_detail_verification_decisions
-- ============================================================
CREATE TABLE public.registry_bank_detail_verification_decisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES public.registry_bank_detail_verification_requests(id) ON DELETE CASCADE,
  submission_id UUID NOT NULL REFERENCES public.registry_bank_detail_submissions(id) ON DELETE CASCADE,
  decision_outcome TEXT NOT NULL,
  reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewer_role TEXT,
  second_reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledgement_text TEXT,
  verification_method TEXT,
  verification_basis TEXT,
  evidence_basis TEXT,
  expires_at TIMESTAMPTZ,
  business_decision_id UUID REFERENCES public.business_decisions(id) ON DELETE SET NULL,
  blocking_gates JSONB NOT NULL DEFAULT '[]'::jsonb,
  promoted_to_verified BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.registry_bank_detail_verification_decisions TO authenticated;
GRANT ALL ON public.registry_bank_detail_verification_decisions TO service_role;
ALTER TABLE public.registry_bank_detail_verification_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b14_verif_dec_read_admin" ON public.registry_bank_detail_verification_decisions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role) OR public.has_role(auth.uid(), 'compliance_owner'::app_role));
CREATE POLICY "b14_verif_dec_write_admin" ON public.registry_bank_detail_verification_decisions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role) OR public.has_role(auth.uid(), 'compliance_owner'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'platform_admin'::app_role) OR public.has_role(auth.uid(), 'compliance_owner'::app_role));

-- ============================================================
-- 4. registry_bank_detail_provider_configs
-- ============================================================
CREATE TABLE public.registry_bank_detail_provider_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_name TEXT NOT NULL,
  provider_mode TEXT NOT NULL DEFAULT 'not_available',
  supported_countries TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  supported_account_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  credentials_status TEXT NOT NULL DEFAULT 'absent',
  permitted_use_decision_id UUID REFERENCES public.business_decisions(id) ON DELETE SET NULL,
  last_health_check_at TIMESTAMPTZ,
  response_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  timeout_ms INT NOT NULL DEFAULT 10000,
  retry_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  audit_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_live BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registry_bank_detail_provider_configs TO authenticated;
GRANT ALL ON public.registry_bank_detail_provider_configs TO service_role;
ALTER TABLE public.registry_bank_detail_provider_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b14_provider_cfg_read_admin" ON public.registry_bank_detail_provider_configs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role) OR public.has_role(auth.uid(), 'compliance_owner'::app_role));
CREATE POLICY "b14_provider_cfg_write_admin" ON public.registry_bank_detail_provider_configs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'platform_admin'::app_role));

-- ============================================================
-- 5. registry_bank_detail_provider_results
-- ============================================================
CREATE TABLE public.registry_bank_detail_provider_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID REFERENCES public.registry_bank_detail_verification_requests(id) ON DELETE CASCADE,
  submission_id UUID REFERENCES public.registry_bank_detail_submissions(id) ON DELETE CASCADE,
  provider_config_id UUID REFERENCES public.registry_bank_detail_provider_configs(id) ON DELETE SET NULL,
  simulated BOOLEAN NOT NULL DEFAULT true,
  outcome TEXT NOT NULL,
  provider_raw_excerpt JSONB,
  error_code TEXT,
  recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.registry_bank_detail_provider_results TO authenticated;
GRANT ALL ON public.registry_bank_detail_provider_results TO service_role;
ALTER TABLE public.registry_bank_detail_provider_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b14_provider_res_read_admin" ON public.registry_bank_detail_provider_results
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role) OR public.has_role(auth.uid(), 'compliance_owner'::app_role));

-- ============================================================
-- 6. registry_bank_detail_reverification_reviews
-- ============================================================
CREATE TABLE public.registry_bank_detail_reverification_reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES public.registry_bank_detail_submissions(id) ON DELETE CASCADE,
  previous_verification_id UUID REFERENCES public.registry_bank_detail_verification_requests(id) ON DELETE SET NULL,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  decision_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.registry_bank_detail_reverification_reviews TO authenticated;
GRANT ALL ON public.registry_bank_detail_reverification_reviews TO service_role;
ALTER TABLE public.registry_bank_detail_reverification_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b14_reverif_read_admin" ON public.registry_bank_detail_reverification_reviews
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role) OR public.has_role(auth.uid(), 'compliance_owner'::app_role));
CREATE POLICY "b14_reverif_write_admin" ON public.registry_bank_detail_reverification_reviews
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role) OR public.has_role(auth.uid(), 'compliance_owner'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'platform_admin'::app_role) OR public.has_role(auth.uid(), 'compliance_owner'::app_role));

-- ============================================================
-- 7. registry_bank_detail_verification_notes
-- ============================================================
CREATE TABLE public.registry_bank_detail_verification_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID REFERENCES public.registry_bank_detail_submissions(id) ON DELETE CASCADE,
  request_id UUID REFERENCES public.registry_bank_detail_verification_requests(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'internal_only',
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.registry_bank_detail_verification_notes TO authenticated;
GRANT ALL ON public.registry_bank_detail_verification_notes TO service_role;
ALTER TABLE public.registry_bank_detail_verification_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b14_verif_notes_read_admin" ON public.registry_bank_detail_verification_notes
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role) OR public.has_role(auth.uid(), 'compliance_owner'::app_role));
CREATE POLICY "b14_verif_notes_write_admin" ON public.registry_bank_detail_verification_notes
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'platform_admin'::app_role) OR public.has_role(auth.uid(), 'compliance_owner'::app_role));

-- ============================================================
-- Extensions to existing bank-detail submission table (additive only)
-- ============================================================
ALTER TABLE public.registry_bank_detail_submissions
  ADD COLUMN IF NOT EXISTS verification_mode TEXT NOT NULL DEFAULT 'not_available',
  ADD COLUMN IF NOT EXISTS current_verification_request_id UUID REFERENCES public.registry_bank_detail_verification_requests(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_b14_verif_req_submission ON public.registry_bank_detail_verification_requests(submission_id);
CREATE INDEX IF NOT EXISTS idx_b14_verif_req_status ON public.registry_bank_detail_verification_requests(verification_status);
CREATE INDEX IF NOT EXISTS idx_b14_verif_events_request ON public.registry_bank_detail_verification_events(request_id);
CREATE INDEX IF NOT EXISTS idx_b14_verif_events_name ON public.registry_bank_detail_verification_events(audit_event_name);
CREATE INDEX IF NOT EXISTS idx_b14_verif_dec_submission ON public.registry_bank_detail_verification_decisions(submission_id);
CREATE INDEX IF NOT EXISTS idx_b14_provider_cfg_mode ON public.registry_bank_detail_provider_configs(provider_mode);
CREATE INDEX IF NOT EXISTS idx_b14_reverif_submission ON public.registry_bank_detail_reverification_reviews(submission_id);

-- updated_at triggers
CREATE TRIGGER trg_b14_verif_req_updated_at
  BEFORE UPDATE ON public.registry_bank_detail_verification_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_b14_verif_dec_updated_at
  BEFORE UPDATE ON public.registry_bank_detail_verification_decisions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_b14_provider_cfg_updated_at
  BEFORE UPDATE ON public.registry_bank_detail_provider_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_b14_reverif_updated_at
  BEFORE UPDATE ON public.registry_bank_detail_reverification_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();