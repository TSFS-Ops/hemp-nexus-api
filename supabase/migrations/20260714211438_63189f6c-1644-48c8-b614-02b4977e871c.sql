-- Phase 1A corrective migration — Linked-record kind hardening.
-- add_support_ticket_linked_record validates ticket access but NOT
-- source-record access, and safe_label is client-supplied. Until
-- Phase 1B adds per-kind ACLs and server-derived labels, restrict
-- Phase 1A to the generic inert 'other' reference kind. Sensitive
-- kinds (match/poi/wad/document/payment/funder_grant/api_client/
-- organisation) raise 42501 with a diagnostic naming the kind.

CREATE OR REPLACE FUNCTION public.add_support_ticket_linked_record(
  _ticket_id uuid,
  _record_kind public.support_linked_record_kind,
  _source_id text,
  _safe_label text,
  _visibility text DEFAULT 'internal'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ticket public.support_tickets%ROWTYPE;
  v_link_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'support: authentication required' USING ERRCODE='28000';
  END IF;

  -- Phase 1A: only the generic inert reference kind is permitted.
  IF _record_kind <> 'other'::public.support_linked_record_kind THEN
    RAISE EXCEPTION
      'support: linked-record kind % is not permitted in Phase 1A (only ''other'' is enabled)',
      _record_kind
      USING ERRCODE='42501';
  END IF;

  IF _visibility NOT IN ('customer_visible','internal') THEN
    RAISE EXCEPTION 'support: invalid visibility %', _visibility;
  END IF;
  IF _source_id IS NULL OR length(btrim(_source_id)) = 0 THEN
    RAISE EXCEPTION 'support: source_id required';
  END IF;
  IF _safe_label IS NULL OR length(btrim(_safe_label)) = 0 THEN
    RAISE EXCEPTION 'support: safe_label required';
  END IF;
  IF length(_safe_label) > 200 THEN
    RAISE EXCEPTION 'support: safe_label too long';
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = _ticket_id;
  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'support: ticket not found' USING ERRCODE='42704';
  END IF;

  IF NOT (
    v_ticket.created_by = v_actor
    OR public.has_role(v_actor, 'platform_admin'::app_role)
    OR (v_ticket.is_restricted = false AND public.is_org_admin(v_actor, v_ticket.org_id))
  ) THEN
    RAISE EXCEPTION 'support: not authorised for this ticket' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.support_ticket_linked_records(
    ticket_id, record_kind, source_id, safe_label, visibility, linked_by, permission_checked_at
  ) VALUES (_ticket_id, _record_kind, _source_id, btrim(_safe_label), _visibility, v_actor, now())
  RETURNING id INTO v_link_id;

  INSERT INTO public.support_ticket_events(ticket_id, event_kind, actor_user_id, payload)
  VALUES (_ticket_id, 'linked_record_added', v_actor,
    jsonb_build_object('link_id', v_link_id, 'record_kind', _record_kind, 'visibility', _visibility));

  RETURN v_link_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_support_ticket_linked_record(uuid,public.support_linked_record_kind,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_support_ticket_linked_record(uuid,public.support_linked_record_kind,text,text,text) TO authenticated;