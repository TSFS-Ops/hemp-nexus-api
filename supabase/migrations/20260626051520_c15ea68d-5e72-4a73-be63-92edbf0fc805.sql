
-- =========================================================================
-- P-5 Batch 6 — Phase 4: API-safe projection / read layer
-- =========================================================================
-- Read-only SECURITY DEFINER projections over Phase 2 tables.
-- No schema changes, no write paths, no enum widening, no UI, no edge fns.
-- Reuses Phase 1 SSOT external-safe field rules.
-- =========================================================================

-- ---- Internal helpers --------------------------------------------------

-- Role classification used by all Phase 4 projections.
-- Returns one of: 'admin', 'governance', 'compliance',
-- 'tenant', 'funder', 'none'.
CREATE OR REPLACE FUNCTION public.p5b6_actor_scope()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RETURN 'none';
  END IF;

  IF public.has_role(uid, 'platform_admin'::app_role) THEN
    RETURN 'admin';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = uid AND role::text = 'governance_reviewer'
  ) THEN
    RETURN 'governance';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = uid AND role::text = 'compliance_analyst'
  ) THEN
    RETURN 'compliance';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.p5_batch3_funder_users
    WHERE user_id = uid
  ) THEN
    RETURN 'funder';
  END IF;

  RETURN 'tenant';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.p5b6_actor_scope() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b6_actor_scope() TO authenticated;

-- Predicate: can the current actor see this exception row?
CREATE OR REPLACE FUNCTION public.p5b6_can_view_exception(
  _exception public.p5b6_exceptions
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  scope text := public.p5b6_actor_scope();
  uid uuid := auth.uid();
  actor_org uuid;
BEGIN
  IF scope IN ('admin','governance','compliance') THEN
    RETURN true;
  END IF;

  IF scope = 'tenant' THEN
    SELECT org_id INTO actor_org FROM public.profiles WHERE id = uid;
    RETURN actor_org IS NOT NULL AND _exception.org_id = actor_org;
  END IF;

  IF scope = 'funder' THEN
    -- Funder visibility limited to funder-relevant queues/types only.
    RETURN _exception.queue = 'funder_escalation'
        OR _exception.exception_type = 'FUNDER_REVIEW_EXCEPTION';
  END IF;

  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.p5b6_can_view_exception(public.p5b6_exceptions) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b6_can_view_exception(public.p5b6_exceptions) TO authenticated;

-- ---- Exception list projection ----------------------------------------
-- Allowlisted fields only: id, exception_type, queue, priority, status,
-- summary (external-safe), org_id (visible only to admin/governance/
-- compliance), created_at, updated_at, resolved_at, assigned_to_role.
-- FORBIDDEN: metadata, before_snapshot, after_snapshot, internal_reason,
-- raw dispute internals, report export scope internals.

CREATE OR REPLACE FUNCTION public.p5b6_list_exceptions_safe(
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0,
  _queue text DEFAULT NULL,
  _status text DEFAULT NULL,
  _priority text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  exception_type text,
  queue text,
  priority text,
  status text,
  external_safe_summary text,
  org_id uuid,
  assigned_to_role text,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  scope text := public.p5b6_actor_scope();
BEGIN
  IF scope = 'none' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.exception_type,
    e.queue,
    e.priority,
    e.status,
    -- External-safe summary: short type-level label, never raw reason.
    ('Exception ' || e.exception_type || ' — ' || e.status)::text
      AS external_safe_summary,
    CASE WHEN scope IN ('admin','governance','compliance')
         THEN e.org_id ELSE NULL END AS org_id,
    e.assigned_to_role,
    e.created_at,
    e.updated_at,
    e.resolved_at
  FROM public.p5b6_exceptions e
  WHERE public.p5b6_can_view_exception(e)
    AND (_queue    IS NULL OR e.queue    = _queue)
    AND (_status   IS NULL OR e.status   = _status)
    AND (_priority IS NULL OR e.priority = _priority)
  ORDER BY
    CASE e.priority
      WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2
      WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 ELSE 5 END,
    e.created_at DESC
  LIMIT GREATEST(0, LEAST(_limit, 200))
  OFFSET GREATEST(0, _offset);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.p5b6_list_exceptions_safe(integer,integer,text,text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.p5b6_list_exceptions_safe(integer,integer,text,text,text) TO authenticated;

-- ---- Exception detail projection --------------------------------------
CREATE OR REPLACE FUNCTION public.p5b6_get_exception_safe(_id uuid)
RETURNS TABLE (
  id uuid,
  exception_type text,
  queue text,
  priority text,
  status text,
  external_safe_summary text,
  org_id uuid,
  assigned_to_role text,
  linked_memory_ref uuid,
  linked_finality_ref uuid,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.p5b6_exceptions;
  scope text := public.p5b6_actor_scope();
BEGIN
  IF scope = 'none' THEN RETURN; END IF;

  SELECT * INTO e FROM public.p5b6_exceptions WHERE p5b6_exceptions.id = _id;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT public.p5b6_can_view_exception(e) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.exception_type,
    e.queue,
    e.priority,
    e.status,
    ('Exception ' || e.exception_type || ' — ' || e.status)::text,
    CASE WHEN scope IN ('admin','governance','compliance')
         THEN e.org_id ELSE NULL END,
    e.assigned_to_role,
    -- Memory/finality references are linked-only (FK uuid), not mutated.
    e.linked_memory_ref,
    e.linked_finality_ref,
    e.created_at,
    e.updated_at,
    e.resolved_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.p5b6_get_exception_safe(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.p5b6_get_exception_safe(uuid) TO authenticated;

-- ---- Queue summary projection -----------------------------------------
-- Counts per queue / priority / status, scoped by visibility.
CREATE OR REPLACE FUNCTION public.p5b6_get_queue_summary_safe()
RETURNS TABLE (
  queue text,
  priority text,
  status text,
  open_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.p5b6_actor_scope() = 'none' THEN RETURN; END IF;

  RETURN QUERY
  SELECT e.queue, e.priority, e.status, COUNT(*)::bigint
  FROM public.p5b6_exceptions e
  WHERE public.p5b6_can_view_exception(e)
  GROUP BY e.queue, e.priority, e.status
  ORDER BY e.queue, e.priority, e.status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.p5b6_get_queue_summary_safe() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.p5b6_get_queue_summary_safe() TO authenticated;

-- ---- Dispute-safe projection ------------------------------------------
-- Exposes dispute state + pauses_memory flag. Excludes raw internal
-- reason text, internal correspondence, evidence references.
CREATE OR REPLACE FUNCTION public.p5b6_get_dispute_safe(_exception_id uuid)
RETURNS TABLE (
  id uuid,
  exception_id uuid,
  dispute_state text,
  pauses_memory boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.p5b6_exceptions;
BEGIN
  SELECT * INTO e FROM public.p5b6_exceptions WHERE p5b6_exceptions.id = _exception_id;
  IF NOT FOUND OR NOT public.p5b6_can_view_exception(e) THEN RETURN; END IF;

  RETURN QUERY
  SELECT d.id, d.exception_id, d.dispute_state, d.pauses_memory,
         d.created_at, d.updated_at
  FROM public.p5b6_exception_disputes d
  WHERE d.exception_id = _exception_id
  ORDER BY d.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.p5b6_get_dispute_safe(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.p5b6_get_dispute_safe(uuid) TO authenticated;

-- ---- Timeline projection (notes + audit, sensitive fields excluded) ---
-- Notes: only note_type and external-safe author_role exposed. body is
-- only exposed for admin/governance/compliance scopes.
-- Audit: only event_name + occurred_at + actor_role exposed. metadata,
-- before_snapshot, after_snapshot are NEVER exposed.
CREATE OR REPLACE FUNCTION public.p5b6_get_timeline_safe(_exception_id uuid)
RETURNS TABLE (
  kind text,
  event_at timestamptz,
  event_code text,
  actor_role text,
  body_visible text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.p5b6_exceptions;
  scope text := public.p5b6_actor_scope();
  internal_view boolean;
BEGIN
  SELECT * INTO e FROM public.p5b6_exceptions WHERE p5b6_exceptions.id = _exception_id;
  IF NOT FOUND OR NOT public.p5b6_can_view_exception(e) THEN RETURN; END IF;

  internal_view := scope IN ('admin','governance','compliance');

  RETURN QUERY
  SELECT 'note'::text,
         n.created_at,
         n.note_type,
         n.author_role,
         CASE WHEN internal_view THEN n.body ELSE NULL END
  FROM public.p5b6_exception_notes n
  WHERE n.exception_id = _exception_id

  UNION ALL

  SELECT 'audit'::text,
         a.occurred_at,
         a.event_name,
         a.actor_role,
         NULL::text  -- audit metadata/snapshots are never projected
  FROM public.p5b6_exception_audit_events a
  WHERE a.exception_id = _exception_id

  ORDER BY 2 ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.p5b6_get_timeline_safe(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.p5b6_get_timeline_safe(uuid) TO authenticated;

-- ---- Report export summary projection ---------------------------------
-- Intent/metadata only. scope_payload internals are NEVER exposed.
CREATE OR REPLACE FUNCTION public.p5b6_list_report_exports_safe(
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  report_code text,
  requested_by_role text,
  status text,
  requested_at timestamptz,
  completed_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  scope text := public.p5b6_actor_scope();
BEGIN
  -- Report exports are governance-only metadata; tenants/funders blocked.
  IF scope NOT IN ('admin','governance','compliance') THEN RETURN; END IF;

  RETURN QUERY
  SELECT r.id, r.report_code, r.requested_by_role, r.status,
         r.requested_at, r.completed_at
  FROM public.p5b6_exception_report_exports r
  ORDER BY r.requested_at DESC
  LIMIT GREATEST(0, LEAST(_limit, 200))
  OFFSET GREATEST(0, _offset);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.p5b6_list_report_exports_safe(integer,integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.p5b6_list_report_exports_safe(integer,integer) TO authenticated;

-- =========================================================================
-- END Phase 4
-- =========================================================================
