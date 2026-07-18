-- Drop existing signatures so we can change RETURN type.
DROP FUNCTION IF EXISTS public.list_own_support_tickets();
DROP FUNCTION IF EXISTS public.list_org_support_tickets();
DROP FUNCTION IF EXISTS public.list_support_ticket_customer_messages(uuid);
DROP FUNCTION IF EXISTS public.list_support_ticket_internal_notes(uuid);
DROP FUNCTION IF EXISTS public.get_support_ticket_internal(uuid, text);

-- Customer-safe ticket projection (own tickets).
CREATE FUNCTION public.list_own_support_tickets()
RETURNS TABLE (
  id uuid,
  ticket_number text,
  org_id uuid,
  status public.support_ticket_status,
  priority public.support_ticket_priority,
  category_key text,
  subcategory_key text,
  customer_impact public.support_customer_impact,
  is_restricted boolean,
  subject text,
  intended_action text,
  actual_result text,
  occurred_at timestamptz,
  affected_users_count int,
  workaround_available boolean,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    t.id, t.ticket_number, t.org_id, t.status, t.priority,
    t.category_key, t.subcategory_key, t.customer_impact,
    t.is_restricted, t.subject, t.intended_action, t.actual_result,
    t.occurred_at, t.affected_users_count, t.workaround_available,
    t.resolved_at, t.closed_at, t.created_at, t.updated_at
  FROM public.support_tickets t
  WHERE t.created_by = auth.uid()
  ORDER BY t.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.list_own_support_tickets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_own_support_tickets() TO authenticated;

-- Customer-safe ticket projection (org-admin, non-restricted only).
CREATE FUNCTION public.list_org_support_tickets()
RETURNS TABLE (
  id uuid,
  ticket_number text,
  org_id uuid,
  status public.support_ticket_status,
  priority public.support_ticket_priority,
  category_key text,
  subcategory_key text,
  customer_impact public.support_customer_impact,
  is_restricted boolean,
  subject text,
  intended_action text,
  actual_result text,
  occurred_at timestamptz,
  affected_users_count int,
  workaround_available boolean,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    t.id, t.ticket_number, t.org_id, t.status, t.priority,
    t.category_key, t.subcategory_key, t.customer_impact,
    t.is_restricted, t.subject, t.intended_action, t.actual_result,
    t.occurred_at, t.affected_users_count, t.workaround_available,
    t.resolved_at, t.closed_at, t.created_at, t.updated_at
  FROM public.support_tickets t
  WHERE public.is_org_admin(auth.uid(), t.org_id)
    AND t.is_restricted = false
  ORDER BY t.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.list_org_support_tickets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_org_support_tickets() TO authenticated;

-- Customer-visible message projection: no author identity leak.
CREATE FUNCTION public.list_support_ticket_customer_messages(_ticket_id uuid)
RETURNS TABLE (
  id uuid,
  ticket_id uuid,
  body text,
  author_is_self boolean,
  created_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    m.id, m.ticket_id, m.body,
    (m.author_user_id = auth.uid()) AS author_is_self,
    m.created_at
  FROM public.support_ticket_messages m
  JOIN public.support_tickets t ON t.id = m.ticket_id
  WHERE m.ticket_id = _ticket_id
    AND m.kind = 'customer_visible'
    AND (
      t.created_by = auth.uid()
      OR public.has_role(auth.uid(), 'platform_admin'::app_role)
      OR public.has_role(auth.uid(), 'auditor_read_only'::app_role)
      OR (t.is_restricted = false AND public.is_org_admin(auth.uid(), t.org_id))
    )
  ORDER BY m.created_at ASC;
$$;
REVOKE ALL ON FUNCTION public.list_support_ticket_customer_messages(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_support_ticket_customer_messages(uuid) TO authenticated;

-- Internal notes projection: platform_admin / auditor only, explicit columns.
CREATE FUNCTION public.list_support_ticket_internal_notes(_ticket_id uuid)
RETURNS TABLE (
  id uuid,
  ticket_id uuid,
  author_user_id uuid,
  body text,
  created_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.ticket_id, m.author_user_id, m.body, m.created_at
  FROM public.support_ticket_messages m
  WHERE m.ticket_id = _ticket_id
    AND m.kind = 'internal_note'
    AND (
      public.has_role(auth.uid(), 'platform_admin'::app_role)
      OR public.has_role(auth.uid(), 'auditor_read_only'::app_role)
    )
  ORDER BY m.created_at ASC;
$$;
REVOKE ALL ON FUNCTION public.list_support_ticket_internal_notes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_support_ticket_internal_notes(uuid) TO authenticated;

-- Internal full ticket getter — explicit column list.
CREATE FUNCTION public.get_support_ticket_internal(_ticket_id uuid, _reason text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  ticket_number text,
  source public.support_ticket_source,
  org_id uuid,
  funder_org_id uuid,
  created_by uuid,
  on_behalf_of_user_id uuid,
  on_behalf_of_reason text,
  category_key text,
  subcategory_key text,
  is_restricted boolean,
  restriction_class public.support_restriction_class,
  customer_impact public.support_customer_impact,
  priority public.support_ticket_priority,
  priority_source public.support_priority_source,
  priority_rules_version int,
  status public.support_ticket_status,
  subject text,
  intended_action text,
  actual_result text,
  occurred_at timestamptz,
  affected_users_count int,
  workaround_available boolean,
  safe_context jsonb,
  contact_name text,
  contact_email text,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := auth.uid(); v_ticket public.support_tickets%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RETURN; END IF;
  IF NOT (
    public.has_role(v_actor, 'platform_admin'::app_role)
    OR public.has_role(v_actor, 'auditor_read_only'::app_role)
  ) THEN RETURN; END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE support_tickets.id = _ticket_id;
  IF v_ticket.id IS NULL THEN RETURN; END IF;

  IF v_ticket.is_restricted THEN
    PERFORM public._support_record_access(v_ticket.id, v_actor, 'internal_view_restricted', _reason);
  END IF;

  id := v_ticket.id; ticket_number := v_ticket.ticket_number; source := v_ticket.source;
  org_id := v_ticket.org_id; funder_org_id := v_ticket.funder_org_id;
  created_by := v_ticket.created_by; on_behalf_of_user_id := v_ticket.on_behalf_of_user_id;
  on_behalf_of_reason := v_ticket.on_behalf_of_reason;
  category_key := v_ticket.category_key; subcategory_key := v_ticket.subcategory_key;
  is_restricted := v_ticket.is_restricted; restriction_class := v_ticket.restriction_class;
  customer_impact := v_ticket.customer_impact; priority := v_ticket.priority;
  priority_source := v_ticket.priority_source; priority_rules_version := v_ticket.priority_rules_version;
  status := v_ticket.status; subject := v_ticket.subject;
  intended_action := v_ticket.intended_action; actual_result := v_ticket.actual_result;
  occurred_at := v_ticket.occurred_at; affected_users_count := v_ticket.affected_users_count;
  workaround_available := v_ticket.workaround_available; safe_context := v_ticket.safe_context;
  contact_name := v_ticket.contact_name; contact_email := v_ticket.contact_email;
  resolved_at := v_ticket.resolved_at; closed_at := v_ticket.closed_at;
  created_at := v_ticket.created_at; updated_at := v_ticket.updated_at;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.get_support_ticket_internal(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_support_ticket_internal(uuid,text) TO authenticated;

-- Developer/test helper: exposes the RETURN TABLE shape of a support RPC.
-- Regression guard for tests. Not granted to authenticated.
CREATE OR REPLACE FUNCTION public._support_rpc_result_signature(_fn text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pg_get_function_result(pr.oid)
    FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
   WHERE n.nspname = 'public' AND pr.proname = _fn
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._support_rpc_result_signature(text) FROM PUBLIC;

COMMENT ON FUNCTION public.list_own_support_tickets() IS
  'Phase 1A customer-safe projection. Do NOT change to SETOF support_tickets.';
COMMENT ON FUNCTION public.list_org_support_tickets() IS
  'Phase 1A customer-safe projection. Do NOT change to SETOF support_tickets.';
COMMENT ON FUNCTION public.list_support_ticket_customer_messages(uuid) IS
  'Phase 1A customer-visible message projection (no author identity).';
COMMENT ON FUNCTION public.list_support_ticket_internal_notes(uuid) IS
  'Phase 1A internal notes projection — explicit columns; platform_admin/auditor only.';
COMMENT ON FUNCTION public.get_support_ticket_internal(uuid,text) IS
  'Phase 1A internal-full projection — explicit columns; auto-widening prohibited.';