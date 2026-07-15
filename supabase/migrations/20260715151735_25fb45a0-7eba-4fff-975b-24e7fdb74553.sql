
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS sla_first_response_escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_resolution_escalated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_st_sla_fr_esc
  ON public.support_tickets(sla_first_response_due_at)
  WHERE sla_first_response_escalated_at IS NULL AND first_response_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_st_sla_res_esc
  ON public.support_tickets(sla_resolution_due_at)
  WHERE sla_resolution_escalated_at IS NULL AND resolved_at IS NULL;

CREATE OR REPLACE FUNCTION public._support_next_priority(p public.support_ticket_priority)
RETURNS public.support_ticket_priority
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p
    WHEN 'low' THEN 'medium'::public.support_ticket_priority
    WHEN 'medium' THEN 'high'::public.support_ticket_priority
    WHEN 'high' THEN 'urgent'::public.support_ticket_priority
    ELSE 'urgent'::public.support_ticket_priority
  END
$$;

CREATE OR REPLACE FUNCTION public.escalate_overdue_support_tickets()
RETURNS TABLE (ticket_id uuid, gate text, from_priority public.support_ticket_priority, to_priority public.support_ticket_priority)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_new public.support_ticket_priority;
BEGIN
  -- First-response SLA breaches
  FOR r IN
    SELECT id, priority
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
          'reason','sla_auto_escalation'
        ));
    ticket_id := r.id; gate := 'first_response';
    from_priority := r.priority; to_priority := v_new;
    RETURN NEXT;
  END LOOP;

  -- Resolution SLA breaches
  FOR r IN
    SELECT id, priority
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
          'reason','sla_auto_escalation'
        ));
    ticket_id := r.id; gate := 'resolution';
    from_priority := r.priority; to_priority := v_new;
    RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.escalate_overdue_support_tickets() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.escalate_overdue_support_tickets() TO service_role;
