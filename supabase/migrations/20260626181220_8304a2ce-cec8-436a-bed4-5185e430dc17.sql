
-- ============================================================================
-- P-5 Screening & IDV — Phase 2 canonical spine
-- Append-only, service-role write, platform_admin read. No mutation of
-- Memory or finality tables. No pg_cron, no edge functions, no live calls.
-- ============================================================================

-- Shared append-only enforcement trigger function ----------------------------
CREATE OR REPLACE FUNCTION public.p5scr_block_mutation_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'p5scr append-only: % not permitted on %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;
REVOKE ALL ON FUNCTION public.p5scr_block_mutation_append_only() FROM PUBLIC;

-- 1. p5scr_subjects ----------------------------------------------------------
CREATE TABLE public.p5scr_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_role text NOT NULL CHECK (party_role IN (
    'buyer_company','seller_company',
    'buyer_authorised_representative','seller_authorised_representative',
    'funder_representative','admin_user','agent_or_introducer',
    'required_counterparty','director_if_relied','ubo_if_acting'
  )),
  organisation_id uuid NULL,
  person_external_ref text NULL,
  display_label text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.p5scr_subjects TO authenticated;
GRANT ALL ON public.p5scr_subjects TO service_role;
ALTER TABLE public.p5scr_subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5scr_subjects_admin_read" ON public.p5scr_subjects
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));

-- 2. p5scr_check_state -------------------------------------------------------
CREATE TABLE public.p5scr_check_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.p5scr_subjects(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN (
    'company_aml_sanctions','pep','watchlist_name',
    'idv_person','adverse_media_admin_triggered'
  )),
  state text NOT NULL CHECK (state IN (
    'not_required','not_started','screening_pending','idv_pending',
    'provider_pending','manual_review_required','screening_expired',
    'cleared','cleared_with_conditions','failed','rejected'
  )),
  last_result_id uuid NULL,
  decided_at timestamptz NULL,
  expires_at timestamptz NULL,
  active_invalidation_triggers text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_id, category)
);
GRANT SELECT ON public.p5scr_check_state TO authenticated;
GRANT ALL ON public.p5scr_check_state TO service_role;
ALTER TABLE public.p5scr_check_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5scr_check_state_admin_read" ON public.p5scr_check_state
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));

-- 3. p5scr_check_results (append-only) ---------------------------------------
CREATE TABLE public.p5scr_check_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.p5scr_subjects(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN (
    'company_aml_sanctions','pep','watchlist_name',
    'idv_person','adverse_media_admin_triggered'
  )),
  state text NOT NULL CHECK (state IN (
    'not_required','screening_pending','idv_pending','provider_pending',
    'manual_review_required','screening_expired',
    'cleared','cleared_with_conditions','failed','rejected'
  )),
  source text NOT NULL CHECK (source IN (
    'provider_ready_stub','provider_webhook','admin_manual','admin_reuse'
  )),
  provider_ref text NULL,
  provider_live_now boolean NOT NULL DEFAULT false,
  activation_signed_off_at timestamptz NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  raw_provider_payload_admin_only jsonb NULL,
  recorded_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p5scr_cr_live_requires_signoff
    CHECK (provider_live_now = false OR (activation_signed_off_at IS NOT NULL))
);
GRANT SELECT ON public.p5scr_check_results TO authenticated;
GRANT ALL ON public.p5scr_check_results TO service_role;
ALTER TABLE public.p5scr_check_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5scr_check_results_admin_read" ON public.p5scr_check_results
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));
CREATE TRIGGER p5scr_check_results_append_only
  BEFORE UPDATE OR DELETE ON public.p5scr_check_results
  FOR EACH ROW EXECUTE FUNCTION public.p5scr_block_mutation_append_only();

-- 4. p5scr_manual_reviews ----------------------------------------------------
CREATE TABLE public.p5scr_manual_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.p5scr_subjects(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN (
    'company_aml_sanctions','pep','watchlist_name',
    'idv_person','adverse_media_admin_triggered'
  )),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by uuid NULL,
  decided_at timestamptz NULL,
  decided_by uuid NULL,
  decision text NULL CHECK (decision IS NULL OR decision IN (
    'cleared','cleared_with_conditions','failed','rejected'
  )),
  reason text NULL,
  notes_admin_only text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.p5scr_manual_reviews TO authenticated;
GRANT ALL ON public.p5scr_manual_reviews TO service_role;
ALTER TABLE public.p5scr_manual_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5scr_manual_reviews_admin_read" ON public.p5scr_manual_reviews
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));

-- 5. p5scr_idv_records (append-only) -----------------------------------------
CREATE TABLE public.p5scr_idv_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.p5scr_subjects(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN (
    'idv_pending','provider_pending','manual_review_required',
    'cleared','cleared_with_conditions','failed','rejected','screening_expired'
  )),
  provider_ref text NULL,
  provider_live_now boolean NOT NULL DEFAULT false,
  activation_signed_off_at timestamptz NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  raw_provider_payload_admin_only jsonb NULL,
  recorded_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p5scr_idv_live_requires_signoff
    CHECK (provider_live_now = false OR (activation_signed_off_at IS NOT NULL))
);
GRANT SELECT ON public.p5scr_idv_records TO authenticated;
GRANT ALL ON public.p5scr_idv_records TO service_role;
ALTER TABLE public.p5scr_idv_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5scr_idv_records_admin_read" ON public.p5scr_idv_records
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));
CREATE TRIGGER p5scr_idv_records_append_only
  BEFORE UPDATE OR DELETE ON public.p5scr_idv_records
  FOR EACH ROW EXECUTE FUNCTION public.p5scr_block_mutation_append_only();

-- 6. p5scr_invalidations (append-only) ---------------------------------------
CREATE TABLE public.p5scr_invalidations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.p5scr_subjects(id) ON DELETE RESTRICT,
  category text NULL CHECK (category IS NULL OR category IN (
    'company_aml_sanctions','pep','watchlist_name',
    'idv_person','adverse_media_admin_triggered'
  )),
  trigger text NOT NULL CHECK (trigger IN (
    'core_details_changed','new_required_party_added','unresolved_review_exists',
    'provider_invalidated_result','admin_required_recheck'
  )),
  reason text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.p5scr_invalidations TO authenticated;
GRANT ALL ON public.p5scr_invalidations TO service_role;
ALTER TABLE public.p5scr_invalidations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5scr_invalidations_admin_read" ON public.p5scr_invalidations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));
CREATE TRIGGER p5scr_invalidations_append_only
  BEFORE UPDATE OR DELETE ON public.p5scr_invalidations
  FOR EACH ROW EXECUTE FUNCTION public.p5scr_block_mutation_append_only();

-- 7. p5scr_audit_events (append-only) ----------------------------------------
CREATE TABLE public.p5scr_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL CHECK (event IN (
    'p5_screening.check_requested',
    'p5_screening.provider_pending_recorded',
    'p5_screening.result_recorded',
    'p5_screening.result_reused',
    'p5_screening.result_expired',
    'p5_screening.manual_review_opened',
    'p5_screening.manual_review_decided',
    'p5_screening.possible_sanctions_match_opened',
    'p5_screening.pep_review_opened',
    'p5_screening.adverse_media_triggered_by_admin',
    'p5_screening.idv_required',
    'p5_screening.idv_completed',
    'p5_screening.idv_failed',
    'p5_screening.gate_blocked',
    'p5_screening.gate_cleared',
    'p5_screening.api_readiness_evaluated',
    'p5_screening.memory_link_recorded'
  )),
  subject_id uuid NULL REFERENCES public.p5scr_subjects(id) ON DELETE RESTRICT,
  category text NULL,
  gate text NULL,
  actor_user_id uuid NULL,
  payload_admin_only jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.p5scr_audit_events TO authenticated;
GRANT ALL ON public.p5scr_audit_events TO service_role;
ALTER TABLE public.p5scr_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5scr_audit_events_admin_read" ON public.p5scr_audit_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));
CREATE TRIGGER p5scr_audit_events_append_only
  BEFORE UPDATE OR DELETE ON public.p5scr_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.p5scr_block_mutation_append_only();

-- 8. p5scr_webhook_events_ledger (append-only) -------------------------------
CREATE TABLE public.p5scr_webhook_events_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL CHECK (event IN (
    'p5_screening.webhook.result_received',
    'p5_screening.webhook.provider_pending',
    'p5_screening.webhook.provider_invalidated',
    'p5_screening.webhook.idv_completed',
    'p5_screening.webhook.idv_failed'
  )),
  provider_ref text NULL,
  signature_hash text NULL,
  raw_webhook_payload_admin_only jsonb NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.p5scr_webhook_events_ledger TO authenticated;
GRANT ALL ON public.p5scr_webhook_events_ledger TO service_role;
ALTER TABLE public.p5scr_webhook_events_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5scr_webhook_ledger_admin_read" ON public.p5scr_webhook_events_ledger
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));
CREATE TRIGGER p5scr_webhook_ledger_append_only
  BEFORE UPDATE OR DELETE ON public.p5scr_webhook_events_ledger
  FOR EACH ROW EXECUTE FUNCTION public.p5scr_block_mutation_append_only();

-- 9. p5scr_memory_finality_links (append-only, link-only) --------------------
CREATE TABLE public.p5scr_memory_finality_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.p5scr_subjects(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('memory_record','finality_record')),
  memory_record_id uuid NULL,
  finality_record_id uuid NULL,
  link_note text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'memory_record'   AND memory_record_id   IS NOT NULL AND finality_record_id IS NULL) OR
    (kind = 'finality_record' AND finality_record_id IS NOT NULL AND memory_record_id   IS NULL)
  )
);
GRANT SELECT ON public.p5scr_memory_finality_links TO authenticated;
GRANT ALL ON public.p5scr_memory_finality_links TO service_role;
ALTER TABLE public.p5scr_memory_finality_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5scr_memory_finality_links_admin_read" ON public.p5scr_memory_finality_links
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));
CREATE TRIGGER p5scr_memory_finality_links_append_only
  BEFORE UPDATE OR DELETE ON public.p5scr_memory_finality_links
  FOR EACH ROW EXECUTE FUNCTION public.p5scr_block_mutation_append_only();

-- updated_at triggers for the mutable spine tables ---------------------------
CREATE TRIGGER p5scr_subjects_updated_at
  BEFORE UPDATE ON public.p5scr_subjects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER p5scr_check_state_updated_at
  BEFORE UPDATE ON public.p5scr_check_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER p5scr_manual_reviews_updated_at
  BEFORE UPDATE ON public.p5scr_manual_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helpful read indexes -------------------------------------------------------
CREATE INDEX p5scr_check_state_subject_idx ON public.p5scr_check_state(subject_id);
CREATE INDEX p5scr_check_results_subject_idx ON public.p5scr_check_results(subject_id, category, decided_at DESC);
CREATE INDEX p5scr_manual_reviews_open_idx ON public.p5scr_manual_reviews(subject_id, category) WHERE decided_at IS NULL;
CREATE INDEX p5scr_audit_events_subject_idx ON public.p5scr_audit_events(subject_id, created_at DESC);
CREATE INDEX p5scr_webhook_ledger_ref_idx ON public.p5scr_webhook_events_ledger(provider_ref, received_at DESC);
CREATE INDEX p5scr_invalidations_subject_idx ON public.p5scr_invalidations(subject_id, created_at DESC);
