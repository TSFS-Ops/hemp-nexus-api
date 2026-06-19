
-- ============================================================
-- Public API V1 · Batch 11 — Support ticket intake & status visibility
-- ============================================================
-- Adds api_support_tickets table, secure access RPCs, audit
-- events, and wires the Batch 9 internal monitoring dashboard's
-- open_support_tickets field to real data.
--
-- HARD EXCLUSIONS (Batch 11):
--   • No payment collection / invoices / tax logic.
--   • No PayFast / Paystack changes.
--   • No webhook changes.
--   • No write API on the public gateway (intake is in-product only).
--   • No new public API business endpoints.
--   • No evidence / document downloads. No file uploads.
--   • No POI / WaD / payment / credit / compliance / verification
--     decisions.
--   • No raw API key, key-hash, or secret material is read, written,
--     stored, audited, or returned by any function in this migration.
-- ============================================================

-- ─── Table ────────────────────────────────────────────────────────────
CREATE TABLE public.api_support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_client_id uuid NOT NULL REFERENCES public.api_clients(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  created_by uuid NOT NULL,
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 4 AND 200),
  environment text NOT NULL CHECK (environment IN ('sandbox','production','unspecified')),
  severity text NOT NULL CHECK (severity IN ('low','medium','high','urgent')),
  category text NOT NULL CHECK (category IN (
    'authentication','sandbox','production','rate_limit','monthly_limit',
    'unexpected_response','outage_or_degradation','billing_visibility',
    'documentation','other'
  )),
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 8000),
  contact_name text NOT NULL CHECK (char_length(contact_name) BETWEEN 1 AND 200),
  contact_email text NOT NULL CHECK (contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  request_id text CHECK (request_id IS NULL OR char_length(request_id) <= 128),
  endpoint text CHECK (endpoint IS NULL OR char_length(endpoint) <= 200),
  external_reference text CHECK (external_reference IS NULL OR char_length(external_reference) <= 128),
  approximate_time timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN (
    'open','triaged','in_progress','waiting_on_client','resolved','closed'
  )),
  internal_owner uuid,
  internal_notes text,
  client_visible_response text,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_support_tickets_client      ON public.api_support_tickets(api_client_id);
CREATE INDEX idx_api_support_tickets_org         ON public.api_support_tickets(org_id);
CREATE INDEX idx_api_support_tickets_status      ON public.api_support_tickets(status);
CREATE INDEX idx_api_support_tickets_created_by  ON public.api_support_tickets(created_by);
CREATE INDEX idx_api_support_tickets_env         ON public.api_support_tickets(environment);

GRANT SELECT, INSERT, UPDATE ON public.api_support_tickets TO authenticated;
GRANT ALL ON public.api_support_tickets TO service_role;

ALTER TABLE public.api_support_tickets ENABLE ROW LEVEL SECURITY;

-- Direct table access is restricted to INTERNAL roles only. Client users
-- never see the raw table — they must use the SECURITY DEFINER RPCs
-- below, which strip internal_notes / internal_owner before returning.
CREATE POLICY "Internal API roles read all support tickets"
  ON public.api_support_tickets FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'api_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  );

CREATE POLICY "Platform/API admins manage support tickets"
  ON public.api_support_tickets FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'api_admin'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'api_admin'::public.app_role)
  );

-- No INSERT policy: insertion is performed exclusively via the
-- create_api_support_ticket SECURITY DEFINER RPC.

-- ─── updated_at trigger ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_api_support_tickets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_api_support_tickets_updated_at
BEFORE UPDATE ON public.api_support_tickets
FOR EACH ROW EXECUTE FUNCTION public.tg_api_support_tickets_updated_at();

-- ─── Authorisation helper for client-side access ───────────────────────
CREATE OR REPLACE FUNCTION public.can_manage_api_client_support(
  _user_id uuid,
  _api_client_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.api_clients c
    WHERE c.id = _api_client_id
      AND (
        public.has_role(_user_id, 'platform_admin'::public.app_role)
        OR public.has_role(_user_id, 'api_admin'::public.app_role)
        OR public.has_role(_user_id, 'auditor'::public.app_role)
        OR public.is_org_admin(_user_id, c.org_id)
      )
  )
$$;
GRANT EXECUTE ON FUNCTION public.can_manage_api_client_support(uuid, uuid) TO authenticated;

-- ─── Client-facing JSON shape (no internal fields) ─────────────────────
CREATE OR REPLACE FUNCTION public.public_api_support_ticket_client_shape(
  t public.api_support_tickets
)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', t.id,
    'api_client_id', t.api_client_id,
    'subject', t.subject,
    'environment', t.environment,
    'severity', t.severity,
    'category', t.category,
    'description', t.description,
    'contact_name', t.contact_name,
    'contact_email', t.contact_email,
    'request_id', t.request_id,
    'endpoint', t.endpoint,
    'external_reference', t.external_reference,
    'approximate_time', t.approximate_time,
    'status', t.status,
    'client_visible_response', t.client_visible_response,
    'resolved_at', t.resolved_at,
    'closed_at', t.closed_at,
    'created_at', t.created_at,
    'updated_at', t.updated_at
  )
$$;

-- Internal JSON shape (includes internal fields).
CREATE OR REPLACE FUNCTION public.public_api_support_ticket_internal_shape(
  t public.api_support_tickets
)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT public.public_api_support_ticket_client_shape(t)
    || jsonb_build_object(
      'org_id', t.org_id,
      'created_by', t.created_by,
      'internal_owner', t.internal_owner,
      'internal_notes', t.internal_notes
    )
$$;

-- ─── Create ticket (client/internal) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_api_support_ticket(
  p_api_client_id uuid,
  p_subject text,
  p_environment text,
  p_severity text,
  p_category text,
  p_description text,
  p_contact_name text,
  p_contact_email text,
  p_request_id text DEFAULT NULL,
  p_endpoint text DEFAULT NULL,
  p_external_reference text DEFAULT NULL,
  p_approximate_time timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_ticket public.api_support_tickets%ROWTYPE;
  v_admin_uid uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_manage_api_client_support(v_uid, p_api_client_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Auditors are read-only, never raise.
  IF public.has_role(v_uid, 'auditor'::public.app_role)
     AND NOT public.has_role(v_uid, 'platform_admin'::public.app_role)
     AND NOT public.has_role(v_uid, 'api_admin'::public.app_role)
     AND NOT EXISTS (
       SELECT 1 FROM public.api_clients c
       WHERE c.id = p_api_client_id AND public.is_org_admin(v_uid, c.org_id)
     )
  THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO v_org FROM public.api_clients WHERE id = p_api_client_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'api_client_not_found' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.api_support_tickets (
    api_client_id, org_id, created_by, subject, environment, severity,
    category, description, contact_name, contact_email,
    request_id, endpoint, external_reference, approximate_time
  )
  VALUES (
    p_api_client_id, v_org, v_uid, p_subject, p_environment, p_severity,
    p_category, p_description, p_contact_name, p_contact_email,
    p_request_id, p_endpoint, p_external_reference, p_approximate_time
  )
  RETURNING * INTO v_ticket;

  -- Audit
  INSERT INTO public.audit_logs (action, entity_type, entity_id, actor_user_id, org_id, metadata)
  VALUES (
    'public_api.v1.support.ticket_created',
    'api_support_ticket',
    v_ticket.id,
    v_uid,
    v_org,
    jsonb_build_object(
      'api_client_id', p_api_client_id,
      'environment', p_environment,
      'severity', p_severity,
      'category', p_category,
      'has_request_id', p_request_id IS NOT NULL,
      'has_endpoint', p_endpoint IS NOT NULL
    )
  );

  -- Notify internal API support owners on high/urgent.
  IF p_severity IN ('high','urgent') THEN
    FOR v_admin_uid IN
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      WHERE ur.role IN ('platform_admin'::public.app_role, 'api_admin'::public.app_role)
    LOOP
      INSERT INTO public.notifications (user_id, org_id, type, title, body, entity_type, entity_id, link)
      VALUES (
        v_admin_uid,
        v_org,
        'api_support.ticket_created',
        'New ' || p_severity || ' API support ticket',
        left(p_subject, 200),
        'api_support_ticket',
        v_ticket.id,
        '/hq/organisations?sub=api-support&ticket=' || v_ticket.id::text
      );
    END LOOP;
  END IF;

  RETURN public.public_api_support_ticket_client_shape(v_ticket);
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_api_support_ticket(
  uuid, text, text, text, text, text, text, text, text, text, text, timestamptz
) TO authenticated;

-- ─── List tickets for a client (client-facing) ─────────────────────────
CREATE OR REPLACE FUNCTION public.list_api_support_tickets_for_client(
  p_api_client_id uuid,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_manage_api_client_support(v_uid, p_api_client_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT public.public_api_support_ticket_client_shape(t)
  FROM public.api_support_tickets t
  WHERE t.api_client_id = p_api_client_id
    AND (p_status IS NULL OR t.status = p_status)
  ORDER BY t.created_at DESC
  LIMIT GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_api_support_tickets_for_client(uuid, text, integer) TO authenticated;

-- ─── Internal list (HQ panel) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_api_support_tickets_internal(
  p_status text DEFAULT NULL,
  p_severity text DEFAULT NULL,
  p_environment text DEFAULT NULL,
  p_api_client_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.has_role(v_uid, 'platform_admin'::public.app_role)
    OR public.has_role(v_uid, 'api_admin'::public.app_role)
    OR public.has_role(v_uid, 'auditor'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT public.public_api_support_ticket_internal_shape(t)
  FROM public.api_support_tickets t
  WHERE (p_status IS NULL OR t.status = p_status)
    AND (p_severity IS NULL OR t.severity = p_severity)
    AND (p_environment IS NULL OR t.environment = p_environment)
    AND (p_api_client_id IS NULL OR t.api_client_id = p_api_client_id)
  ORDER BY
    CASE t.severity WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
    t.created_at DESC
  LIMIT GREATEST(LEAST(COALESCE(p_limit, 200), 1000), 1);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_api_support_tickets_internal(text, text, text, uuid, integer) TO authenticated;

-- ─── Update ticket (internal triage actions) ───────────────────────────
CREATE OR REPLACE FUNCTION public.update_api_support_ticket_internal(
  p_id uuid,
  p_status text DEFAULT NULL,
  p_internal_owner uuid DEFAULT NULL,
  p_internal_note_append text DEFAULT NULL,
  p_client_visible_response text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prev public.api_support_tickets%ROWTYPE;
  v_next public.api_support_tickets%ROWTYPE;
  v_new_notes text;
  v_resolved_at timestamptz;
  v_closed_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.has_role(v_uid, 'platform_admin'::public.app_role)
    OR public.has_role(v_uid, 'api_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prev FROM public.api_support_tickets WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_not_found' USING ERRCODE = '22023';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN (
    'open','triaged','in_progress','waiting_on_client','resolved','closed'
  ) THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  v_resolved_at := v_prev.resolved_at;
  v_closed_at   := v_prev.closed_at;
  IF p_status = 'resolved' AND v_prev.resolved_at IS NULL THEN
    v_resolved_at := now();
  END IF;
  IF p_status = 'closed' AND v_prev.closed_at IS NULL THEN
    v_closed_at := now();
  END IF;

  v_new_notes := v_prev.internal_notes;
  IF p_internal_note_append IS NOT NULL AND length(trim(p_internal_note_append)) > 0 THEN
    v_new_notes := COALESCE(v_prev.internal_notes || E'\n\n', '')
                   || '['|| to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')||' UTC · '||v_uid::text||'] '
                   || p_internal_note_append;
  END IF;

  UPDATE public.api_support_tickets SET
    status                  = COALESCE(p_status, status),
    internal_owner          = COALESCE(p_internal_owner, internal_owner),
    internal_notes          = v_new_notes,
    client_visible_response = COALESCE(p_client_visible_response, client_visible_response),
    resolved_at             = v_resolved_at,
    closed_at               = v_closed_at
  WHERE id = p_id
  RETURNING * INTO v_next;

  -- Audit per change
  IF p_status IS NOT NULL AND p_status IS DISTINCT FROM v_prev.status THEN
    INSERT INTO public.audit_logs (action, entity_type, entity_id, actor_user_id, org_id, metadata)
    VALUES ('public_api.v1.support.ticket_status_changed','api_support_ticket', p_id, v_uid, v_prev.org_id,
      jsonb_build_object('from', v_prev.status, 'to', p_status));
    IF p_status = 'resolved' THEN
      INSERT INTO public.audit_logs (action, entity_type, entity_id, actor_user_id, org_id, metadata)
      VALUES ('public_api.v1.support.ticket_resolved','api_support_ticket', p_id, v_uid, v_prev.org_id,
        jsonb_build_object('resolved_at', v_resolved_at));
    ELSIF p_status = 'closed' THEN
      INSERT INTO public.audit_logs (action, entity_type, entity_id, actor_user_id, org_id, metadata)
      VALUES ('public_api.v1.support.ticket_closed','api_support_ticket', p_id, v_uid, v_prev.org_id,
        jsonb_build_object('closed_at', v_closed_at));
    END IF;
  END IF;
  IF p_internal_owner IS NOT NULL AND p_internal_owner IS DISTINCT FROM v_prev.internal_owner THEN
    INSERT INTO public.audit_logs (action, entity_type, entity_id, actor_user_id, org_id, metadata)
    VALUES ('public_api.v1.support.internal_owner_assigned','api_support_ticket', p_id, v_uid, v_prev.org_id,
      jsonb_build_object('from', v_prev.internal_owner, 'to', p_internal_owner));
  END IF;
  IF p_internal_note_append IS NOT NULL AND length(trim(p_internal_note_append)) > 0 THEN
    INSERT INTO public.audit_logs (action, entity_type, entity_id, actor_user_id, org_id, metadata)
    VALUES ('public_api.v1.support.internal_note_added','api_support_ticket', p_id, v_uid, v_prev.org_id,
      jsonb_build_object('length', length(p_internal_note_append)));
  END IF;
  IF p_client_visible_response IS NOT NULL
     AND p_client_visible_response IS DISTINCT FROM COALESCE(v_prev.client_visible_response,'') THEN
    INSERT INTO public.audit_logs (action, entity_type, entity_id, actor_user_id, org_id, metadata)
    VALUES ('public_api.v1.support.client_visible_response_updated','api_support_ticket', p_id, v_uid, v_prev.org_id,
      jsonb_build_object('length', length(p_client_visible_response)));
  END IF;

  -- Notify ticket creator on status / client-visible-response change.
  IF (p_status IS NOT NULL AND p_status IS DISTINCT FROM v_prev.status)
     OR (p_client_visible_response IS NOT NULL
         AND p_client_visible_response IS DISTINCT FROM COALESCE(v_prev.client_visible_response,''))
  THEN
    INSERT INTO public.notifications (user_id, org_id, type, title, body, entity_type, entity_id, link)
    VALUES (
      v_prev.created_by,
      v_prev.org_id,
      'api_support.ticket_updated',
      'API support ticket update',
      'Ticket "' || left(v_prev.subject,160) || '" is now ' || v_next.status || '.',
      'api_support_ticket',
      v_prev.id,
      '/developer/support?ticket=' || v_prev.id::text
    );
  END IF;

  RETURN public.public_api_support_ticket_internal_shape(v_next);
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_api_support_ticket_internal(uuid, text, uuid, text, text) TO authenticated;

-- ─── Monitoring wiring: real open ticket counts ────────────────────────
-- Re-creates get_api_monitoring_overview from Batch 9 with one change:
-- 'open_support_tickets' is now sourced from api_support_tickets.
CREATE OR REPLACE FUNCTION public.get_api_monitoring_overview(
  p_period_start timestamptz DEFAULT date_trunc('month', now() AT TIME ZONE 'UTC'),
  p_environment text DEFAULT NULL,
  p_status_label text DEFAULT NULL,
  p_api_client_id uuid DEFAULT NULL,
  p_plan_id uuid DEFAULT NULL,
  p_min_usage_pct numeric DEFAULT NULL,
  p_errors_only boolean DEFAULT false
)
RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_period_start timestamptz := date_trunc('month', p_period_start AT TIME ZONE 'UTC');
  v_period_end   timestamptz := v_period_start + interval '1 month';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_api_monitoring(v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      c.id AS api_client_id,
      c.legal_entity_name,
      c.status AS client_status,
      c.org_id,
      l.environment,
      l.status_code,
      l.error_code,
      l.response_time_ms,
      l.billable,
      l.created_at,
      l.api_key_id
    FROM public.api_clients c
    LEFT JOIN public.api_request_logs l
      ON l.api_client_id = c.id
     AND l.created_at >= v_period_start
     AND l.created_at <  v_period_end
     AND (p_environment IS NULL OR l.environment = p_environment)
    WHERE (p_api_client_id IS NULL OR c.id = p_api_client_id)
  ),
  per_env AS (
    SELECT
      api_client_id,
      legal_entity_name,
      client_status,
      org_id,
      COALESCE(environment,'sandbox') AS environment,
      COUNT(*) FILTER (WHERE created_at IS NOT NULL) AS total_requests,
      COUNT(*) FILTER (WHERE status_code >= 200 AND status_code < 400) AS success_count,
      COUNT(*) FILTER (WHERE status_code >= 400) AS error_count,
      COUNT(*) FILTER (WHERE billable IS TRUE AND status_code >= 200 AND status_code < 300) AS billable_count,
      COUNT(*) FILTER (WHERE error_code = 'rate_limit_exceeded') AS rate_limit_events,
      COUNT(*) FILTER (WHERE error_code = 'monthly_limit_reached') AS monthly_limit_events,
      COUNT(*) FILTER (WHERE error_code IN ('invalid_api_key','expired_api_key','suspended_key','revoked_key')) AS auth_failures,
      AVG(l.response_time_ms)::numeric AS avg_latency_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY l.response_time_ms) AS p95_latency_ms,
      MAX(created_at) FILTER (WHERE status_code >= 200 AND status_code < 400) AS last_success,
      MAX(created_at) FILTER (WHERE status_code >= 400) AS last_failure
    FROM base l
    GROUP BY api_client_id, legal_entity_name, client_status, org_id, COALESCE(environment,'sandbox')
  ),
  top_err AS (
    SELECT api_client_id, environment, error_code, COUNT(*) AS n,
      ROW_NUMBER() OVER (PARTITION BY api_client_id, environment ORDER BY COUNT(*) DESC) AS rn
    FROM base
    WHERE error_code IS NOT NULL
    GROUP BY api_client_id, environment, error_code
  ),
  keys AS (
    SELECT api_client_id,
      COUNT(*) AS key_count,
      COUNT(*) FILTER (WHERE status = 'active') AS active_keys,
      COUNT(*) FILTER (WHERE status IN ('suspended','revoked')) AS revoked_keys,
      COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < now()) AS expired_keys,
      MIN(expires_at) FILTER (WHERE expires_at > now() AND status='active') AS next_expiry
    FROM public.api_keys
    GROUP BY api_client_id
  ),
  ip_excs AS (
    SELECT api_client_id, bool_or(true) AS ip_exception_active
    FROM public.api_ip_allowlist_exceptions
    WHERE expires_at IS NULL OR expires_at > now()
    GROUP BY api_client_id
  ),
  plan_assign AS (
    SELECT api_client_id, plan_id
    FROM public.api_client_plan_assignments
    WHERE (effective_until IS NULL OR effective_until > now())
  ),
  open_tickets AS (
    SELECT api_client_id, environment, COUNT(*)::integer AS n_open
    FROM public.api_support_tickets
    WHERE status IN ('open','triaged','in_progress','waiting_on_client')
    GROUP BY api_client_id, environment
  ),
  labelled AS (
    SELECT pe.*,
      (SELECT error_code FROM top_err te WHERE te.api_client_id = pe.api_client_id AND te.environment = pe.environment AND te.rn = 1) AS top_error_code,
      CASE WHEN pe.total_requests > 0
        THEN ROUND((pe.success_count::numeric / pe.total_requests) * 100, 2)
        ELSE NULL END AS success_rate_pct,
      k.key_count, k.active_keys, k.revoked_keys, k.expired_keys, k.next_expiry,
      COALESCE(ix.ip_exception_active, false) AS ip_exception_active,
      pa.plan_id,
      CASE WHEN pe.total_requests = 0 THEN NULL ELSE pe.billable_count END AS billable_calls,
      NULL::integer AS allowance,
      NULL::numeric AS allowance_used_pct,
      0::integer AS overage_calls,
      NULL::text AS currency,
      0::numeric AS estimated_total_amount,
      COALESCE((SELECT n_open FROM open_tickets ot
                 WHERE ot.api_client_id = pe.api_client_id
                   AND ot.environment = pe.environment), 0) AS open_support_tickets,
      CASE
        WHEN pe.client_status = 'suspended' THEN 'suspended'
        WHEN pe.client_status = 'revoked'   THEN 'blocked'
        WHEN pe.total_requests = 0          THEN 'no_recent_traffic'
        WHEN pe.error_count > 0 AND pe.success_count = 0 THEN 'blocked'
        WHEN pe.rate_limit_events > 0 OR pe.monthly_limit_events > 0 OR pe.auth_failures > 0 THEN 'warning'
        WHEN pe.error_count > 0             THEN 'needs_attention'
        ELSE 'healthy'
      END AS status_label
    FROM per_env pe
    LEFT JOIN keys k ON k.api_client_id = pe.api_client_id
    LEFT JOIN ip_excs ix ON ix.api_client_id = pe.api_client_id
    LEFT JOIN plan_assign pa ON pa.api_client_id = pe.api_client_id
  )
  SELECT jsonb_build_object(
    'api_client_id', api_client_id,
    'legal_entity_name', legal_entity_name,
    'client_status', client_status,
    'org_id', org_id,
    'plan_id', plan_id,
    'environment', environment,
    'total_requests', total_requests,
    'success_count', success_count,
    'error_count', error_count,
    'billable_calls', billable_calls,
    'allowance', allowance,
    'allowance_used_pct', allowance_used_pct,
    'overage_calls', overage_calls,
    'estimated_total_amount', estimated_total_amount,
    'currency', currency,
    'success_rate_pct', success_rate_pct,
    'top_error_code', top_error_code,
    'avg_latency_ms', avg_latency_ms,
    'p95_latency_ms', p95_latency_ms,
    'rate_limit_events', rate_limit_events,
    'monthly_limit_events', monthly_limit_events,
    'failed_auth_attempts', auth_failures,
    'key_count', COALESCE(key_count, 0),
    'active_key_count', COALESCE(active_keys, 0),
    'suspended_revoked_key_count', COALESCE(revoked_keys, 0),
    'expired_key_count', COALESCE(expired_keys, 0),
    'next_key_expiry', next_expiry,
    'key_expiry_warning', (next_expiry IS NOT NULL AND next_expiry < (now() + interval '14 days')),
    'ip_allowlist_exception_active', ip_exception_active,
    'last_successful_call', last_success,
    'last_failed_call', last_failure,
    'open_support_tickets', open_support_tickets,
    'open_support_tickets_status', 'live_from_api_support_tickets',
    'status_label', status_label,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'generated_at', now()
  )
  FROM labelled
  WHERE (p_status_label IS NULL OR status_label = p_status_label)
    AND (p_plan_id IS NULL OR plan_id = p_plan_id)
    AND (p_min_usage_pct IS NULL OR (allowance_used_pct IS NOT NULL AND allowance_used_pct >= p_min_usage_pct))
    AND (p_errors_only = false OR error_count > 0)
  ORDER BY status_label, legal_entity_name, environment;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_api_monitoring_overview(timestamptz, text, text, uuid, uuid, numeric, boolean) TO authenticated;
