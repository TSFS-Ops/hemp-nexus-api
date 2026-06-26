
-- ============================================================================
-- P-5 Batch 7 — Phase 2: DB / RLS / Audit / Visibility Foundations
-- Strictly additive. No changes to Batch 1–6 tables, RPCs, or policies.
-- ============================================================================

-- ── 1. p5b7_saved_views ────────────────────────────────────────────────────
CREATE TABLE public.p5b7_saved_views (
  view_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dashboard    TEXT NOT NULL CHECK (dashboard IN (
                 'control_dashboard','compliance_dashboard','api_dashboard',
                 'provider_dashboard','org_dashboard','funder_dashboard','audit_dashboard')),
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  filters      JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_by      TEXT,
  sort_dir     TEXT CHECK (sort_dir IS NULL OR sort_dir IN ('asc','desc')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, dashboard, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.p5b7_saved_views TO authenticated;
GRANT ALL ON public.p5b7_saved_views TO service_role;
ALTER TABLE public.p5b7_saved_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b7_saved_views_owner_select" ON public.p5b7_saved_views
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "p5b7_saved_views_owner_insert" ON public.p5b7_saved_views
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "p5b7_saved_views_owner_update" ON public.p5b7_saved_views
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "p5b7_saved_views_owner_delete" ON public.p5b7_saved_views
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ── 2. p5b7_dashboard_actions_audit ────────────────────────────────────────
CREATE TABLE public.p5b7_dashboard_actions_audit (
  audit_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role      TEXT,
  dashboard       TEXT NOT NULL CHECK (dashboard IN (
                    'control_dashboard','compliance_dashboard','api_dashboard',
                    'provider_dashboard','org_dashboard','funder_dashboard','audit_dashboard')),
  event_name      TEXT NOT NULL CHECK (event_name LIKE 'p5b7.%'),
  subject_kind    TEXT,
  subject_ref     TEXT,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.p5b7_dashboard_actions_audit TO authenticated;
GRANT ALL ON public.p5b7_dashboard_actions_audit TO service_role;
ALTER TABLE public.p5b7_dashboard_actions_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b7_dashboard_audit_admin_select" ON public.p5b7_dashboard_actions_audit
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'platform_admin'::app_role));
-- INSERT only via SECURITY DEFINER RPC (no INSERT policy granted to authenticated).

-- ── 3. p5b7_export_jobs ────────────────────────────────────────────────────
CREATE TABLE public.p5b7_export_jobs (
  export_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dashboard      TEXT NOT NULL CHECK (dashboard IN (
                   'control_dashboard','compliance_dashboard','api_dashboard',
                   'provider_dashboard','org_dashboard','funder_dashboard','audit_dashboard')),
  export_type    TEXT NOT NULL CHECK (export_type IN (
                   'control_summary_csv','compliance_summary_csv','api_usage_csv',
                   'provider_status_csv','org_case_summary_csv','funder_case_summary_csv',
                   'audit_event_csv')),
  status         TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                   'queued','in_progress','ready','failed','expired')),
  reason         TEXT,
  filters        JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_count      INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE ON public.p5b7_export_jobs TO authenticated;
GRANT ALL ON public.p5b7_export_jobs TO service_role;
ALTER TABLE public.p5b7_export_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b7_export_jobs_owner_or_admin_select" ON public.p5b7_export_jobs
  FOR SELECT TO authenticated USING (
    requested_by = auth.uid() OR public.has_role(auth.uid(), 'platform_admin'::app_role)
  );
-- INSERT and UPDATE only via SECURITY DEFINER RPC.

-- ── 4. p5b7_export_audit ───────────────────────────────────────────────────
CREATE TABLE public.p5b7_export_audit (
  audit_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  export_id       UUID REFERENCES public.p5b7_export_jobs(export_id) ON DELETE SET NULL,
  actor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_name      TEXT NOT NULL CHECK (event_name LIKE 'p5b7.export.%'),
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.p5b7_export_audit TO authenticated;
GRANT ALL ON public.p5b7_export_audit TO service_role;
ALTER TABLE public.p5b7_export_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b7_export_audit_admin_select" ON public.p5b7_export_audit
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'platform_admin'::app_role));

-- ── 5. p5b7_api_field_visibility ───────────────────────────────────────────
CREATE TABLE public.p5b7_api_field_visibility (
  field_name      TEXT PRIMARY KEY,
  api_version     TEXT NOT NULL DEFAULT 'v1',
  is_visible      BOOLEAN NOT NULL DEFAULT TRUE,
  is_forbidden    BOOLEAN NOT NULL DEFAULT FALSE,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT (is_visible AND is_forbidden))
);
GRANT SELECT ON public.p5b7_api_field_visibility TO authenticated;
GRANT ALL ON public.p5b7_api_field_visibility TO service_role;
ALTER TABLE public.p5b7_api_field_visibility ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b7_api_field_visibility_read_all" ON public.p5b7_api_field_visibility
  FOR SELECT TO authenticated USING (TRUE);

-- ── 6. p5b7_provider_dependencies ──────────────────────────────────────────
CREATE TABLE public.p5b7_provider_dependencies (
  provider_id      TEXT PRIMARY KEY,
  provider_label   TEXT NOT NULL,
  category         TEXT NOT NULL CHECK (category IN (
                     'identity','registry','sanctions','banking','communication','other')),
  health_status    TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN (
                     'healthy','degraded','unavailable','unknown')),
  last_checked_at  TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.p5b7_provider_dependencies TO authenticated;
GRANT ALL ON public.p5b7_provider_dependencies TO service_role;
ALTER TABLE public.p5b7_provider_dependencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b7_provider_dependencies_read_all" ON public.p5b7_provider_dependencies
  FOR SELECT TO authenticated USING (TRUE);

-- ── 7. p5b7_stale_data_thresholds ──────────────────────────────────────────
CREATE TABLE public.p5b7_stale_data_thresholds (
  surface              TEXT PRIMARY KEY,
  warn_after_seconds   INTEGER NOT NULL CHECK (warn_after_seconds >= 0),
  fail_after_seconds   INTEGER NOT NULL CHECK (fail_after_seconds >= 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fail_after_seconds >= warn_after_seconds)
);
GRANT SELECT ON public.p5b7_stale_data_thresholds TO authenticated;
GRANT ALL ON public.p5b7_stale_data_thresholds TO service_role;
ALTER TABLE public.p5b7_stale_data_thresholds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b7_stale_thresholds_read_all" ON public.p5b7_stale_data_thresholds
  FOR SELECT TO authenticated USING (TRUE);

-- ============================================================================
-- Append-only protection for audit tables
-- ============================================================================

CREATE OR REPLACE FUNCTION public.p5b7_block_mutation_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'p5b7 append-only protection: table % does not allow % operations',
    TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.p5b7_block_mutation_append_only() FROM PUBLIC;

CREATE TRIGGER p5b7_dashboard_audit_no_update
  BEFORE UPDATE ON public.p5b7_dashboard_actions_audit
  FOR EACH ROW EXECUTE FUNCTION public.p5b7_block_mutation_append_only();
CREATE TRIGGER p5b7_dashboard_audit_no_delete
  BEFORE DELETE ON public.p5b7_dashboard_actions_audit
  FOR EACH ROW EXECUTE FUNCTION public.p5b7_block_mutation_append_only();

CREATE TRIGGER p5b7_export_audit_no_update
  BEFORE UPDATE ON public.p5b7_export_audit
  FOR EACH ROW EXECUTE FUNCTION public.p5b7_block_mutation_append_only();
CREATE TRIGGER p5b7_export_audit_no_delete
  BEFORE DELETE ON public.p5b7_export_audit
  FOR EACH ROW EXECUTE FUNCTION public.p5b7_block_mutation_append_only();

-- ============================================================================
-- updated_at triggers (reuse existing public.update_updated_at_column())
-- ============================================================================

CREATE TRIGGER p5b7_saved_views_updated_at
  BEFORE UPDATE ON public.p5b7_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER p5b7_export_jobs_updated_at
  BEFORE UPDATE ON public.p5b7_export_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER p5b7_api_field_visibility_updated_at
  BEFORE UPDATE ON public.p5b7_api_field_visibility
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER p5b7_provider_dependencies_updated_at
  BEFORE UPDATE ON public.p5b7_provider_dependencies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER p5b7_stale_data_thresholds_updated_at
  BEFORE UPDATE ON public.p5b7_stale_data_thresholds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- SECURITY DEFINER write RPCs (single foundational set for Phase 2)
-- All writes to Batch 7 tables in later phases must go through RPCs of this
-- shape: SECURITY DEFINER, SET search_path = public, EXECUTE revoked from PUBLIC.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.p5b7_upsert_saved_view(
  p_view_id   UUID,
  p_dashboard TEXT,
  p_name      TEXT,
  p_filters   JSONB,
  p_sort_by   TEXT,
  p_sort_dir  TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_id   UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;
  IF p_view_id IS NULL THEN
    INSERT INTO public.p5b7_saved_views (user_id, dashboard, name, filters, sort_by, sort_dir)
    VALUES (v_user, p_dashboard, p_name, COALESCE(p_filters, '{}'::jsonb), p_sort_by, p_sort_dir)
    RETURNING view_id INTO v_id;
  ELSE
    UPDATE public.p5b7_saved_views
       SET name = p_name, filters = COALESCE(p_filters, '{}'::jsonb),
           sort_by = p_sort_by, sort_dir = p_sort_dir, updated_at = now()
     WHERE view_id = p_view_id AND user_id = v_user
     RETURNING view_id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'saved view not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_upsert_saved_view(UUID,TEXT,TEXT,JSONB,TEXT,TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.p5b7_upsert_saved_view(UUID,TEXT,TEXT,JSONB,TEXT,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.p5b7_delete_saved_view(p_view_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user UUID := auth.uid(); v_n INT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.p5b7_saved_views WHERE view_id = p_view_id AND user_id = v_user;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_delete_saved_view(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.p5b7_delete_saved_view(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.p5b7_record_dashboard_action(
  p_dashboard    TEXT,
  p_event_name   TEXT,
  p_subject_kind TEXT,
  p_subject_ref  TEXT,
  p_payload      JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user UUID := auth.uid(); v_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;
  IF p_event_name NOT LIKE 'p5b7.%' THEN
    RAISE EXCEPTION 'event_name must use p5b7.* prefix' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.p5b7_dashboard_actions_audit
    (actor_user_id, dashboard, event_name, subject_kind, subject_ref, payload)
  VALUES
    (v_user, p_dashboard, p_event_name, p_subject_kind, p_subject_ref,
     COALESCE(p_payload, '{}'::jsonb))
  RETURNING audit_id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_record_dashboard_action(TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.p5b7_record_dashboard_action(TEXT,TEXT,TEXT,TEXT,JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.p5b7_create_export_job(
  p_dashboard   TEXT,
  p_export_type TEXT,
  p_reason      TEXT,
  p_filters     JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user UUID := auth.uid(); v_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.p5b7_export_jobs (requested_by, dashboard, export_type, reason, filters)
  VALUES (v_user, p_dashboard, p_export_type, p_reason, COALESCE(p_filters, '{}'::jsonb))
  RETURNING export_id INTO v_id;
  INSERT INTO public.p5b7_export_audit (export_id, actor_user_id, event_name, payload)
  VALUES (v_id, v_user, 'p5b7.export.requested',
          jsonb_build_object('dashboard', p_dashboard, 'export_type', p_export_type));
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_create_export_job(TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.p5b7_create_export_job(TEXT,TEXT,TEXT,JSONB) TO authenticated;

-- ============================================================================
-- Seed data from the Phase 1 SSOT registry
-- ============================================================================

-- API v1 visible fields
INSERT INTO public.p5b7_api_field_visibility (field_name, api_version, is_visible, is_forbidden)
VALUES
  ('case_id','v1',TRUE,FALSE),('case_reference','v1',TRUE,FALSE),('case_status','v1',TRUE,FALSE),
  ('case_stage','v1',TRUE,FALSE),('case_created_at','v1',TRUE,FALSE),('case_updated_at','v1',TRUE,FALSE),
  ('as_of','v1',TRUE,FALSE),('is_stale','v1',TRUE,FALSE),
  ('org_id','v1',TRUE,FALSE),('org_reference','v1',TRUE,FALSE),
  ('counterparty_reference','v1',TRUE,FALSE),('counterparty_jurisdiction','v1',TRUE,FALSE),
  ('evidence_summary_status','v1',TRUE,FALSE),('evidence_items_count','v1',TRUE,FALSE),
  ('evidence_outstanding_count','v1',TRUE,FALSE),
  ('finality_status','v1',TRUE,FALSE),('finality_is_blocked','v1',TRUE,FALSE),
  ('memory_linkage_status','v1',TRUE,FALSE),
  ('open_exceptions_count','v1',TRUE,FALSE),('open_blockers_count','v1',TRUE,FALSE),
  ('funder_access_status','v1',TRUE,FALSE),
  ('page','v1',TRUE,FALSE),('page_size','v1',TRUE,FALSE),('total_count','v1',TRUE,FALSE),
  ('next_cursor','v1',TRUE,FALSE)
ON CONFLICT (field_name) DO NOTHING;

-- Forbidden field block-list
INSERT INTO public.p5b7_api_field_visibility (field_name, api_version, is_visible, is_forbidden)
VALUES
  ('raw_provider_payload','v1',FALSE,TRUE),('raw_provider_response','v1',FALSE,TRUE),
  ('provider_api_key','v1',FALSE,TRUE),('provider_secret','v1',FALSE,TRUE),
  ('internal_reviewer_note','v1',FALSE,TRUE),('internal_risk_commentary','v1',FALSE,TRUE),
  ('private_compliance_note','v1',FALSE,TRUE),('internal_dispute_commentary','v1',FALSE,TRUE),
  ('hidden_audit_metadata','v1',FALSE,TRUE),('raw_audit_payload','v1',FALSE,TRUE),
  ('raw_memory_snapshot','v1',FALSE,TRUE),('raw_finality_internal_metadata','v1',FALSE,TRUE),
  ('ai_unreviewed_draft','v1',FALSE,TRUE),('ai_chain_of_thought','v1',FALSE,TRUE),
  ('credential_material','v1',FALSE,TRUE),('encrypted_secret_blob','v1',FALSE,TRUE),
  ('ssn_value','v1',FALSE,TRUE),('tax_id_value','v1',FALSE,TRUE),
  ('bank_account_number_raw','v1',FALSE,TRUE),('report_scope_internals','v1',FALSE,TRUE)
ON CONFLICT (field_name) DO NOTHING;

-- Stale thresholds
INSERT INTO public.p5b7_stale_data_thresholds (surface, warn_after_seconds, fail_after_seconds) VALUES
  ('control_dashboard',300,1800),('compliance_dashboard',300,1800),('api_dashboard',300,1800),
  ('provider_dashboard',120,900),('org_dashboard',600,3600),('funder_dashboard',600,3600),
  ('audit_dashboard',900,3600),('api_v1',300,1800)
ON CONFLICT (surface) DO NOTHING;

-- Initial provider dependency rows (status starts at 'unknown')
INSERT INTO public.p5b7_provider_dependencies (provider_id, provider_label, category) VALUES
  ('identity_idv','Identity Verification (IDV)','identity'),
  ('companies_registry','Companies Registry','registry'),
  ('sanctions_screening','Sanctions Screening','sanctions'),
  ('banking_verification','Banking Verification','banking')
ON CONFLICT (provider_id) DO NOTHING;
