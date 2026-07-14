
-- =====================================================================
-- Phase 1A: Enterprise Support Centre — backend foundation
-- Read-only frontend impact. api_support_tickets and its RPCs untouched.
-- =====================================================================

-- ---------- ENUMS ----------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.support_ticket_source AS ENUM (
    'portal','on_behalf_of','legacy_api_ticket','internal'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.support_ticket_status AS ENUM (
    'new','in_progress','waiting_for_customer','resolved',
    'confirmation_requested','closed','reopened','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.support_ticket_priority AS ENUM ('low','medium','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.support_customer_impact AS ENUM (
    'affects_me','affects_organisation','blocks_transaction_or_deadline'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.support_priority_source AS ENUM ('calculated','override','security_default');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.support_restriction_class AS ENUM (
    'compliance_verification','identity','security','funder_evidence','payment_dispute'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.support_message_kind AS ENUM ('customer_visible','internal_note');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.support_event_kind AS ENUM (
    'ticket_created','status_changed','priority_calculated',
    'customer_message_added','internal_note_added','linked_record_added'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.support_linked_record_kind AS ENUM (
    'match','poi','wad','document','payment','funder_grant','api_client','organisation','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.support_capability AS ENUM (
    'support_read','support_triage','support_reply_customer',
    'support_add_internal_note','support_lead','support_specialist_lead'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- CONFIG / CATALOGUE ---------------------------------------
CREATE TABLE public.support_categories (
  key text PRIMARY KEY,
  label text NOT NULL,
  is_restricted boolean NOT NULL DEFAULT false,
  restriction_class public.support_restriction_class NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.support_categories TO authenticated;
GRANT ALL ON public.support_categories TO service_role;
ALTER TABLE public.support_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_categories_read_all ON public.support_categories
  FOR SELECT TO authenticated USING (is_active = true);

CREATE TABLE public.support_subcategories (
  key text PRIMARY KEY,
  category_key text NOT NULL REFERENCES public.support_categories(key) ON DELETE RESTRICT,
  label text NOT NULL,
  is_restricted boolean NOT NULL DEFAULT false,
  restriction_class public.support_restriction_class NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_subcategories_category_idx ON public.support_subcategories(category_key);
GRANT SELECT ON public.support_subcategories TO authenticated;
GRANT ALL ON public.support_subcategories TO service_role;
ALTER TABLE public.support_subcategories ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_subcategories_read_all ON public.support_subcategories
  FOR SELECT TO authenticated USING (is_active = true);

CREATE TABLE public.support_priority_rules (
  version int PRIMARY KEY,
  description text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  activated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.support_priority_rules TO authenticated;
GRANT ALL ON public.support_priority_rules TO service_role;
ALTER TABLE public.support_priority_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_priority_rules_read_all ON public.support_priority_rules
  FOR SELECT TO authenticated USING (true);

-- ---------- CAPABILITIES (scaffolding for later phases) --------------
CREATE TABLE public.support_capabilities_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capability public.support_capability NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz NULL,
  granted_by uuid NULL,
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, capability, effective_from)
);
CREATE INDEX support_cap_grants_user_idx ON public.support_capabilities_grants(user_id, capability)
  WHERE effective_until IS NULL;
GRANT SELECT ON public.support_capabilities_grants TO authenticated;
GRANT ALL ON public.support_capabilities_grants TO service_role;
ALTER TABLE public.support_capabilities_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_cap_grants_self_read ON public.support_capabilities_grants
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY support_cap_grants_platform_admin_read ON public.support_capabilities_grants
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'platform_admin'::app_role));

-- ---------- OWNERSHIP REGISTRY (schema only in Phase 1A) --------------
CREATE TABLE public.support_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key text NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('platform_user','external_contact')),
  subject_ref uuid NULL,
  contact_email text NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz NULL,
  is_delegated boolean NOT NULL DEFAULT false,
  delegated_by uuid NULL,
  assignment_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_role_assignments_role_active_idx
  ON public.support_role_assignments(role_key) WHERE effective_until IS NULL;
GRANT SELECT ON public.support_role_assignments TO authenticated;
GRANT ALL ON public.support_role_assignments TO service_role;
ALTER TABLE public.support_role_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_role_assignments_platform_admin_read ON public.support_role_assignments
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'platform_admin'::app_role));

-- ---------- CORE TICKETS ---------------------------------------------
CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text NOT NULL UNIQUE,
  source public.support_ticket_source NOT NULL DEFAULT 'portal',
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  funder_org_id uuid NULL,                        -- Phase 2 will add FK + policy
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  on_behalf_of_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  on_behalf_of_reason text NULL,
  category_key text NOT NULL REFERENCES public.support_categories(key) ON DELETE RESTRICT,
  subcategory_key text NULL REFERENCES public.support_subcategories(key) ON DELETE RESTRICT,
  is_restricted boolean NOT NULL DEFAULT false,
  restriction_class public.support_restriction_class NULL,
  customer_impact public.support_customer_impact NOT NULL,
  priority public.support_ticket_priority NOT NULL DEFAULT 'medium',
  priority_source public.support_priority_source NOT NULL DEFAULT 'calculated',
  priority_rules_version int NOT NULL,
  status public.support_ticket_status NOT NULL DEFAULT 'new',
  subject text NOT NULL,
  intended_action text NULL,
  actual_result text NULL,
  occurred_at timestamptz NULL,
  affected_users_count int NULL,
  workaround_available boolean NULL,
  safe_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_name text NULL,
  contact_email text NULL,
  resolved_at timestamptz NULL,
  closed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(subject) BETWEEN 1 AND 300),
  CHECK (affected_users_count IS NULL OR affected_users_count >= 0),
  CHECK (
    (on_behalf_of_user_id IS NULL AND on_behalf_of_reason IS NULL) OR
    (on_behalf_of_user_id IS NOT NULL AND on_behalf_of_reason IS NOT NULL)
  )
);
CREATE INDEX support_tickets_org_idx ON public.support_tickets(org_id);
CREATE INDEX support_tickets_creator_idx ON public.support_tickets(created_by);
CREATE INDEX support_tickets_status_idx ON public.support_tickets(status);
CREATE INDEX support_tickets_category_idx ON public.support_tickets(category_key);
GRANT SELECT ON public.support_tickets TO authenticated;
GRANT ALL  ON public.support_tickets TO service_role;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- ---------- APPEND-ONLY EVENTS ---------------------------------------
CREATE TABLE public.support_ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE RESTRICT,
  event_kind public.support_event_kind NOT NULL,
  actor_user_id uuid NULL,
  represented_user_id uuid NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_ticket_events_ticket_idx ON public.support_ticket_events(ticket_id, created_at);
GRANT SELECT ON public.support_ticket_events TO authenticated;
GRANT ALL  ON public.support_ticket_events TO service_role;
ALTER TABLE public.support_ticket_events ENABLE ROW LEVEL SECURITY;

-- ---------- IMMUTABLE MESSAGES ---------------------------------------
CREATE TABLE public.support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE RESTRICT,
  kind public.support_message_kind NOT NULL,
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(body) BETWEEN 1 AND 10000)
);
CREATE INDEX support_ticket_messages_ticket_idx
  ON public.support_ticket_messages(ticket_id, created_at);
GRANT SELECT ON public.support_ticket_messages TO authenticated;
GRANT ALL  ON public.support_ticket_messages TO service_role;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;

-- ---------- LINKED RECORDS (safe references only) --------------------
CREATE TABLE public.support_ticket_linked_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE RESTRICT,
  record_kind public.support_linked_record_kind NOT NULL,
  source_id text NOT NULL,
  safe_label text NOT NULL,
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('customer_visible','internal')),
  linked_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  permission_checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, record_kind, source_id)
);
CREATE INDEX support_ticket_linked_records_ticket_idx ON public.support_ticket_linked_records(ticket_id);
GRANT SELECT ON public.support_ticket_linked_records TO authenticated;
GRANT ALL  ON public.support_ticket_linked_records TO service_role;
ALTER TABLE public.support_ticket_linked_records ENABLE ROW LEVEL SECURITY;

-- ---------- ACCESS AUDIT (restricted views) ---------------------------
CREATE TABLE public.support_ticket_access_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL,
  access_kind text NOT NULL,
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_ticket_access_audit_ticket_idx
  ON public.support_ticket_access_audit(ticket_id, created_at);
-- No authenticated grant: only service_role and security-definer helpers read/write.
GRANT ALL ON public.support_ticket_access_audit TO service_role;
ALTER TABLE public.support_ticket_access_audit ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- APPEND-ONLY PROTECTION (deny UPDATE / DELETE via trigger)
-- =====================================================================
CREATE OR REPLACE FUNCTION public._support_reject_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'support: table % is append-only; % denied', TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER support_ticket_events_no_update
  BEFORE UPDATE ON public.support_ticket_events
  FOR EACH ROW EXECUTE FUNCTION public._support_reject_mutation();
CREATE TRIGGER support_ticket_events_no_delete
  BEFORE DELETE ON public.support_ticket_events
  FOR EACH ROW EXECUTE FUNCTION public._support_reject_mutation();

CREATE TRIGGER support_ticket_messages_no_update
  BEFORE UPDATE ON public.support_ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public._support_reject_mutation();
CREATE TRIGGER support_ticket_messages_no_delete
  BEFORE DELETE ON public.support_ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public._support_reject_mutation();

CREATE TRIGGER support_ticket_access_audit_no_update
  BEFORE UPDATE ON public.support_ticket_access_audit
  FOR EACH ROW EXECUTE FUNCTION public._support_reject_mutation();
CREATE TRIGGER support_ticket_access_audit_no_delete
  BEFORE DELETE ON public.support_ticket_access_audit
  FOR EACH ROW EXECUTE FUNCTION public._support_reject_mutation();

-- updated_at maintenance
CREATE TRIGGER support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER support_categories_updated_at
  BEFORE UPDATE ON public.support_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER support_subcategories_updated_at
  BEFORE UPDATE ON public.support_subcategories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER support_role_assignments_updated_at
  BEFORE UPDATE ON public.support_role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================================
-- HELPER FUNCTIONS
-- =====================================================================

-- capability check (scaffolding; not used in Phase 1A RLS but available for later phases)
CREATE OR REPLACE FUNCTION public.has_support_capability(_user_id uuid, _cap public.support_capability)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.support_capabilities_grants g
    WHERE g.user_id = _user_id
      AND g.capability = _cap
      AND g.effective_from <= now()
      AND (g.effective_until IS NULL OR g.effective_until > now())
  );
$$;

-- resolve caller's org id via profiles (server-side; never trust client)
CREATE OR REPLACE FUNCTION public._support_caller_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid();
$$;

-- ticket number: IZ-YYYY-XXXXXXXX (random base32-ish, unique-checked)
CREATE OR REPLACE FUNCTION public._support_next_ticket_number()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; -- no 0,1,I,L,O
  yr text := to_char(now(),'YYYY');
  candidate text;
  n int;
  i int;
BEGIN
  FOR n IN 1..10 LOOP
    candidate := 'IZ-' || yr || '-';
    FOR i IN 1..8 LOOP
      candidate := candidate || substr(alphabet, 1 + floor(random()*31)::int, 1);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE ticket_number = candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'support: could not allocate ticket number after 10 attempts';
END;
$$;

-- restriction resolver from category + subcategory
CREATE OR REPLACE FUNCTION public._support_resolve_restriction(
  _category_key text, _subcategory_key text
) RETURNS TABLE (is_restricted boolean, restriction_class public.support_restriction_class)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cat_r boolean; cat_c public.support_restriction_class;
  sub_r boolean; sub_c public.support_restriction_class;
BEGIN
  SELECT c.is_restricted, c.restriction_class INTO cat_r, cat_c
  FROM public.support_categories c WHERE c.key = _category_key;
  IF _subcategory_key IS NOT NULL THEN
    SELECT s.is_restricted, s.restriction_class INTO sub_r, sub_c
    FROM public.support_subcategories s WHERE s.key = _subcategory_key;
  END IF;
  is_restricted := COALESCE(sub_r,false) OR COALESCE(cat_r,false);
  restriction_class := COALESCE(sub_c, cat_c);
  RETURN NEXT;
END;
$$;

-- deterministic priority calculation (Phase 1A rules; version 1)
CREATE OR REPLACE FUNCTION public._support_calculate_priority(
  _category_key text,
  _restriction_class public.support_restriction_class,
  _impact public.support_customer_impact,
  _affected_users int
) RETURNS TABLE (priority public.support_ticket_priority, source public.support_priority_source, version int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  active_version int;
  base public.support_ticket_priority := 'medium';
BEGIN
  SELECT r.version INTO active_version
  FROM public.support_priority_rules r WHERE r.is_active
  ORDER BY r.activated_at DESC LIMIT 1;
  IF active_version IS NULL THEN
    RAISE EXCEPTION 'support: no active priority rules';
  END IF;

  -- Rule 1: security concerns are urgent pending triage
  IF _restriction_class = 'security' OR _category_key = 'security' THEN
    priority := 'urgent'; source := 'security_default'; version := active_version;
    RETURN NEXT; RETURN;
  END IF;

  -- Rule 2: transaction/deadline blockage → high
  IF _impact = 'blocks_transaction_or_deadline' THEN
    base := 'high';
  ELSIF _impact = 'affects_organisation' THEN
    base := 'medium';
  ELSE
    base := 'medium';
  END IF;

  -- Rule 3: 10+ affected users bumps by one level (max urgent)
  IF _affected_users IS NOT NULL AND _affected_users >= 10 THEN
    base := CASE base
      WHEN 'low'    THEN 'medium'::public.support_ticket_priority
      WHEN 'medium' THEN 'high'::public.support_ticket_priority
      WHEN 'high'   THEN 'urgent'::public.support_ticket_priority
      ELSE base
    END;
  END IF;

  priority := base; source := 'calculated'; version := active_version;
  RETURN NEXT;
END;
$$;

-- access-audit writer for restricted views
CREATE OR REPLACE FUNCTION public._support_record_access(
  _ticket_id uuid, _actor uuid, _access_kind text, _reason text
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.support_ticket_access_audit(ticket_id, actor_user_id, access_kind, reason)
  VALUES (_ticket_id, _actor, _access_kind, _reason);
$$;

-- =====================================================================
-- RLS POLICIES (no permissive fallback; server-resolved scope)
-- =====================================================================

-- support_tickets
CREATE POLICY support_tickets_creator_read ON public.support_tickets
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY support_tickets_org_admin_read_nonrestricted ON public.support_tickets
  FOR SELECT TO authenticated
  USING (
    is_restricted = false
    AND public.is_org_admin(auth.uid(), org_id)
  );

CREATE POLICY support_tickets_platform_admin_read ON public.support_tickets
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role));

CREATE POLICY support_tickets_auditor_read ON public.support_tickets
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'auditor_read_only'::app_role));

-- support_ticket_events: read only when parent ticket is readable
CREATE POLICY support_ticket_events_read_via_ticket ON public.support_ticket_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id));
-- (RLS on support_tickets filters accessible rows for the joined subquery.)

-- support_ticket_messages
--  customer_visible: readable if parent ticket is readable
--  internal_note:    readable only by platform_admin or auditor_read_only
CREATE POLICY support_ticket_messages_customer_visible_read ON public.support_ticket_messages
  FOR SELECT TO authenticated
  USING (
    kind = 'customer_visible'
    AND EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id)
  );
CREATE POLICY support_ticket_messages_internal_note_read ON public.support_ticket_messages
  FOR SELECT TO authenticated
  USING (
    kind = 'internal_note'
    AND (
      public.has_role(auth.uid(), 'platform_admin'::app_role)
      OR public.has_role(auth.uid(), 'auditor_read_only'::app_role)
    )
  );

-- support_ticket_linked_records
CREATE POLICY support_ticket_linked_records_read ON public.support_ticket_linked_records
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id)
    AND (
      visibility = 'customer_visible'
      OR public.has_role(auth.uid(), 'platform_admin'::app_role)
      OR public.has_role(auth.uid(), 'auditor_read_only'::app_role)
    )
  );

-- support_ticket_access_audit: no policy → no authenticated access.

-- =====================================================================
-- STATE-CHANGING RPCs (SECURITY DEFINER, atomic, event-writing)
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
  v_effective_org uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'support: authentication required' USING ERRCODE = '28000';
  END IF;
  IF _subject IS NULL OR length(btrim(_subject)) = 0 THEN
    RAISE EXCEPTION 'support: subject required';
  END IF;

  -- Category must exist and be active
  IF NOT EXISTS (SELECT 1 FROM public.support_categories WHERE key = _category_key AND is_active) THEN
    RAISE EXCEPTION 'support: invalid category %', _category_key;
  END IF;
  IF _subcategory_key IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.support_subcategories
    WHERE key = _subcategory_key AND category_key = _category_key AND is_active
  ) THEN
    RAISE EXCEPTION 'support: invalid subcategory % for category %', _subcategory_key, _category_key;
  END IF;

  -- On-behalf-of: only platform_admin may create for another user; both fields required together.
  IF (_on_behalf_of_user_id IS NULL) <> (_on_behalf_of_reason IS NULL) THEN
    RAISE EXCEPTION 'support: on_behalf_of user and reason must both be provided';
  END IF;
  IF _on_behalf_of_user_id IS NOT NULL
     AND NOT public.has_role(v_actor, 'platform_admin'::app_role) THEN
    RAISE EXCEPTION 'support: on-behalf-of creation requires platform administrator authority';
  END IF;

  -- Resolve org server-side: for platform_admin on-behalf-of use the represented user's org, else caller's org.
  IF _on_behalf_of_user_id IS NOT NULL THEN
    SELECT org_id INTO v_org FROM public.profiles WHERE id = _on_behalf_of_user_id;
  ELSE
    SELECT org_id INTO v_org FROM public.profiles WHERE id = v_actor;
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'support: caller has no organisation profile';
  END IF;

  -- Reject reserved / unsafe fields inside safe_context
  IF _safe_context ? 'password' OR _safe_context ? 'secret' OR _safe_context ? 'token'
     OR _safe_context ? 'api_key' OR _safe_context ? 'authorization' THEN
    RAISE EXCEPTION 'support: safe_context must not contain secret fields';
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
REVOKE ALL ON FUNCTION public.create_support_ticket(text,text,public.support_customer_impact,text,text,text,timestamptz,int,boolean,jsonb,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(text,text,public.support_customer_impact,text,text,text,timestamptz,int,boolean,jsonb,text,text,uuid,text) TO authenticated;

-- Add customer-visible message
CREATE OR REPLACE FUNCTION public.post_support_ticket_customer_message(
  _ticket_id uuid, _body text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ticket public.support_tickets%ROWTYPE;
  v_msg_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'support: authentication required' USING ERRCODE='28000'; END IF;
  IF _body IS NULL OR length(btrim(_body)) = 0 THEN RAISE EXCEPTION 'support: message body required'; END IF;
  IF length(_body) > 10000 THEN RAISE EXCEPTION 'support: message body too long'; END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = _ticket_id;
  IF v_ticket.id IS NULL THEN RAISE EXCEPTION 'support: ticket not found' USING ERRCODE='42704'; END IF;

  -- Authorisation: creator; platform_admin; org_admin on non-restricted org ticket.
  IF NOT (
    v_ticket.created_by = v_actor
    OR public.has_role(v_actor, 'platform_admin'::app_role)
    OR (v_ticket.is_restricted = false AND public.is_org_admin(v_actor, v_ticket.org_id))
  ) THEN
    RAISE EXCEPTION 'support: not authorised for this ticket' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.support_ticket_messages(ticket_id, kind, author_user_id, body)
  VALUES (_ticket_id, 'customer_visible', v_actor, _body)
  RETURNING id INTO v_msg_id;

  INSERT INTO public.support_ticket_events(ticket_id, event_kind, actor_user_id, payload)
  VALUES (_ticket_id, 'customer_message_added', v_actor, jsonb_build_object('message_id', v_msg_id));

  RETURN v_msg_id;
END;
$$;
REVOKE ALL ON FUNCTION public.post_support_ticket_customer_message(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_support_ticket_customer_message(uuid,text) TO authenticated;

-- Add internal note (platform_admin only in Phase 1A)
CREATE OR REPLACE FUNCTION public.post_support_ticket_internal_note(
  _ticket_id uuid, _body text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_msg_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'support: authentication required' USING ERRCODE='28000'; END IF;
  IF NOT public.has_role(v_actor, 'platform_admin'::app_role) THEN
    RAISE EXCEPTION 'support: internal notes require platform administrator authority' USING ERRCODE='42501';
  END IF;
  IF _body IS NULL OR length(btrim(_body)) = 0 THEN RAISE EXCEPTION 'support: note body required'; END IF;
  IF length(_body) > 10000 THEN RAISE EXCEPTION 'support: note body too long'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE id = _ticket_id) THEN
    RAISE EXCEPTION 'support: ticket not found' USING ERRCODE='42704';
  END IF;

  INSERT INTO public.support_ticket_messages(ticket_id, kind, author_user_id, body)
  VALUES (_ticket_id, 'internal_note', v_actor, _body)
  RETURNING id INTO v_msg_id;

  INSERT INTO public.support_ticket_events(ticket_id, event_kind, actor_user_id, payload)
  VALUES (_ticket_id, 'internal_note_added', v_actor, jsonb_build_object('message_id', v_msg_id));

  RETURN v_msg_id;
END;
$$;
REVOKE ALL ON FUNCTION public.post_support_ticket_internal_note(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_support_ticket_internal_note(uuid,text) TO authenticated;

-- Add safe linked-record reference
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
  IF v_actor IS NULL THEN RAISE EXCEPTION 'support: authentication required' USING ERRCODE='28000'; END IF;
  IF _visibility NOT IN ('customer_visible','internal') THEN
    RAISE EXCEPTION 'support: invalid visibility %', _visibility;
  END IF;
  IF _source_id IS NULL OR length(btrim(_source_id)) = 0 THEN
    RAISE EXCEPTION 'support: source_id required';
  END IF;
  IF _safe_label IS NULL OR length(btrim(_safe_label)) = 0 THEN
    RAISE EXCEPTION 'support: safe_label required';
  END IF;
  IF length(_safe_label) > 200 THEN RAISE EXCEPTION 'support: safe_label too long'; END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = _ticket_id;
  IF v_ticket.id IS NULL THEN RAISE EXCEPTION 'support: ticket not found' USING ERRCODE='42704'; END IF;

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

-- Change customer-visible status (backend completeness; platform_admin only in Phase 1A)
CREATE OR REPLACE FUNCTION public.update_support_ticket_status(
  _ticket_id uuid, _new_status public.support_ticket_status, _reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_old public.support_ticket_status;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'support: authentication required' USING ERRCODE='28000'; END IF;
  IF NOT public.has_role(v_actor, 'platform_admin'::app_role) THEN
    RAISE EXCEPTION 'support: status changes require platform administrator authority' USING ERRCODE='42501';
  END IF;
  SELECT status INTO v_old FROM public.support_tickets WHERE id = _ticket_id FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'support: ticket not found' USING ERRCODE='42704'; END IF;
  IF v_old = _new_status THEN RETURN; END IF;

  UPDATE public.support_tickets
     SET status = _new_status,
         resolved_at = CASE WHEN _new_status = 'resolved' AND resolved_at IS NULL THEN now() ELSE resolved_at END,
         closed_at   = CASE WHEN _new_status = 'closed'   AND closed_at   IS NULL THEN now() ELSE closed_at   END
   WHERE id = _ticket_id;

  INSERT INTO public.support_ticket_events(ticket_id, event_kind, actor_user_id, payload)
  VALUES (_ticket_id, 'status_changed', v_actor,
          jsonb_build_object('from', v_old, 'to', _new_status, 'reason', _reason));
END;
$$;
REVOKE ALL ON FUNCTION public.update_support_ticket_status(uuid,public.support_ticket_status,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_support_ticket_status(uuid,public.support_ticket_status,text) TO authenticated;

-- =====================================================================
-- READ-ONLY RPCs (no writes to tickets or events; access-audit only on restricted internal reads)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.list_own_support_tickets()
RETURNS SETOF public.support_tickets
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.support_tickets WHERE created_by = auth.uid() ORDER BY created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.list_own_support_tickets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_own_support_tickets() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_org_support_tickets()
RETURNS SETOF public.support_tickets
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.*
  FROM public.support_tickets t
  WHERE public.is_org_admin(auth.uid(), t.org_id)
    AND t.is_restricted = false
  ORDER BY t.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.list_org_support_tickets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_org_support_tickets() TO authenticated;

-- Customer-safe ticket getter (no internal notes; no restricted-body leakage)
CREATE OR REPLACE FUNCTION public.get_support_ticket(_ticket_id uuid)
RETURNS TABLE (
  id uuid, ticket_number text, status public.support_ticket_status,
  priority public.support_ticket_priority, category_key text, subcategory_key text,
  customer_impact public.support_customer_impact, subject text,
  is_restricted boolean, created_at timestamptz, updated_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := auth.uid(); v_ticket public.support_tickets%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RETURN; END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = _ticket_id;
  IF v_ticket.id IS NULL THEN RETURN; END IF;

  IF NOT (
    v_ticket.created_by = v_actor
    OR public.has_role(v_actor, 'platform_admin'::app_role)
    OR public.has_role(v_actor, 'auditor_read_only'::app_role)
    OR (v_ticket.is_restricted = false AND public.is_org_admin(v_actor, v_ticket.org_id))
  ) THEN
    RETURN;  -- do not reveal existence
  END IF;

  id := v_ticket.id; ticket_number := v_ticket.ticket_number; status := v_ticket.status;
  priority := v_ticket.priority; category_key := v_ticket.category_key;
  subcategory_key := v_ticket.subcategory_key; customer_impact := v_ticket.customer_impact;
  subject := v_ticket.subject; is_restricted := v_ticket.is_restricted;
  created_at := v_ticket.created_at; updated_at := v_ticket.updated_at;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.get_support_ticket(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_support_ticket(uuid) TO authenticated;

-- Internal-full ticket getter (platform_admin only); writes access-audit for restricted tickets
CREATE OR REPLACE FUNCTION public.get_support_ticket_internal(_ticket_id uuid, _reason text DEFAULT NULL)
RETURNS SETOF public.support_tickets
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := auth.uid(); v_ticket public.support_tickets%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RETURN; END IF;
  IF NOT (
    public.has_role(v_actor, 'platform_admin'::app_role)
    OR public.has_role(v_actor, 'auditor_read_only'::app_role)
  ) THEN RETURN; END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = _ticket_id;
  IF v_ticket.id IS NULL THEN RETURN; END IF;

  IF v_ticket.is_restricted THEN
    PERFORM public._support_record_access(v_ticket.id, v_actor, 'internal_view_restricted', _reason);
  END IF;

  RETURN QUERY SELECT * FROM public.support_tickets WHERE id = v_ticket.id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_support_ticket_internal(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_support_ticket_internal(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_support_ticket_customer_messages(_ticket_id uuid)
RETURNS SETOF public.support_ticket_messages
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.* FROM public.support_ticket_messages m
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

CREATE OR REPLACE FUNCTION public.list_support_ticket_internal_notes(_ticket_id uuid)
RETURNS SETOF public.support_ticket_messages
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.* FROM public.support_ticket_messages m
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

-- =====================================================================
-- SEED: approved catalogue (Decisions 14, 15) and priority rules v1
-- =====================================================================
INSERT INTO public.support_priority_rules(version, description, is_active)
VALUES (1, 'Phase 1A v1: security→urgent; blocks_transaction_or_deadline→high; affects_organisation→medium; affected_users≥10 bumps one level (cap urgent); default medium.', true);

INSERT INTO public.support_categories(key, label, is_restricted, restriction_class, sort_order) VALUES
  ('account_signin',        'Account and sign-in',                 false, NULL, 10),
  ('org_team_access',       'Organisation and team access',        false, NULL, 20),
  ('match_transaction',     'Match / transaction',                 false, NULL, 30),
  ('poi',                   'POI',                                 false, NULL, 40),
  ('wad',                   'WaD',                                 false, NULL, 50),
  ('documents',             'Documents',                           false, NULL, 60),
  ('funder_access',         'Funder access and evidence',          false, NULL, 70),
  ('unknown_counterparty',  'Unknown counterparty / facilitation', false, NULL, 80),
  ('compliance_verification','Compliance and verification',        true,  'compliance_verification', 90),
  ('payments_billing',      'Payments and billing',                false, NULL, 100),
  ('api_integrations',      'API and integrations',                false, NULL, 110),
  ('webhooks',              'Webhooks',                            false, NULL, 120),
  ('notifications',         'Notifications',                       false, NULL, 130),
  ('reports_exports',       'Reports and exports',                 false, NULL, 140),
  ('platform_defect',       'Platform defect',                     false, NULL, 150),
  ('outage_degradation',    'Outage or degradation',               false, NULL, 160),
  ('security',              'Security concern',                    true,  'security', 170),
  ('feature_request',       'Feature request',                     false, NULL, 180),
  ('general_question',      'General question',                    false, NULL, 190);

INSERT INTO public.support_subcategories(key, category_key, label, is_restricted, restriction_class, sort_order) VALUES
  ('account_signin__signin',       'account_signin', 'Sign-in',                   false, NULL, 10),
  ('account_signin__mfa',          'account_signin', 'MFA',                       false, NULL, 20),
  ('account_signin__password_reset','account_signin','Password reset',            false, NULL, 30),
  ('org__invite',                  'org_team_access','Invite',                    false, NULL, 10),
  ('org__role',                    'org_team_access','Role',                      false, NULL, 20),
  ('org__admin_transfer',          'org_team_access','Administrator transfer',    false, NULL, 30),
  ('match__state',                 'match_transaction','Transaction state',       false, NULL, 10),
  ('match__counterparty',          'match_transaction','Counterparty',            false, NULL, 20),
  ('match__dispute',               'match_transaction','Dispute-related',         false, NULL, 30),
  ('poi__missing',                 'poi','POI missing',                           false, NULL, 10),
  ('poi__generation_failure',      'poi','POI generation failure',                false, NULL, 20),
  ('wad__stuck_step',              'wad','Stuck step',                            false, NULL, 10),
  ('wad__status',                  'wad','Status',                                false, NULL, 20),
  ('wad__error',                   'wad','Error',                                 false, NULL, 30),
  ('documents__upload',            'documents','Upload',                          false, NULL, 10),
  ('documents__download',          'documents','Download',                        false, NULL, 20),
  ('documents__expired_link',      'documents','Expired link',                    false, NULL, 30),
  ('funder__grant_access',         'funder_access','Grant access',                false, NULL, 10),
  ('funder__evidence_release',     'funder_access','Evidence release',            true, 'funder_evidence', 20),
  ('funder__evidence_question',    'funder_access','Evidence question',           true, 'funder_evidence', 30),
  ('compliance__page_access',      'compliance_verification','Page access',       true, 'compliance_verification', 10),
  ('compliance__outcome_review',   'compliance_verification','Outcome review',    true, 'compliance_verification', 20),
  ('compliance__identity_verification','compliance_verification','Identity verification', true, 'identity', 30),
  ('compliance__business_verification','compliance_verification','Business verification', true, 'compliance_verification', 40),
  ('compliance__screening_issue',  'compliance_verification','Screening issue',   true, 'compliance_verification', 50),
  ('payments__declined',           'payments_billing','Declined',                 false, NULL, 10),
  ('payments__charged_no_credit',  'payments_billing','Charged but not credited', false, NULL, 20),
  ('payments__billing_visibility', 'payments_billing','Billing visibility',       false, NULL, 30),
  ('payments__formal_dispute',     'payments_billing','Formal dispute',           true, 'payment_dispute', 40),
  ('api__authentication',          'api_integrations','Authentication',           false, NULL, 10),
  ('api__sandbox',                 'api_integrations','Sandbox',                  false, NULL, 20),
  ('api__production',              'api_integrations','Production',               false, NULL, 30),
  ('api__rate_limit',              'api_integrations','Rate limit',               false, NULL, 40),
  ('api__monthly_limit',           'api_integrations','Monthly limit',            false, NULL, 50),
  ('api__unexpected_response',     'api_integrations','Unexpected response',      false, NULL, 60),
  ('api__documentation',           'api_integrations','Documentation',            false, NULL, 70),
  ('webhooks__endpoint_configuration','webhooks','Endpoint configuration',        false, NULL, 10),
  ('webhooks__delivery_failure',   'webhooks','Delivery failure',                 false, NULL, 20),
  ('platform__defect',             'platform_defect','Defect',                    false, NULL, 10),
  ('platform__outage',             'outage_degradation','Outage',                 false, NULL, 10),
  ('platform__security',           'security','Security',                         true, 'security', 10),
  ('platform__feature_request',    'feature_request','Feature request',           false, NULL, 10);
