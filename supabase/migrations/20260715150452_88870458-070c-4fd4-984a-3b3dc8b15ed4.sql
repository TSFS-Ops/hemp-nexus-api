-- Enterprise Support Centre — Batch 1 (final)
DO $$ BEGIN CREATE TYPE public.support_team_member_role AS ENUM ('lead','member'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.support_incident_status AS ENUM ('investigating','identified','monitoring','resolved','scheduled','in_progress','completed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.support_incident_severity AS ENUM ('minor','major','critical','maintenance'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.support_attachment_scan_status AS ENUM ('pending','clean','infected','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.support_teams (
  key text PRIMARY KEY, label text NOT NULL, description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.support_teams TO authenticated;
GRANT ALL ON public.support_teams TO service_role;
ALTER TABLE public.support_teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "support_teams_authenticated_read" ON public.support_teams;
CREATE POLICY "support_teams_authenticated_read" ON public.support_teams FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "support_teams_admin_manage" ON public.support_teams;
CREATE POLICY "support_teams_admin_manage" ON public.support_teams FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin')) WITH CHECK (public.has_role(auth.uid(),'platform_admin'));

CREATE TABLE IF NOT EXISTS public.support_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_key text NOT NULL REFERENCES public.support_teams(key) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  member_role public.support_team_member_role NOT NULL DEFAULT 'member',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_key, user_id)
);
GRANT SELECT ON public.support_team_members TO authenticated;
GRANT ALL ON public.support_team_members TO service_role;
ALTER TABLE public.support_team_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stm_read_self_or_admin" ON public.support_team_members;
CREATE POLICY "stm_read_self_or_admin" ON public.support_team_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'platform_admin'));
DROP POLICY IF EXISTS "stm_admin_manage" ON public.support_team_members;
CREATE POLICY "stm_admin_manage" ON public.support_team_members FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin')) WITH CHECK (public.has_role(auth.uid(),'platform_admin'));

CREATE TABLE IF NOT EXISTS public.support_category_routing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key text NOT NULL REFERENCES public.support_categories(key) ON DELETE CASCADE,
  subcategory_key text REFERENCES public.support_subcategories(key) ON DELETE CASCADE,
  team_key text NOT NULL REFERENCES public.support_teams(key) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_key, subcategory_key)
);
GRANT SELECT ON public.support_category_routing TO authenticated;
GRANT ALL ON public.support_category_routing TO service_role;
ALTER TABLE public.support_category_routing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scr_authenticated_read" ON public.support_category_routing;
CREATE POLICY "scr_authenticated_read" ON public.support_category_routing FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "scr_admin_manage" ON public.support_category_routing;
CREATE POLICY "scr_admin_manage" ON public.support_category_routing FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin')) WITH CHECK (public.has_role(auth.uid(),'platform_admin'));

CREATE TABLE IF NOT EXISTS public.support_sla_targets (
  priority public.support_ticket_priority PRIMARY KEY,
  first_response_minutes integer NOT NULL,
  resolution_minutes integer NOT NULL,
  business_hours_only boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.support_sla_targets TO authenticated;
GRANT ALL ON public.support_sla_targets TO service_role;
ALTER TABLE public.support_sla_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sla_read" ON public.support_sla_targets;
CREATE POLICY "sla_read" ON public.support_sla_targets FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "sla_admin_manage" ON public.support_sla_targets;
CREATE POLICY "sla_admin_manage" ON public.support_sla_targets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin')) WITH CHECK (public.has_role(auth.uid(),'platform_admin'));

CREATE TABLE IF NOT EXISTS public.support_ticket_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  assignee_user_id uuid, team_key text REFERENCES public.support_teams(key),
  assigned_by uuid, assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz, reason text
);
CREATE INDEX IF NOT EXISTS idx_sta_ticket ON public.support_ticket_assignments(ticket_id, assigned_at DESC);
GRANT SELECT ON public.support_ticket_assignments TO authenticated;
GRANT ALL ON public.support_ticket_assignments TO service_role;
ALTER TABLE public.support_ticket_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sta_admin_read" ON public.support_ticket_assignments;
CREATE POLICY "sta_admin_read" ON public.support_ticket_assignments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin') OR public.has_support_capability(auth.uid(),'support_read'));

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS current_team_key text REFERENCES public.support_teams(key),
  ADD COLUMN IF NOT EXISTS current_assignee_user_id uuid,
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_first_response_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_resolution_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_customer_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_internal_message_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_st_current_team ON public.support_tickets(current_team_key);
CREATE INDEX IF NOT EXISTS idx_st_current_assignee ON public.support_tickets(current_assignee_user_id);
CREATE INDEX IF NOT EXISTS idx_st_sla_first ON public.support_tickets(sla_first_response_due_at);
CREATE INDEX IF NOT EXISTS idx_st_sla_res ON public.support_tickets(sla_resolution_due_at);

CREATE TABLE IF NOT EXISTS public.support_ticket_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.support_ticket_messages(id) ON DELETE SET NULL,
  storage_bucket text NOT NULL DEFAULT 'support-attachments',
  storage_path text NOT NULL, filename text NOT NULL, mime_type text NOT NULL,
  size_bytes bigint NOT NULL, uploaded_by uuid NOT NULL,
  scan_status public.support_attachment_scan_status NOT NULL DEFAULT 'pending',
  scanned_at timestamptz, scan_note text,
  is_internal_only boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stat_ticket ON public.support_ticket_attachments(ticket_id, created_at DESC);
GRANT SELECT, INSERT ON public.support_ticket_attachments TO authenticated;
GRANT ALL ON public.support_ticket_attachments TO service_role;
ALTER TABLE public.support_ticket_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "att_read_ticket_visible" ON public.support_ticket_attachments;
CREATE POLICY "att_read_ticket_visible" ON public.support_ticket_attachments FOR SELECT TO authenticated
  USING (
    (NOT is_internal_only AND EXISTS (
      SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id
        AND (t.created_by = auth.uid() OR t.on_behalf_of_user_id = auth.uid()
             OR public.has_role(auth.uid(),'platform_admin')
             OR public.has_support_capability(auth.uid(),'support_read'))
    ))
    OR public.has_role(auth.uid(),'platform_admin')
    OR public.has_support_capability(auth.uid(),'support_read')
  );
DROP POLICY IF EXISTS "att_insert_uploader" ON public.support_ticket_attachments;
CREATE POLICY "att_insert_uploader" ON public.support_ticket_attachments FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid() AND EXISTS (
      SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id
        AND (t.created_by = auth.uid() OR t.on_behalf_of_user_id = auth.uid()
             OR public.has_role(auth.uid(),'platform_admin')
             OR public.has_support_capability(auth.uid(),'support_read'))
    )
  );

CREATE TABLE IF NOT EXISTS public.support_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_number text NOT NULL UNIQUE, title text NOT NULL, summary text,
  status public.support_incident_status NOT NULL DEFAULT 'investigating',
  severity public.support_incident_severity NOT NULL DEFAULT 'minor',
  is_public boolean NOT NULL DEFAULT true,
  affected_components text[] NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL DEFAULT now(),
  identified_at timestamptz, resolved_at timestamptz,
  scheduled_start timestamptz, scheduled_end timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sinc_status ON public.support_incidents(status, started_at DESC);
GRANT SELECT ON public.support_incidents TO anon, authenticated;
GRANT ALL ON public.support_incidents TO service_role;
ALTER TABLE public.support_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inc_public_read" ON public.support_incidents;
CREATE POLICY "inc_public_read" ON public.support_incidents FOR SELECT TO anon, authenticated USING (is_public = true);
DROP POLICY IF EXISTS "inc_admin_all" ON public.support_incidents;
CREATE POLICY "inc_admin_all" ON public.support_incidents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin')) WITH CHECK (public.has_role(auth.uid(),'platform_admin'));

CREATE TABLE IF NOT EXISTS public.support_incident_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.support_incidents(id) ON DELETE CASCADE,
  status public.support_incident_status NOT NULL,
  body text NOT NULL, is_public boolean NOT NULL DEFAULT true,
  author_user_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sincu_inc ON public.support_incident_updates(incident_id, created_at DESC);
GRANT SELECT ON public.support_incident_updates TO anon, authenticated;
GRANT ALL ON public.support_incident_updates TO service_role;
ALTER TABLE public.support_incident_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "incu_public_read" ON public.support_incident_updates;
CREATE POLICY "incu_public_read" ON public.support_incident_updates FOR SELECT TO anon, authenticated
  USING (is_public = true AND EXISTS (SELECT 1 FROM public.support_incidents i WHERE i.id = incident_id AND i.is_public));
DROP POLICY IF EXISTS "incu_admin_all" ON public.support_incident_updates;
CREATE POLICY "incu_admin_all" ON public.support_incident_updates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin')) WITH CHECK (public.has_role(auth.uid(),'platform_admin'));

CREATE TABLE IF NOT EXISTS public.support_knowledge_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE, title text NOT NULL, summary text,
  body_md text NOT NULL,
  category_key text REFERENCES public.support_categories(key),
  audience text NOT NULL DEFAULT 'public',
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz, author_user_id uuid,
  view_count bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kb_pub ON public.support_knowledge_articles(is_published, published_at DESC);
GRANT SELECT ON public.support_knowledge_articles TO anon, authenticated;
GRANT ALL ON public.support_knowledge_articles TO service_role;
ALTER TABLE public.support_knowledge_articles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kb_public_read" ON public.support_knowledge_articles;
CREATE POLICY "kb_public_read" ON public.support_knowledge_articles FOR SELECT TO anon, authenticated
  USING (is_published = true AND audience IN ('public','authenticated'));
DROP POLICY IF EXISTS "kb_admin_all" ON public.support_knowledge_articles;
CREATE POLICY "kb_admin_all" ON public.support_knowledge_articles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin')) WITH CHECK (public.has_role(auth.uid(),'platform_admin'));

CREATE OR REPLACE FUNCTION public._support_apply_routing_and_sla()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_team text; v_first_min integer; v_res_min integer;
BEGIN
  SELECT team_key INTO v_team FROM public.support_category_routing
    WHERE is_active AND category_key = NEW.category_key
      AND (subcategory_key IS NOT DISTINCT FROM NEW.subcategory_key)
    ORDER BY subcategory_key NULLS LAST LIMIT 1;
  IF v_team IS NULL THEN
    SELECT team_key INTO v_team FROM public.support_category_routing
      WHERE is_active AND category_key = NEW.category_key AND subcategory_key IS NULL LIMIT 1;
  END IF;
  IF v_team IS NULL THEN v_team := 'triage'; END IF;
  NEW.current_team_key := v_team;
  SELECT first_response_minutes, resolution_minutes INTO v_first_min, v_res_min
    FROM public.support_sla_targets WHERE priority = NEW.priority;
  IF v_first_min IS NOT NULL THEN NEW.sla_first_response_due_at := NEW.created_at + make_interval(mins => v_first_min); END IF;
  IF v_res_min IS NOT NULL THEN NEW.sla_resolution_due_at := NEW.created_at + make_interval(mins => v_res_min); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_st_routing_sla ON public.support_tickets;
CREATE TRIGGER trg_st_routing_sla BEFORE INSERT ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public._support_apply_routing_and_sla();

CREATE OR REPLACE FUNCTION public._support_msg_updates_first_response()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'customer_message' AND NEW.author_user_id IS NOT NULL AND (
    public.has_role(NEW.author_user_id,'platform_admin')
    OR public.has_support_capability(NEW.author_user_id,'support_read')
  ) THEN
    UPDATE public.support_tickets
      SET first_response_at = COALESCE(first_response_at, NEW.created_at),
          last_internal_message_at = NEW.created_at, updated_at = now()
      WHERE id = NEW.ticket_id;
  ELSIF NEW.kind = 'customer_message' THEN
    UPDATE public.support_tickets
      SET last_customer_message_at = NEW.created_at, updated_at = now()
      WHERE id = NEW.ticket_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stm_first_response ON public.support_ticket_messages;
CREATE TRIGGER trg_stm_first_response AFTER INSERT ON public.support_ticket_messages
FOR EACH ROW EXECUTE FUNCTION public._support_msg_updates_first_response();

INSERT INTO public.support_teams(key,label,description) VALUES
  ('triage','Triage','Default landing team; routes to specialist queues.'),
  ('platform','Platform Support','Platform / product issues.'),
  ('billing','Billing & Tokens','Billing, invoicing, refunds, token ledger.'),
  ('security','Security & Trust','Security, abuse, incidents, disclosures.'),
  ('api','API & Integrations','Public API and developer integrations.'),
  ('compliance','Compliance & Governance','KYC/IDV, disputes, governance.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.support_sla_targets(priority,first_response_minutes,resolution_minutes,business_hours_only) VALUES
  ('urgent',30,240,false),
  ('high',120,480,true),
  ('medium',480,4320,true),
  ('low',1440,10080,true)
ON CONFLICT (priority) DO NOTHING;

CREATE OR REPLACE FUNCTION public.assign_support_ticket(_ticket_id uuid,_assignee uuid,_team_key text,_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'platform_admin') OR public.has_support_capability(auth.uid(),'support_triage')) THEN
    RAISE EXCEPTION 'not authorised to assign' USING ERRCODE='42501';
  END IF;
  IF _team_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.support_teams WHERE key=_team_key AND is_active) THEN
    RAISE EXCEPTION 'unknown team %', _team_key USING ERRCODE='22023';
  END IF;
  UPDATE public.support_ticket_assignments SET unassigned_at = now()
    WHERE ticket_id = _ticket_id AND unassigned_at IS NULL;
  INSERT INTO public.support_ticket_assignments(ticket_id,assignee_user_id,team_key,assigned_by,reason)
    VALUES (_ticket_id,_assignee,_team_key,auth.uid(),_reason) RETURNING id INTO v_id;
  UPDATE public.support_tickets
    SET current_assignee_user_id = _assignee,
        current_team_key = COALESCE(_team_key, current_team_key), updated_at = now()
    WHERE id = _ticket_id;
  INSERT INTO public.support_ticket_events(ticket_id,event_kind,actor_user_id,payload)
    VALUES (_ticket_id,'reassigned',auth.uid(),
      jsonb_build_object('assignee',_assignee,'team',_team_key,'reason',_reason));
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.assign_support_ticket(uuid,uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.escalate_support_ticket(_ticket_id uuid,_new_priority public.support_ticket_priority,_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'platform_admin') OR public.has_support_capability(auth.uid(),'support_triage')) THEN
    RAISE EXCEPTION 'not authorised to escalate' USING ERRCODE='42501';
  END IF;
  UPDATE public.support_tickets
    SET priority = _new_priority, priority_source = 'manual_override', updated_at = now()
    WHERE id = _ticket_id;
  INSERT INTO public.support_ticket_events(ticket_id,event_kind,actor_user_id,payload)
    VALUES (_ticket_id,'priority_changed',auth.uid(),
      jsonb_build_object('priority',_new_priority,'reason',_reason));
END $$;
GRANT EXECUTE ON FUNCTION public.escalate_support_ticket(uuid,public.support_ticket_priority,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_support_ticket_attachment(
  _ticket_id uuid,_message_id uuid,_storage_path text,_filename text,_mime_type text,_size_bytes bigint,_is_internal boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF _size_bytes > 20971520 THEN RAISE EXCEPTION 'file exceeds 20 MB limit' USING ERRCODE='22023'; END IF;
  IF _mime_type NOT IN (
    'image/png','image/jpeg','image/gif','image/webp',
    'application/pdf','text/plain','text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip'
  ) THEN RAISE EXCEPTION 'mime type % not allowed', _mime_type USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.support_tickets t WHERE t.id = _ticket_id AND (
      t.created_by = auth.uid() OR t.on_behalf_of_user_id = auth.uid()
      OR public.has_role(auth.uid(),'platform_admin')
      OR public.has_support_capability(auth.uid(),'support_read')
    )
  ) THEN RAISE EXCEPTION 'ticket not visible' USING ERRCODE='42501'; END IF;
  INSERT INTO public.support_ticket_attachments(
    ticket_id,message_id,storage_path,filename,mime_type,size_bytes,uploaded_by,is_internal_only
  ) VALUES (_ticket_id,_message_id,_storage_path,_filename,_mime_type,_size_bytes,auth.uid(),COALESCE(_is_internal,false))
  RETURNING id INTO v_id;
  INSERT INTO public.support_ticket_events(ticket_id,event_kind,actor_user_id,payload)
    VALUES (_ticket_id,'attachment_added',auth.uid(),
      jsonb_build_object('attachment_id',v_id,'filename',_filename,'size',_size_bytes));
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.register_support_ticket_attachment(uuid,uuid,text,text,text,bigint,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_support_ticket_attachments(_ticket_id uuid)
RETURNS TABLE (id uuid, filename text, mime_type text, size_bytes bigint, storage_path text,
  scan_status public.support_attachment_scan_status, is_internal_only boolean, uploaded_by uuid, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT a.id,a.filename,a.mime_type,a.size_bytes,a.storage_path,a.scan_status,a.is_internal_only,a.uploaded_by,a.created_at
  FROM public.support_ticket_attachments a
  JOIN public.support_tickets t ON t.id = a.ticket_id
  WHERE a.ticket_id = _ticket_id AND (
    (NOT a.is_internal_only AND (
      t.created_by = auth.uid() OR t.on_behalf_of_user_id = auth.uid()
      OR public.has_role(auth.uid(),'platform_admin')
      OR public.has_support_capability(auth.uid(),'support_read')
    ))
    OR public.has_role(auth.uid(),'platform_admin')
    OR public.has_support_capability(auth.uid(),'support_read')
  )
  ORDER BY a.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_support_ticket_attachments(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_public_incidents()
RETURNS TABLE (id uuid, incident_number text, title text, summary text,
  status public.support_incident_status, severity public.support_incident_severity,
  started_at timestamptz, resolved_at timestamptz,
  scheduled_start timestamptz, scheduled_end timestamptz, affected_components text[])
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT id, incident_number, title, summary, status, severity, started_at, resolved_at,
         scheduled_start, scheduled_end, affected_components
  FROM public.support_incidents WHERE is_public = true
  ORDER BY COALESCE(scheduled_start, started_at) DESC LIMIT 100;
$$;
GRANT EXECUTE ON FUNCTION public.list_public_incidents() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_public_incident_updates(_incident_id uuid)
RETURNS TABLE (id uuid, status public.support_incident_status, body text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT u.id, u.status, u.body, u.created_at
  FROM public.support_incident_updates u
  JOIN public.support_incidents i ON i.id = u.incident_id
  WHERE u.incident_id = _incident_id AND u.is_public AND i.is_public
  ORDER BY u.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_public_incident_updates(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_published_kb_articles(_q text)
RETURNS TABLE (id uuid, slug text, title text, summary text, category_key text, published_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT id, slug, title, summary, category_key, published_at
  FROM public.support_knowledge_articles
  WHERE is_published = true AND audience IN ('public','authenticated')
    AND (_q IS NULL OR _q = '' OR title ILIKE '%'||_q||'%' OR COALESCE(summary,'') ILIKE '%'||_q||'%')
  ORDER BY published_at DESC NULLS LAST LIMIT 200;
$$;
GRANT EXECUTE ON FUNCTION public.list_published_kb_articles(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_published_kb_article(_slug text)
RETURNS TABLE (id uuid, slug text, title text, summary text, body_md text, category_key text, published_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT id, slug, title, summary, body_md, category_key, published_at
  FROM public.support_knowledge_articles
  WHERE slug = _slug AND is_published AND audience IN ('public','authenticated');
$$;
GRANT EXECUTE ON FUNCTION public.get_published_kb_article(text) TO anon, authenticated;

INSERT INTO public.support_category_routing(category_key,subcategory_key,team_key)
SELECT c.key, NULL,
  CASE
    WHEN c.key ILIKE '%bill%' THEN 'billing'
    WHEN c.key ILIKE '%api%' OR c.key ILIKE '%integr%' THEN 'api'
    WHEN c.key ILIKE '%security%' OR c.key ILIKE '%abuse%' THEN 'security'
    WHEN c.key ILIKE '%compliance%' OR c.key ILIKE '%kyc%' THEN 'compliance'
    WHEN c.key ILIKE '%platform%' OR c.key ILIKE '%bug%' THEN 'platform'
    ELSE 'triage'
  END
FROM public.support_categories c WHERE c.is_active
ON CONFLICT (category_key, subcategory_key) DO NOTHING;