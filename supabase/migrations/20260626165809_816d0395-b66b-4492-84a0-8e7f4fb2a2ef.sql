
-- =========================================================================
-- P-5 Batch 8 Phase 2 — Provider-ready DB persistence (additive only)
-- Mirrors the Phase 1 SSOT in src/lib/p5-batch8/registry.ts.
-- No UI, no RPC write path, no API projection, no edge functions, no cron.
-- =========================================================================

-- ---------- helper: append-only trigger ---------------------------------
CREATE OR REPLACE FUNCTION public.p5b8_block_mutation_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'p5b8: % on % is forbidden (append-only table)', TG_OP, TG_TABLE_NAME;
END;
$$;
REVOKE ALL ON FUNCTION public.p5b8_block_mutation_append_only() FROM PUBLIC;

-- ---------- helper: updated_at trigger ----------------------------------
CREATE OR REPLACE FUNCTION public.p5b8_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.p5b8_set_updated_at() FROM PUBLIC;

-- =========================================================================
-- 1. p5b8_provider_configs
-- =========================================================================
CREATE TABLE public.p5b8_provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_category text NOT NULL UNIQUE,
  preferred_providers jsonb NOT NULL DEFAULT '[]'::jsonb,
  fallback text,
  required_result_type text,
  live_now boolean NOT NULL DEFAULT false,
  hidden_until_live boolean NOT NULL DEFAULT true,
  commercial_owner text NOT NULL,
  technical_contact text NOT NULL,
  credential_owner text NOT NULL,
  approval_owner text NOT NULL,
  activation_signoff_owner text NOT NULL,
  activation_signed_off_at timestamptz,
  activation_signed_off_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p5b8_pc_category_chk CHECK (provider_category IN (
    'sanctions_pep_adverse_media','identity_verification','company_registry_kyb',
    'director_ubo_verification','bank_account_verification','payment_confirmation',
    'document_signing_certification','mrv_carbon_geospatial','funder_institutional_dependency'
  )),
  CONSTRAINT p5b8_pc_live_requires_signoff CHECK (
    live_now = false OR (activation_signed_off_at IS NOT NULL AND activation_signed_off_by IS NOT NULL)
  )
);
GRANT SELECT ON public.p5b8_provider_configs TO authenticated;
GRANT ALL ON public.p5b8_provider_configs TO service_role;
ALTER TABLE public.p5b8_provider_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b8_pc_admin_read" ON public.p5b8_provider_configs FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'platform_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_analyst'::app_role)
    OR has_role(auth.uid(), 'api_admin'::app_role)
  );
CREATE TRIGGER p5b8_pc_set_updated_at BEFORE UPDATE ON public.p5b8_provider_configs
  FOR EACH ROW EXECUTE FUNCTION public.p5b8_set_updated_at();

-- =========================================================================
-- 2. p5b8_provider_activation_signoffs (append-only)
-- =========================================================================
CREATE TABLE public.p5b8_provider_activation_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_config_id uuid NOT NULL REFERENCES public.p5b8_provider_configs(id) ON DELETE RESTRICT,
  signed_off_by uuid NOT NULL REFERENCES auth.users(id),
  signed_off_role text NOT NULL,
  signed_off_at timestamptz NOT NULL DEFAULT now(),
  note text,
  evidence_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.p5b8_provider_activation_signoffs TO authenticated;
GRANT ALL ON public.p5b8_provider_activation_signoffs TO service_role;
ALTER TABLE public.p5b8_provider_activation_signoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b8_signoff_admin_read" ON public.p5b8_provider_activation_signoffs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role) OR has_role(auth.uid(), 'compliance_analyst'::app_role));
CREATE TRIGGER p5b8_signoff_no_update BEFORE UPDATE ON public.p5b8_provider_activation_signoffs
  FOR EACH ROW EXECUTE FUNCTION public.p5b8_block_mutation_append_only();
CREATE TRIGGER p5b8_signoff_no_delete BEFORE DELETE ON public.p5b8_provider_activation_signoffs
  FOR EACH ROW EXECUTE FUNCTION public.p5b8_block_mutation_append_only();

-- =========================================================================
-- 3. p5b8_provider_dependency_status
-- =========================================================================
CREATE TABLE public.p5b8_provider_dependency_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_category text NOT NULL,
  subject_id uuid,
  case_id uuid,
  state text NOT NULL DEFAULT 'not_configured',
  environment text NOT NULL DEFAULT 'test',
  stale_as_of timestamptz,
  is_stale boolean NOT NULL DEFAULT false,
  last_transition_reason text,
  last_transition_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p5b8_pds_category_chk CHECK (provider_category IN (
    'sanctions_pep_adverse_media','identity_verification','company_registry_kyb',
    'director_ubo_verification','bank_account_verification','payment_confirmation',
    'document_signing_certification','mrv_carbon_geospatial','funder_institutional_dependency'
  )),
  CONSTRAINT p5b8_pds_state_chk CHECK (state IN (
    'not_configured','awaiting_credentials','provider_ready','test_mode',
    'activation_pending','live_pending','live_result_received',
    'provider_failed','provider_unavailable','manual_review_required'
  )),
  CONSTRAINT p5b8_pds_env_chk CHECK (environment IN ('test','live'))
);
CREATE INDEX p5b8_pds_subject_idx ON public.p5b8_provider_dependency_status(subject_id);
CREATE INDEX p5b8_pds_case_idx ON public.p5b8_provider_dependency_status(case_id);
GRANT SELECT ON public.p5b8_provider_dependency_status TO authenticated;
GRANT ALL ON public.p5b8_provider_dependency_status TO service_role;
ALTER TABLE public.p5b8_provider_dependency_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b8_pds_admin_read" ON public.p5b8_provider_dependency_status FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'platform_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_analyst'::app_role)
    OR has_role(auth.uid(), 'api_admin'::app_role)
  );
CREATE TRIGGER p5b8_pds_set_updated_at BEFORE UPDATE ON public.p5b8_provider_dependency_status
  FOR EACH ROW EXECUTE FUNCTION public.p5b8_set_updated_at();

-- =========================================================================
-- 4. p5b8_provider_requests
-- =========================================================================
CREATE TABLE public.p5b8_provider_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_category text NOT NULL,
  environment text NOT NULL DEFAULT 'test',
  request_reference text NOT NULL,
  subject_id uuid,
  case_id uuid,
  requested_by uuid REFERENCES auth.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p5b8_pr_category_chk CHECK (provider_category IN (
    'sanctions_pep_adverse_media','identity_verification','company_registry_kyb',
    'director_ubo_verification','bank_account_verification','payment_confirmation',
    'document_signing_certification','mrv_carbon_geospatial','funder_institutional_dependency'
  )),
  CONSTRAINT p5b8_pr_env_chk CHECK (environment IN ('test','live')),
  CONSTRAINT p5b8_pr_status_chk CHECK (status IN ('queued','dispatched','responded','failed','cancelled')),
  UNIQUE (provider_category, request_reference)
);
GRANT SELECT ON public.p5b8_provider_requests TO authenticated;
GRANT ALL ON public.p5b8_provider_requests TO service_role;
ALTER TABLE public.p5b8_provider_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b8_pr_admin_read" ON public.p5b8_provider_requests FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role) OR has_role(auth.uid(), 'compliance_analyst'::app_role));

-- =========================================================================
-- 5. p5b8_provider_results
-- =========================================================================
CREATE TABLE public.p5b8_provider_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_request_id uuid REFERENCES public.p5b8_provider_requests(id) ON DELETE RESTRICT,
  provider_category text NOT NULL,
  environment text NOT NULL DEFAULT 'test',
  provider_reference text,
  result_status text NOT NULL,
  result_summary text,
  received_at timestamptz NOT NULL DEFAULT now(),
  raw_provider_payload_admin_only jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p5b8_prs_category_chk CHECK (provider_category IN (
    'sanctions_pep_adverse_media','identity_verification','company_registry_kyb',
    'director_ubo_verification','bank_account_verification','payment_confirmation',
    'document_signing_certification','mrv_carbon_geospatial','funder_institutional_dependency'
  )),
  CONSTRAINT p5b8_prs_env_chk CHECK (environment IN ('test','live'))
);
CREATE INDEX p5b8_prs_request_idx ON public.p5b8_provider_results(provider_request_id);
GRANT SELECT (id, provider_request_id, provider_category, environment, provider_reference,
  result_status, result_summary, received_at, created_at) ON public.p5b8_provider_results TO authenticated;
GRANT ALL ON public.p5b8_provider_results TO service_role;
ALTER TABLE public.p5b8_provider_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b8_prs_admin_read" ON public.p5b8_provider_results FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role) OR has_role(auth.uid(), 'compliance_analyst'::app_role));

-- =========================================================================
-- 6. p5b8_provider_decisions
-- =========================================================================
CREATE TABLE public.p5b8_provider_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_result_id uuid REFERENCES public.p5b8_provider_results(id) ON DELETE RESTRICT,
  provider_category text NOT NULL,
  decision_state text NOT NULL,
  set_by uuid REFERENCES auth.users(id),
  set_by_role text,
  reason text,
  evidence_reference text,
  is_fallback boolean NOT NULL DEFAULT false,
  is_final boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p5b8_pd_category_chk CHECK (provider_category IN (
    'sanctions_pep_adverse_media','identity_verification','company_registry_kyb',
    'director_ubo_verification','bank_account_verification','payment_confirmation',
    'document_signing_certification','mrv_carbon_geospatial','funder_institutional_dependency'
  )),
  CONSTRAINT p5b8_pd_state_chk CHECK (decision_state IN (
    'clear','potential_match','confirmed_match','manual_review','false_positive',
    'waived','blocked','incomplete','provider_unavailable','superseded'
  ))
);
CREATE INDEX p5b8_pd_result_idx ON public.p5b8_provider_decisions(provider_result_id);
GRANT SELECT ON public.p5b8_provider_decisions TO authenticated;
GRANT ALL ON public.p5b8_provider_decisions TO service_role;
ALTER TABLE public.p5b8_provider_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b8_pd_admin_read" ON public.p5b8_provider_decisions FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role) OR has_role(auth.uid(), 'compliance_analyst'::app_role));

-- =========================================================================
-- 7. p5b8_webhook_events_ledger (append-only)
-- =========================================================================
CREATE TABLE public.p5b8_webhook_events_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_category text NOT NULL,
  webhook_event text NOT NULL,
  environment text NOT NULL DEFAULT 'test',
  idempotency_key text NOT NULL,
  signature_status text NOT NULL DEFAULT 'unverified',
  received_at timestamptz NOT NULL DEFAULT now(),
  raw_webhook_payload_admin_only jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p5b8_we_category_chk CHECK (provider_category IN (
    'sanctions_pep_adverse_media','identity_verification','company_registry_kyb',
    'director_ubo_verification','bank_account_verification','payment_confirmation',
    'document_signing_certification','mrv_carbon_geospatial','funder_institutional_dependency'
  )),
  CONSTRAINT p5b8_we_event_chk CHECK (webhook_event IN (
    'verification.created','verification.pending','verification.completed','verification.failed',
    'document.required','match.potential','match.cleared','match.confirmed',
    'account.verified','payment.succeeded','payment.failed','payment.cancelled','payment.refunded',
    'chargeback.created','provider.outage','credentials.revoked','webhook.test'
  )),
  CONSTRAINT p5b8_we_env_chk CHECK (environment IN ('test','live')),
  CONSTRAINT p5b8_we_sig_chk CHECK (signature_status IN ('verified','unverified','failed','skipped_test')),
  UNIQUE (provider_category, idempotency_key)
);
CREATE INDEX p5b8_we_received_idx ON public.p5b8_webhook_events_ledger(received_at DESC);
GRANT SELECT (id, provider_category, webhook_event, environment, idempotency_key,
  signature_status, received_at, created_at) ON public.p5b8_webhook_events_ledger TO authenticated;
GRANT ALL ON public.p5b8_webhook_events_ledger TO service_role;
ALTER TABLE public.p5b8_webhook_events_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b8_we_admin_read" ON public.p5b8_webhook_events_ledger FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role) OR has_role(auth.uid(), 'compliance_analyst'::app_role));
CREATE TRIGGER p5b8_we_no_update BEFORE UPDATE ON public.p5b8_webhook_events_ledger
  FOR EACH ROW EXECUTE FUNCTION public.p5b8_block_mutation_append_only();
CREATE TRIGGER p5b8_we_no_delete BEFORE DELETE ON public.p5b8_webhook_events_ledger
  FOR EACH ROW EXECUTE FUNCTION public.p5b8_block_mutation_append_only();

-- =========================================================================
-- 8. p5b8_audit_events (append-only)
-- =========================================================================
CREATE TABLE public.p5b8_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_code text NOT NULL,
  provider_category text,
  subject_id uuid,
  case_id uuid,
  actor_id uuid REFERENCES auth.users(id),
  actor_role text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p5b8_ae_event_prefix_chk CHECK (event_code LIKE 'p5b8.%'),
  CONSTRAINT p5b8_ae_event_chk CHECK (event_code IN (
    'p5b8.provider_category.enabled','p5b8.provider_category.disabled','p5b8.provider_category.configured',
    'p5b8.provider_credentials.added','p5b8.provider_credentials.replaced','p5b8.provider_credentials.revoked',
    'p5b8.provider_credentials.missing','p5b8.provider_ready.status_created',
    'p5b8.provider_live.activation_signed_off','p5b8.provider_request.initiated',
    'p5b8.provider_response.received','p5b8.webhook.received','p5b8.webhook.duplicate_ignored',
    'p5b8.webhook.signature_failed','p5b8.webhook.test_received','p5b8.provider.failure',
    'p5b8.provider.timeout','p5b8.provider.retry_attempted','p5b8.provider.retry_exhausted',
    'p5b8.provider_decision.manual_set','p5b8.provider_decision.override','p5b8.provider_decision.waiver',
    'p5b8.provider_decision.false_positive','p5b8.provider_decision.blocked','p5b8.provider_decision.fallback',
    'p5b8.provider_payload.viewed','p5b8.provider_payload.exported','p5b8.live_check.blocked_attempt',
    'p5b8.finality.provider_dependency_blocked','p5b8.memory.provider_write_blocked'
  ))
);
CREATE INDEX p5b8_ae_created_idx ON public.p5b8_audit_events(created_at DESC);
CREATE INDEX p5b8_ae_event_idx ON public.p5b8_audit_events(event_code);
GRANT SELECT ON public.p5b8_audit_events TO authenticated;
GRANT ALL ON public.p5b8_audit_events TO service_role;
ALTER TABLE public.p5b8_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b8_ae_admin_read" ON public.p5b8_audit_events FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role) OR has_role(auth.uid(), 'compliance_analyst'::app_role));
CREATE TRIGGER p5b8_ae_no_update BEFORE UPDATE ON public.p5b8_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.p5b8_block_mutation_append_only();
CREATE TRIGGER p5b8_ae_no_delete BEFORE DELETE ON public.p5b8_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.p5b8_block_mutation_append_only();

-- =========================================================================
-- 9. p5b8_provider_retry_state
-- =========================================================================
CREATE TABLE public.p5b8_provider_retry_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_request_id uuid NOT NULL REFERENCES public.p5b8_provider_requests(id) ON DELETE RESTRICT,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_class text,
  last_attempted_at timestamptz,
  next_retry_at timestamptz,
  fallback_route text,
  exhausted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p5b8_rs_attempts_chk CHECK (attempt_count >= 0 AND attempt_count <= 10),
  CONSTRAINT p5b8_rs_error_class_chk CHECK (last_error_class IS NULL OR last_error_class IN (
    'timeout','provider_5xx','auth_failure','rate_limit','malformed_response','inconclusive','webhook_duplicate'
  ))
);
GRANT SELECT ON public.p5b8_provider_retry_state TO authenticated;
GRANT ALL ON public.p5b8_provider_retry_state TO service_role;
ALTER TABLE public.p5b8_provider_retry_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b8_rs_admin_read" ON public.p5b8_provider_retry_state FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role) OR has_role(auth.uid(), 'compliance_analyst'::app_role));
CREATE TRIGGER p5b8_rs_set_updated_at BEFORE UPDATE ON public.p5b8_provider_retry_state
  FOR EACH ROW EXECUTE FUNCTION public.p5b8_set_updated_at();

-- =========================================================================
-- 10. p5b8_memory_finality_links (link-only, append-only, NO mutation of Batch 5)
-- =========================================================================
CREATE TABLE public.p5b8_memory_finality_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_decision_id uuid NOT NULL REFERENCES public.p5b8_provider_decisions(id) ON DELETE RESTRICT,
  link_type text NOT NULL,
  memory_record_id uuid,
  finality_record_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p5b8_mfl_link_type_chk CHECK (link_type IN ('memory_reference','finality_reference','blocked_attempt')),
  CONSTRAINT p5b8_mfl_target_present CHECK (
    memory_record_id IS NOT NULL OR finality_record_id IS NOT NULL OR link_type = 'blocked_attempt'
  )
);
GRANT SELECT ON public.p5b8_memory_finality_links TO authenticated;
GRANT ALL ON public.p5b8_memory_finality_links TO service_role;
ALTER TABLE public.p5b8_memory_finality_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b8_mfl_admin_read" ON public.p5b8_memory_finality_links FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role) OR has_role(auth.uid(), 'compliance_analyst'::app_role));
CREATE TRIGGER p5b8_mfl_no_update BEFORE UPDATE ON public.p5b8_memory_finality_links
  FOR EACH ROW EXECUTE FUNCTION public.p5b8_block_mutation_append_only();
CREATE TRIGGER p5b8_mfl_no_delete BEFORE DELETE ON public.p5b8_memory_finality_links
  FOR EACH ROW EXECUTE FUNCTION public.p5b8_block_mutation_append_only();
