
-- 1) Enrich the auto_escalated payload with the SLA due timestamp that triggered the bump
CREATE OR REPLACE FUNCTION public.escalate_overdue_support_tickets()
RETURNS TABLE (ticket_id uuid, gate text, from_priority public.support_ticket_priority, to_priority public.support_ticket_priority)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_new public.support_ticket_priority;
BEGIN
  FOR r IN
    SELECT id, priority, sla_first_response_due_at
    FROM public.support_tickets
    WHERE status NOT IN ('resolved','closed','cancelled','confirmation_requested')
      AND first_response_at IS NULL
      AND sla_first_response_escalated_at IS NULL
      AND sla_first_response_due_at IS NOT NULL
      AND sla_first_response_due_at < now()
    ORDER BY sla_first_response_due_at
    LIMIT 200
  LOOP
    v_new := public._support_next_priority(r.priority);
    UPDATE public.support_tickets
      SET priority = v_new,
          priority_source = 'override',
          sla_first_response_escalated_at = now(),
          updated_at = now()
      WHERE id = r.id;
    INSERT INTO public.support_ticket_events(ticket_id, event_kind, actor_user_id, payload)
      VALUES (r.id, 'auto_escalated', NULL,
        jsonb_build_object(
          'gate','first_response',
          'from_priority', r.priority,
          'to_priority', v_new,
          'reason','sla_auto_escalation',
          'sla_due_at', r.sla_first_response_due_at,
          'escalated_at', now()
        ));
    ticket_id := r.id; gate := 'first_response';
    from_priority := r.priority; to_priority := v_new;
    RETURN NEXT;
  END LOOP;

  FOR r IN
    SELECT id, priority, sla_resolution_due_at
    FROM public.support_tickets
    WHERE status NOT IN ('resolved','closed','cancelled')
      AND resolved_at IS NULL
      AND sla_resolution_escalated_at IS NULL
      AND sla_resolution_due_at IS NOT NULL
      AND sla_resolution_due_at < now()
    ORDER BY sla_resolution_due_at
    LIMIT 200
  LOOP
    v_new := public._support_next_priority(r.priority);
    UPDATE public.support_tickets
      SET priority = v_new,
          priority_source = 'override',
          sla_resolution_escalated_at = now(),
          updated_at = now()
      WHERE id = r.id;
    INSERT INTO public.support_ticket_events(ticket_id, event_kind, actor_user_id, payload)
      VALUES (r.id, 'auto_escalated', NULL,
        jsonb_build_object(
          'gate','resolution',
          'from_priority', r.priority,
          'to_priority', v_new,
          'reason','sla_auto_escalation',
          'sla_due_at', r.sla_resolution_due_at,
          'escalated_at', now()
        ));
    ticket_id := r.id; gate := 'resolution';
    from_priority := r.priority; to_priority := v_new;
    RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.escalate_overdue_support_tickets() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.escalate_overdue_support_tickets() TO service_role;

-- 2) Internal RPC to list a ticket's event timeline for admins / support-capable users
CREATE OR REPLACE FUNCTION public.list_support_ticket_events_internal(_ticket_id uuid)
RETURNS TABLE (
  id uuid,
  ticket_id uuid,
  event_kind public.support_event_kind,
  actor_user_id uuid,
  represented_user_id uuid,
  payload jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.has_role(auth.uid(),'platform_admin')
    OR public.has_support_capability(auth.uid(),'support_read')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT e.id, e.ticket_id, e.event_kind, e.actor_user_id,
           e.represented_user_id, e.payload, e.created_at
    FROM public.support_ticket_events e
    WHERE e.ticket_id = _ticket_id
    ORDER BY e.created_at ASC, e.id ASC;
END $$;

REVOKE ALL ON FUNCTION public.list_support_ticket_events_internal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_support_ticket_events_internal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_support_ticket_events_internal(uuid) TO service_role;
COMMENT ON FUNCTION public.list_support_ticket_events_internal(uuid) IS
  'Returns the ordered event timeline for a single support ticket. Restricted to platform_admin or support_read.';
