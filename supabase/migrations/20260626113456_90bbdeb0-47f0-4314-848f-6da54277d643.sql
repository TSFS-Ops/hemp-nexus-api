-- ============================================================================
-- P-5 Batch 7 — Phase 3: API Visibility Layer (v1, read-only)
-- All functions: STABLE, SECURITY DEFINER, search_path=public,
-- REVOKE EXECUTE FROM PUBLIC, GRANT EXECUTE TO authenticated, service_role.
-- Read-only. No new app_role values. No cron. No edge functions.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.p5b7_api_v1_resolve_scope()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_is_admin BOOLEAN := FALSE;
  v_is_auditor BOOLEAN := FALSE;
  v_org_id UUID;
  v_funder_orgs UUID[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('authenticated', FALSE, 'is_admin', FALSE,
      'is_auditor', FALSE, 'org_id', NULL, 'funder_org_ids', '[]'::jsonb);
  END IF;
  v_is_admin := public.has_role(v_uid, 'admin'::public.app_role);
  v_is_auditor := public.has_role(v_uid, 'auditor'::public.app_role);
  SELECT org_id INTO v_org_id FROM public.profiles WHERE id = v_uid;
  SELECT COALESCE(array_agg(DISTINCT funder_organisation_id), ARRAY[]::UUID[])
    INTO v_funder_orgs FROM public.p5_batch3_funder_users
    WHERE auth_user_id = v_uid AND status = 'active';
  RETURN jsonb_build_object('authenticated', TRUE, 'is_admin', v_is_admin,
    'is_auditor', v_is_auditor, 'org_id', v_org_id,
    'funder_org_ids', to_jsonb(v_funder_orgs));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_api_v1_resolve_scope() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b7_api_v1_resolve_scope() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.p5b7_api_v1_compute_stale(p_as_of TIMESTAMPTZ, p_surface TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_warn INT; v_fail INT; v_age NUMERIC; v_state TEXT;
BEGIN
  IF p_as_of IS NULL THEN
    RETURN jsonb_build_object('as_of', NULL, 'is_stale', TRUE,
      'stale_state', 'unknown', 'surface', p_surface);
  END IF;
  SELECT warn_after_seconds, fail_after_seconds INTO v_warn, v_fail
    FROM public.p5b7_stale_data_thresholds WHERE surface = p_surface LIMIT 1;
  v_warn := COALESCE(v_warn, 300); v_fail := COALESCE(v_fail, 1800);
  v_age := EXTRACT(EPOCH FROM (now() - p_as_of));
  v_state := CASE WHEN v_age >= v_fail THEN 'fail'
                  WHEN v_age >= v_warn THEN 'warn'
                  ELSE 'fresh' END;
  RETURN jsonb_build_object('as_of', p_as_of, 'is_stale', v_state <> 'fresh',
    'stale_state', v_state, 'surface', p_surface);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_api_v1_compute_stale(TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b7_api_v1_compute_stale(TIMESTAMPTZ, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.p5b7_api_v1_map_case_status(p_raw TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_raw,''))
    WHEN 'in_progress' THEN 'in_progress'
    WHEN 'awaiting_evidence' THEN 'awaiting_evidence'
    WHEN 'evidence_pending' THEN 'awaiting_evidence'
    WHEN 'in_review' THEN 'in_review'
    WHEN 'review' THEN 'in_review'
    WHEN 'on_hold' THEN 'on_hold'
    WHEN 'hold' THEN 'on_hold'
    WHEN 'blocked' THEN 'blocked'
    WHEN 'resolved' THEN 'resolved'
    WHEN 'closed' THEN 'closed'
    WHEN 'archived' THEN 'closed'
    WHEN 'withdrawn' THEN 'withdrawn'
    WHEN 'cancelled' THEN 'withdrawn'
    ELSE 'in_progress' END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_api_v1_map_case_status(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b7_api_v1_map_case_status(TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.p5b7_api_v1_map_finality_status(p_raw TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_raw,''))
    WHEN 'finalised' THEN 'finalised'
    WHEN 'finalized' THEN 'finalised'
    WHEN 'final' THEN 'finalised'
    WHEN 'blocked' THEN 'blocked'
    WHEN 'superseded' THEN 'superseded'
    ELSE 'not_finalised' END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_api_v1_map_finality_status(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b7_api_v1_map_finality_status(TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.p5b7_api_v1_list_cases(
  p_org_id UUID DEFAULT NULL,
  p_funder_org_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_cursor TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  case_id UUID, case_reference TEXT, case_status TEXT, case_stage TEXT,
  case_created_at TIMESTAMPTZ, case_updated_at TIMESTAMPTZ,
  as_of TIMESTAMPTZ, is_stale BOOLEAN,
  org_id UUID, org_reference TEXT,
  counterparty_reference TEXT, counterparty_jurisdiction TEXT,
  evidence_summary_status TEXT, evidence_items_count INT, evidence_outstanding_count INT,
  finality_status TEXT, finality_is_blocked BOOLEAN, memory_linkage_status TEXT,
  open_exceptions_count INT, open_blockers_count INT, funder_access_status TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_scope JSONB := public.p5b7_api_v1_resolve_scope();
  v_uid UUID := auth.uid();
  v_limit INT := LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
  v_admin BOOLEAN := coalesce((v_scope->>'is_admin')::BOOLEAN, FALSE);
  v_auditor BOOLEAN := coalesce((v_scope->>'is_auditor')::BOOLEAN, FALSE);
  v_user_org UUID := NULLIF(v_scope->>'org_id','')::UUID;
  v_warn INT;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT warn_after_seconds INTO v_warn
    FROM public.p5b7_stale_data_thresholds WHERE surface = 'api_v1';
  v_warn := coalesce(v_warn, 300);

  RETURN QUERY
  WITH scoped AS (
    SELECT c.*
      FROM public.p5_batch4_execution_cases c
     WHERE (
        v_admin OR v_auditor
        OR (v_user_org IS NOT NULL AND c.linked_company_id = v_user_org)
        OR (c.funder_status IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.p5_batch3_funder_users fu
               WHERE fu.auth_user_id = v_uid AND fu.status = 'active'))
       )
       AND (p_org_id IS NULL OR c.linked_company_id = p_org_id)
       AND (p_funder_org_id IS NULL OR c.funder_status IS NOT NULL)
       AND (p_cursor IS NULL OR c.updated_at < p_cursor)
  ), counts AS (
    SELECT s.id AS cid,
      (SELECT count(*)::INT FROM public.p5b6_exceptions x
        WHERE x.related_match_id = s.id
          AND x.status IN ('open','in_review','on_hold')) AS open_exc,
      (SELECT count(*)::INT FROM public.p5_batch4_blockers bk
        WHERE bk.case_id = s.id
          AND bk.status IN ('open','in_progress')) AS open_blk,
      (SELECT count(*)::INT FROM public.p5_batch4_evidence_items ei
        WHERE ei.case_id = s.id) AS ev_items,
      (SELECT count(*)::INT FROM public.p5_batch4_evidence_items ei
        WHERE ei.case_id = s.id
          AND ei.status::TEXT NOT IN ('accepted','waived')) AS ev_out
    FROM scoped s
  )
  SELECT
    s.id,
    s.case_reference,
    public.p5b7_api_v1_map_case_status(s.execution_status::TEXT),
    coalesce(s.current_milestone::TEXT, 'in_progress'),
    s.created_at,
    s.updated_at,
    s.updated_at,
    (EXTRACT(EPOCH FROM (now() - s.updated_at)) >= v_warn),
    s.linked_company_id,
    NULL::TEXT,
    NULL::TEXT,
    NULL::TEXT,
    CASE WHEN cn.ev_out = 0 AND cn.ev_items > 0 THEN 'accepted'
         WHEN cn.ev_items = 0 THEN 'not_started'
         ELSE 'in_progress' END,
    cn.ev_items,
    cn.ev_out,
    public.p5b7_api_v1_map_finality_status(s.finality_status::TEXT),
    (lower(coalesce(s.finality_status::TEXT,'')) = 'blocked'),
    CASE WHEN s.memory_summary_id IS NULL THEN 'not_applicable' ELSE 'active' END,
    cn.open_exc,
    cn.open_blk,
    CASE WHEN s.funder_status IS NULL THEN 'not_shared'
         ELSE lower(s.funder_status::TEXT) END
  FROM scoped s
  JOIN counts cn ON cn.cid = s.id
  ORDER BY s.updated_at DESC
  LIMIT v_limit;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_api_v1_list_cases(UUID, UUID, INT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b7_api_v1_list_cases(UUID, UUID, INT, TIMESTAMPTZ) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.p5b7_api_v1_get_case(p_case_id UUID)
RETURNS TABLE (
  case_id UUID, case_reference TEXT, case_status TEXT, case_stage TEXT,
  case_created_at TIMESTAMPTZ, case_updated_at TIMESTAMPTZ,
  as_of TIMESTAMPTZ, is_stale BOOLEAN,
  org_id UUID, org_reference TEXT,
  counterparty_reference TEXT, counterparty_jurisdiction TEXT,
  evidence_summary_status TEXT, evidence_items_count INT, evidence_outstanding_count INT,
  finality_status TEXT, finality_is_blocked BOOLEAN, memory_linkage_status TEXT,
  open_exceptions_count INT, open_blockers_count INT, funder_access_status TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT r.* FROM public.p5b7_api_v1_list_cases(NULL, NULL, 200, NULL) r
     WHERE r.case_id = p_case_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_api_v1_get_case(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b7_api_v1_get_case(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.p5b7_api_v1_list_provider_status()
RETURNS TABLE (
  provider_code TEXT, provider_label TEXT, external_status TEXT,
  as_of TIMESTAMPTZ, is_stale BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_scope JSONB := public.p5b7_api_v1_resolve_scope();
BEGIN
  IF NOT coalesce((v_scope->>'is_admin')::BOOLEAN, FALSE) THEN RETURN; END IF;
  RETURN QUERY
    SELECT
      pd.provider_id,
      pd.provider_label,
      CASE WHEN pd.health_status IN ('healthy','degraded','outage','unknown')
           THEN pd.health_status ELSE 'unknown' END,
      pd.last_checked_at,
      (pd.last_checked_at IS NULL
        OR EXTRACT(EPOCH FROM (now() - pd.last_checked_at)) >= 900)
    FROM public.p5b7_provider_dependencies pd
    ORDER BY pd.provider_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_api_v1_list_provider_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b7_api_v1_list_provider_status() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.p5b7_api_v1_list_visible_fields()
RETURNS TABLE (field_name TEXT, api_version TEXT, is_visible BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT field_name, api_version, is_visible
    FROM public.p5b7_api_field_visibility
   WHERE api_version = 'v1' AND is_visible = TRUE AND is_forbidden = FALSE
   ORDER BY field_name;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b7_api_v1_list_visible_fields() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b7_api_v1_list_visible_fields() TO authenticated, service_role;