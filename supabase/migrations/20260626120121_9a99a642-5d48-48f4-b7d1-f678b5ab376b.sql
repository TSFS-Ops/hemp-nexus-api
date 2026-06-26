
-- ============================================================================
-- P-5 Batch 7 — Phase 5: Action wiring RPCs (strictly additive)
-- No table changes. No policy changes. No cron. No edge functions.
-- ============================================================================

-- ── List saved views (scoped to caller) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.p5b7_list_saved_views(p_dashboard TEXT)
RETURNS TABLE (
  view_id    UUID,
  dashboard  TEXT,
  name       TEXT,
  filters    JSONB,
  sort_by    TEXT,
  sort_dir   TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.view_id, v.dashboard, v.name, v.filters, v.sort_by, v.sort_dir, v.updated_at
    FROM public.p5b7_saved_views v
   WHERE v.user_id = auth.uid()
     AND (p_dashboard IS NULL OR v.dashboard = p_dashboard)
   ORDER BY v.updated_at DESC
   LIMIT 200;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_list_saved_views(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.p5b7_list_saved_views(TEXT) TO authenticated;

-- ── List own export jobs ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.p5b7_list_my_export_jobs(p_dashboard TEXT, p_limit INTEGER)
RETURNS TABLE (
  export_id    UUID,
  dashboard    TEXT,
  export_type  TEXT,
  status       TEXT,
  reason       TEXT,
  row_count    INTEGER,
  created_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.export_id, e.dashboard, e.export_type, e.status, e.reason,
         e.row_count, e.created_at, e.updated_at, e.expires_at
    FROM public.p5b7_export_jobs e
   WHERE e.requested_by = auth.uid()
     AND (p_dashboard IS NULL OR e.dashboard = p_dashboard)
   ORDER BY e.created_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 200));
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_list_my_export_jobs(TEXT, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.p5b7_list_my_export_jobs(TEXT, INTEGER) TO authenticated;

-- ── List dashboard audit events (platform_admin only) ──────────────────────
-- Note: Batch 7 conceptual role "auditor" maps onto platform_admin for now;
-- when a dedicated auditor role exists it can be added here without altering callers.
CREATE OR REPLACE FUNCTION public.p5b7_list_dashboard_audit(p_dashboard TEXT, p_limit INTEGER)
RETURNS TABLE (
  audit_id      UUID,
  actor_user_id UUID,
  actor_role    TEXT,
  dashboard     TEXT,
  event_name    TEXT,
  subject_kind  TEXT,
  subject_ref   TEXT,
  payload       JSONB,
  created_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(auth.uid(), 'platform_admin'::app_role) THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT a.audit_id, a.actor_user_id, a.actor_role, a.dashboard, a.event_name,
           a.subject_kind, a.subject_ref, a.payload, a.created_at
      FROM public.p5b7_dashboard_actions_audit a
     WHERE (p_dashboard IS NULL OR a.dashboard = p_dashboard)
     ORDER BY a.created_at DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_list_dashboard_audit(TEXT, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.p5b7_list_dashboard_audit(TEXT, INTEGER) TO authenticated;

-- ── List export audit events (platform_admin only) ─────────────────────────
CREATE OR REPLACE FUNCTION public.p5b7_list_export_audit(p_limit INTEGER)
RETURNS TABLE (
  audit_id      UUID,
  export_id     UUID,
  actor_user_id UUID,
  event_name    TEXT,
  payload       JSONB,
  created_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(auth.uid(), 'platform_admin'::app_role) THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT a.audit_id, a.export_id, a.actor_user_id, a.event_name, a.payload, a.created_at
      FROM public.p5b7_export_audit a
     ORDER BY a.created_at DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_list_export_audit(INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.p5b7_list_export_audit(INTEGER) TO authenticated;

-- ── Stale-data acknowledgement (append-only audit) ─────────────────────────
CREATE OR REPLACE FUNCTION public.p5b7_acknowledge_stale_data(
  p_dashboard TEXT,
  p_as_of     TIMESTAMPTZ,
  p_reason    TEXT
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
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'reason required (>=5 chars)' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.p5b7_dashboard_actions_audit
    (actor_user_id, dashboard, event_name, subject_kind, subject_ref, payload)
  VALUES
    (v_user, p_dashboard, 'p5b7.stale_data.acknowledged', 'dashboard', p_dashboard,
     jsonb_build_object('as_of', p_as_of, 'reason', trim(p_reason)))
  RETURNING audit_id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_acknowledge_stale_data(TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.p5b7_acknowledge_stale_data(TEXT, TIMESTAMPTZ, TEXT) TO authenticated;

-- ── Sensitive-field reveal log (logging only — never returns the value) ────
CREATE OR REPLACE FUNCTION public.p5b7_log_sensitive_field_reveal(
  p_dashboard    TEXT,
  p_subject_kind TEXT,
  p_subject_ref  TEXT,
  p_field_name   TEXT,
  p_reason       TEXT
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
  IF NOT public.has_role(v_user, 'platform_admin'::app_role) THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;
  IF p_field_name IS NULL OR length(trim(p_field_name)) = 0 THEN
    RAISE EXCEPTION 'field_name required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'reason required (>=10 chars)' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.p5b7_dashboard_actions_audit
    (actor_user_id, dashboard, event_name, subject_kind, subject_ref, payload)
  VALUES
    (v_user, p_dashboard, 'p5b7.sensitive_field.revealed', p_subject_kind, p_subject_ref,
     jsonb_build_object('field_name', p_field_name, 'reason', trim(p_reason)))
  RETURNING audit_id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_log_sensitive_field_reveal(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.p5b7_log_sensitive_field_reveal(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
