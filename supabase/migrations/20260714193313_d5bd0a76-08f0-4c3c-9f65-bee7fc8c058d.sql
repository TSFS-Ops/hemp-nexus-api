
-- =====================================================================
-- Phase 1A hardening (validation & hardening pass)
-- Locks down helper execution, revokes direct table SELECT, tightens
-- safe_context filter, enforces single active priority-rules version.
-- No new business functionality. No Phase 1B additions.
-- =====================================================================

-- ---------- 1. Revoke authenticated EXECUTE on internal helpers -------
REVOKE ALL ON FUNCTION public._support_record_access(uuid, uuid, text, text)             FROM PUBLIC;
REVOKE ALL ON FUNCTION public._support_record_access(uuid, uuid, text, text)             FROM authenticated;
REVOKE ALL ON FUNCTION public._support_next_ticket_number()                              FROM PUBLIC;
REVOKE ALL ON FUNCTION public._support_next_ticket_number()                              FROM authenticated;
REVOKE ALL ON FUNCTION public._support_resolve_restriction(text, text)                   FROM PUBLIC;
REVOKE ALL ON FUNCTION public._support_resolve_restriction(text, text)                   FROM authenticated;
REVOKE ALL ON FUNCTION public._support_calculate_priority(text, public.support_restriction_class, public.support_customer_impact, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._support_calculate_priority(text, public.support_restriction_class, public.support_customer_impact, int) FROM authenticated;
REVOKE ALL ON FUNCTION public._support_caller_org_id()                                   FROM PUBLIC;
REVOKE ALL ON FUNCTION public._support_caller_org_id()                                   FROM authenticated;

-- has_support_capability is a read-only membership check; keep PUBLIC revoke,
-- keep authenticated (self-inspection is safe; grants table is not exposed).
REVOKE ALL ON FUNCTION public.has_support_capability(uuid, public.support_capability) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_support_capability(uuid, public.support_capability) TO authenticated;

-- ---------- 2. Revoke direct SELECT on core tables --------------------
-- Reads must go through the customer-safe / internal SECURITY DEFINER RPCs.
REVOKE SELECT ON public.support_tickets                 FROM authenticated;
REVOKE SELECT ON public.support_ticket_events           FROM authenticated;
REVOKE SELECT ON public.support_ticket_messages         FROM authenticated;
REVOKE SELECT ON public.support_ticket_linked_records   FROM authenticated;
-- support_ticket_access_audit already had no authenticated grant.

-- Drop the now-unused parent-existence policies (grants alone deny access
-- but keeping obsolete policies invites confusion). RLS remains enabled.
DROP POLICY IF EXISTS support_tickets_creator_read                        ON public.support_tickets;
DROP POLICY IF EXISTS support_tickets_org_admin_read_nonrestricted        ON public.support_tickets;
DROP POLICY IF EXISTS support_tickets_platform_admin_read                 ON public.support_tickets;
DROP POLICY IF EXISTS support_tickets_auditor_read                        ON public.support_tickets;
DROP POLICY IF EXISTS support_ticket_events_read_via_ticket               ON public.support_ticket_events;
DROP POLICY IF EXISTS support_ticket_messages_customer_visible_read       ON public.support_ticket_messages;
DROP POLICY IF EXISTS support_ticket_messages_internal_note_read          ON public.support_ticket_messages;
DROP POLICY IF EXISTS support_ticket_linked_records_read                  ON public.support_ticket_linked_records;

-- ---------- 3. Rebuild create_support_ticket with broader safe_context
--             reject list and stricter validation.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.create_support_ticket(
  _category_key text,
  _subcategory_key text,
  _customer_impact public.support_customer_impact,
  _subject text,
  _intended_action text DEFAULT NULL,
  _actual_result text DEFAULT NULL,
  _occurred_at timestamptz DEFAULT NULL,
  _affected_users_count int DEFAULT NULL,
  _workaround_available boolean DEFAULT NULL,
  _safe_context jsonb DEFAULT '{}'::jsonb,
  _contact_name text DEFAULT NULL,
  _contact_email text DEFAULT NULL,
  _on_behalf_of_user_id uuid DEFAULT NULL,
  _on_behalf_of_reason text DEFAULT NULL
) RETURNS TABLE (id uuid, ticket_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_ticket_id uuid;
  v_number text;
  v_restr record;
  v_prio record;
  v_key text;
  v_forbidden text[] := ARRAY[
    'password','passwd','secret','token','api_key','apikey','api-key',
    'authorization','auth','cookie','session',
    'webhook_secret','webhook-secret','signing_secret','signing_key',
    'key_hash','private_key','client_secret',
    'document','documents','compliance','compliance_payload',
    'payment_payload','card','cvv','pan','iban'
  ];
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'support: authentication required' USING ERRCODE = '28000';
  END IF;
  IF _subject IS NULL OR length(btrim(_subject)) = 0 THEN
    RAISE EXCEPTION 'support: subject required';
  END IF;
  IF length(_subject) > 300 THEN
    RAISE EXCEPTION 'support: subject too long';
  END IF;
  IF _affected_users_count IS NOT NULL AND _affected_users_count < 0 THEN
    RAISE EXCEPTION 'support: affected_users_count must be >= 0';
  END IF;
  IF _affected_users_count IS NOT NULL AND _affected_users_count > 10000000 THEN
    RAISE EXCEPTION 'support: affected_users_count out of range';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.support_categories WHERE key = _category_key AND is_active) THEN
    RAISE EXCEPTION 'support: invalid category %', _category_key;
  END IF;
  IF _subcategory_key IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.support_subcategories
    WHERE key = _subcategory_key AND category_key = _category_key AND is_active
  ) THEN
    RAISE EXCEPTION 'support: invalid subcategory % for category %', _subcategory_key, _category_key;
  END IF;

  IF (_on_behalf_of_user_id IS NULL) <> (_on_behalf_of_reason IS NULL) THEN
    RAISE EXCEPTION 'support: on_behalf_of user and reason must both be provided';
  END IF;
  IF _on_behalf_of_user_id IS NOT NULL
     AND NOT public.has_role(v_actor, 'platform_admin'::app_role) THEN
    RAISE EXCEPTION 'support: on-behalf-of creation requires platform administrator authority';
  END IF;

  IF _on_behalf_of_user_id IS NOT NULL THEN
    SELECT org_id INTO v_org FROM public.profiles WHERE id = _on_behalf_of_user_id;
  ELSE
    SELECT org_id INTO v_org FROM public.profiles WHERE id = v_actor;
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'support: caller has no organisation profile';
  END IF;

  -- Broadened forbidden-key filter (case-insensitive)
  IF _safe_context IS NOT NULL THEN
    FOR v_key IN SELECT jsonb_object_keys(_safe_context) LOOP
      IF lower(v_key) = ANY (v_forbidden) THEN
        RAISE EXCEPTION 'support: safe_context contains forbidden key %', v_key;
      END IF;
    END LOOP;
  END IF;

  v_restr := public._support_resolve_restriction(_category_key, _subcategory_key);
  v_prio  := public._support_calculate_priority(_category_key, v_restr.restriction_class,
                                                _customer_impact, _affected_users_count);
  v_number := public._support_next_ticket_number();

  INSERT INTO public.support_tickets(
    ticket_number, source, org_id, created_by,
    on_behalf_of_user_id, on_behalf_of_reason,
    category_key, subcategory_key,
    is_restricted, restriction_class,
    customer_impact, priority, priority_source, priority_rules_version,
    status, subject, intended_action, actual_result, occurred_at,
    affected_users_count, workaround_available, safe_context,
    contact_name, contact_email
  ) VALUES (
    v_number,
    CASE WHEN _on_behalf_of_user_id IS NOT NULL THEN 'on_behalf_of' ELSE 'portal' END,
    v_org, v_actor,
    _on_behalf_of_user_id, _on_behalf_of_reason,
    _category_key, _subcategory_key,
    v_restr.is_restricted, v_restr.restriction_class,
    _customer_impact, v_prio.priority, v_prio.source, v_prio.version,
    'new', btrim(_subject), _intended_action, _actual_result, _occurred_at,
    _affected_users_count, _workaround_available, COALESCE(_safe_context,'{}'::jsonb),
    _contact_name, _contact_email
  ) RETURNING support_tickets.id INTO v_ticket_id;

  INSERT INTO public.support_ticket_events(ticket_id, event_kind, actor_user_id, represented_user_id, payload)
  VALUES (v_ticket_id, 'ticket_created', v_actor, _on_behalf_of_user_id,
    jsonb_build_object('source', CASE WHEN _on_behalf_of_user_id IS NOT NULL THEN 'on_behalf_of' ELSE 'portal' END,
                       'category', _category_key, 'subcategory', _subcategory_key));

  INSERT INTO public.support_ticket_events(ticket_id, event_kind, actor_user_id, payload)
  VALUES (v_ticket_id, 'priority_calculated', v_actor,
    jsonb_build_object('priority', v_prio.priority, 'source', v_prio.source,
                       'rules_version', v_prio.version, 'impact', _customer_impact,
                       'affected_users_count', _affected_users_count,
                       'restriction_class', v_restr.restriction_class));

  id := v_ticket_id; ticket_number := v_number; RETURN NEXT;
END;
$$;
-- Preserve the intended EXECUTE grants
REVOKE ALL ON FUNCTION public.create_support_ticket(text,text,public.support_customer_impact,text,text,text,timestamptz,int,boolean,jsonb,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(text,text,public.support_customer_impact,text,text,text,timestamptz,int,boolean,jsonb,text,text,uuid,text) TO authenticated;

-- ---------- 4. Enforce single active priority-rules version -----------
CREATE UNIQUE INDEX IF NOT EXISTS support_priority_rules_one_active_idx
  ON public.support_priority_rules ((true)) WHERE is_active;

-- ---------- 5. Comment for auditors -----------------------------------
COMMENT ON TABLE public.support_tickets IS
  'Phase 1A support ticket store. Direct SELECT is intentionally NOT granted to authenticated; use SECURITY DEFINER RPCs (list_own_support_tickets, list_org_support_tickets, get_support_ticket, get_support_ticket_internal).';
COMMENT ON TABLE public.support_ticket_access_audit IS
  'Append-only. No authenticated grants. Only writable via _support_record_access, which is executable only by owner/service_role.';
