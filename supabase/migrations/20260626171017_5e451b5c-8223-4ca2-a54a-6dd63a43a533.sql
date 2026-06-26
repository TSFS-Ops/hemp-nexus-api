
-- =========================================================================
-- P-5 Batch 8 Phase 4 — API-safe read / projection layer (additive only)
-- No new tables, no writes, no UI, no edge functions, no cron.
-- Mirrors the Phase 1 SSOT (src/lib/p5-batch8/registry.ts) API-safe fields.
-- =========================================================================

-- ---------- reader-role helper ------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b8_has_reader_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_analyst'::public.app_role)
    OR public.has_role(auth.uid(), 'api_admin'::public.app_role)
$$;
REVOKE EXECUTE ON FUNCTION public.p5b8_has_reader_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_has_reader_role() TO authenticated;

CREATE OR REPLACE FUNCTION public.p5b8_has_admin_reader_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_analyst'::public.app_role)
$$;
REVOKE EXECUTE ON FUNCTION public.p5b8_has_admin_reader_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_has_admin_reader_role() TO authenticated;

-- =========================================================================
-- 1. provider configuration summary
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_read_provider_config_summary()
RETURNS TABLE (
  provider_category text,
  live_now boolean,
  hidden_until_live boolean,
  commercial_owner text,
  technical_contact text,
  approval_owner text,
  activation_signoff_owner text,
  activation_signed_off_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.p5b8_has_reader_role() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT pc.provider_category, pc.live_now, pc.hidden_until_live,
           pc.commercial_owner, pc.technical_contact, pc.approval_owner,
           pc.activation_signoff_owner, pc.activation_signed_off_at, pc.updated_at
      FROM public.p5b8_provider_configs pc
     ORDER BY pc.provider_category;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b8_read_provider_config_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_read_provider_config_summary() TO authenticated;

-- =========================================================================
-- 2. provider dependency status summary
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_read_provider_dependency_status_summary(
  p_provider_category text DEFAULT NULL,
  p_subject_id uuid DEFAULT NULL,
  p_case_id uuid DEFAULT NULL
)
RETURNS TABLE (
  provider_category text,
  subject_id uuid,
  case_id uuid,
  provider_dependency_status text,
  provider_environment text,
  stale_as_of timestamptz,
  is_stale boolean,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.p5b8_has_reader_role() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT s.provider_category, s.subject_id, s.case_id,
           s.state AS provider_dependency_status,
           s.environment AS provider_environment,
           s.stale_as_of, s.is_stale, s.updated_at
      FROM public.p5b8_provider_dependency_status s
     WHERE (p_provider_category IS NULL OR s.provider_category = p_provider_category)
       AND (p_subject_id IS NULL OR s.subject_id = p_subject_id)
       AND (p_case_id IS NULL OR s.case_id = p_case_id)
     ORDER BY s.updated_at DESC
     LIMIT 500;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b8_read_provider_dependency_status_summary(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_read_provider_dependency_status_summary(text, uuid, uuid) TO authenticated;

-- =========================================================================
-- 3. provider request summary
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_read_provider_request_summary(
  p_provider_category text DEFAULT NULL,
  p_case_id uuid DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  request_id uuid,
  provider_category text,
  provider_environment text,
  request_reference text,
  case_id uuid,
  subject_id uuid,
  requested_at timestamptz,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.p5b8_has_admin_reader_role() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT r.id, r.provider_category, r.environment, r.request_reference,
           r.case_id, r.subject_id, r.requested_at, r.status
      FROM public.p5b8_provider_requests r
     WHERE (p_provider_category IS NULL OR r.provider_category = p_provider_category)
       AND (p_case_id IS NULL OR r.case_id = p_case_id)
     ORDER BY r.requested_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b8_read_provider_request_summary(text, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_read_provider_request_summary(text, uuid, int) TO authenticated;

-- =========================================================================
-- 4. provider result summary (raw payload excluded; no synthesised verdicts)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_read_provider_result_summary(
  p_provider_category text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  result_id uuid,
  provider_request_id uuid,
  provider_category text,
  provider_environment text,
  provider_reference text,
  result_status text,
  result_summary text,
  received_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.p5b8_has_reader_role() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT pr.id, pr.provider_request_id, pr.provider_category, pr.environment,
           pr.provider_reference, pr.result_status, pr.result_summary, pr.received_at
      FROM public.p5b8_provider_results pr
     WHERE (p_provider_category IS NULL OR pr.provider_category = p_provider_category)
       AND (p_request_id IS NULL OR pr.provider_request_id = p_request_id)
     ORDER BY pr.received_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b8_read_provider_result_summary(text, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_read_provider_result_summary(text, uuid, int) TO authenticated;

-- =========================================================================
-- 5. provider decision summary
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_read_provider_decision_summary(
  p_provider_category text DEFAULT NULL,
  p_result_id uuid DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  decision_id uuid,
  provider_result_id uuid,
  provider_category text,
  provider_decision_state text,
  is_fallback boolean,
  is_final boolean,
  reason text,
  evidence_reference text,
  set_by_role text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.p5b8_has_reader_role() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT d.id, d.provider_result_id, d.provider_category,
           d.decision_state AS provider_decision_state,
           d.is_fallback, d.is_final, d.reason, d.evidence_reference,
           d.set_by_role, d.created_at
      FROM public.p5b8_provider_decisions d
     WHERE (p_provider_category IS NULL OR d.provider_category = p_provider_category)
       AND (p_result_id IS NULL OR d.provider_result_id = p_result_id)
     ORDER BY d.created_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b8_read_provider_decision_summary(text, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_read_provider_decision_summary(text, uuid, int) TO authenticated;

-- =========================================================================
-- 6. webhook ledger summary (raw webhook payload excluded)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_read_webhook_ledger_summary(
  p_provider_category text DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  webhook_id uuid,
  provider_category text,
  webhook_event text,
  provider_environment text,
  signature_status text,
  received_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.p5b8_has_admin_reader_role() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT w.id, w.provider_category, w.webhook_event, w.environment,
           w.signature_status, w.received_at
      FROM public.p5b8_webhook_events_ledger w
     WHERE (p_provider_category IS NULL OR w.provider_category = p_provider_category)
     ORDER BY w.received_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b8_read_webhook_ledger_summary(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_read_webhook_ledger_summary(text, int) TO authenticated;

-- =========================================================================
-- 7. audit timeline summary (details JSON omitted from external surface)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_read_audit_timeline_summary(
  p_provider_category text DEFAULT NULL,
  p_case_id uuid DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  audit_id uuid,
  event_code text,
  provider_category text,
  case_id uuid,
  subject_id uuid,
  actor_role text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.p5b8_has_admin_reader_role() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT a.id, a.event_code, a.provider_category, a.case_id, a.subject_id,
           a.actor_role, a.created_at
      FROM public.p5b8_audit_events a
     WHERE (p_provider_category IS NULL OR a.provider_category = p_provider_category)
       AND (p_case_id IS NULL OR a.case_id = p_case_id)
     ORDER BY a.created_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b8_read_audit_timeline_summary(text, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_read_audit_timeline_summary(text, uuid, int) TO authenticated;

-- =========================================================================
-- 8. retry / failure / fallback summary
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_read_retry_state_summary(
  p_provider_category text DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  retry_id uuid,
  provider_request_id uuid,
  provider_category text,
  attempt_count integer,
  last_error_class text,
  fallback_status text,
  next_retry_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.p5b8_has_admin_reader_role() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT rs.id, rs.provider_request_id, req.provider_category,
           rs.attempt_count, rs.last_error_class,
           rs.fallback_route AS fallback_status,
           rs.next_retry_at, rs.updated_at
      FROM public.p5b8_provider_retry_state rs
      JOIN public.p5b8_provider_requests req ON req.id = rs.provider_request_id
     WHERE (p_provider_category IS NULL OR req.provider_category = p_provider_category)
     ORDER BY rs.updated_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b8_read_retry_state_summary(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_read_retry_state_summary(text, int) TO authenticated;

-- =========================================================================
-- 9. memory / finality link summary (reference IDs only; no Batch 5/4 mutation)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_read_memory_finality_link_summary(
  p_provider_decision_id uuid DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  link_id uuid,
  provider_decision_id uuid,
  link_type text,
  memory_record_id uuid,
  finality_record_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.p5b8_has_admin_reader_role() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT l.id, l.provider_decision_id, l.link_type,
           l.memory_record_id, l.finality_record_id, l.created_at
      FROM public.p5b8_memory_finality_links l
     WHERE (p_provider_decision_id IS NULL OR l.provider_decision_id = p_provider_decision_id)
     ORDER BY l.created_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b8_read_memory_finality_link_summary(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_read_memory_finality_link_summary(uuid, int) TO authenticated;

-- =========================================================================
-- 10. dashboard / queue summary counts
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_read_dashboard_queue_summary()
RETURNS TABLE (
  provider_category text,
  provider_dependency_status text,
  count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.p5b8_has_reader_role() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT s.provider_category, s.state AS provider_dependency_status, COUNT(*)::bigint
      FROM public.p5b8_provider_dependency_status s
     GROUP BY s.provider_category, s.state
     ORDER BY s.provider_category, s.state;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b8_read_dashboard_queue_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_read_dashboard_queue_summary() TO authenticated;
