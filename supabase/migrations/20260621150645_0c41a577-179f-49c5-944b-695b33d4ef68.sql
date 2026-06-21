
-- 1. Public/Admin registry search rate-limit buckets (per-IP and per-API-key).
CREATE TABLE public.registry_search_rate_limit_buckets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('ip','api_key','admin_user')),
  scope_key  TEXT NOT NULL,
  endpoint   TEXT NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX registry_search_rl_unique
  ON public.registry_search_rate_limit_buckets (scope_kind, scope_key, endpoint, window_end);
CREATE INDEX registry_search_rl_window_end ON public.registry_search_rate_limit_buckets (window_end);

GRANT ALL ON public.registry_search_rate_limit_buckets TO service_role;
ALTER TABLE public.registry_search_rate_limit_buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages registry search rl"
  ON public.registry_search_rate_limit_buckets FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Atomic check-and-increment for per-scope rate limit.
CREATE OR REPLACE FUNCTION public.atomic_check_registry_search_rate_limit(
  p_scope_kind TEXT,
  p_scope_key  TEXT,
  p_endpoint   TEXT,
  p_window_end TIMESTAMPTZ,
  p_limit      INTEGER
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO public.registry_search_rate_limit_buckets
    (scope_kind, scope_key, endpoint, window_end, request_count)
  VALUES (p_scope_kind, p_scope_key, p_endpoint, p_window_end, 0)
  ON CONFLICT (scope_kind, scope_key, endpoint, window_end) DO NOTHING;

  UPDATE public.registry_search_rate_limit_buckets
     SET request_count = request_count + 1
   WHERE scope_kind = p_scope_kind
     AND scope_key  = p_scope_key
     AND endpoint   = p_endpoint
     AND window_end = p_window_end
     AND request_count < p_limit
  RETURNING request_count INTO v_count;

  IF v_count IS NULL THEN RETURN -1; END IF;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.atomic_check_registry_search_rate_limit(TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atomic_check_registry_search_rate_limit(TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER) TO service_role;

-- 2. Claim lifecycle webhook outbox.
CREATE TABLE public.claim_lifecycle_webhook_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   TEXT NOT NULL,
  aggregate_id TEXT,
  aggregate_type TEXT,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id   TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','dispatching','sent','failed','dead_letter')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX claim_lifecycle_outbox_pending
  ON public.claim_lifecycle_webhook_outbox (status, next_attempt_at);
CREATE INDEX claim_lifecycle_outbox_event_type
  ON public.claim_lifecycle_webhook_outbox (event_type);

GRANT ALL ON public.claim_lifecycle_webhook_outbox TO service_role;
ALTER TABLE public.claim_lifecycle_webhook_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages claim lifecycle outbox"
  ON public.claim_lifecycle_webhook_outbox FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY "platform admins read claim lifecycle outbox"
  ON public.claim_lifecycle_webhook_outbox FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role));

-- Mapping of event_store event_name -> webhook event_type for Batch 7.
CREATE OR REPLACE FUNCTION public.batch7_event_name_to_webhook_event(p_event_name TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_event_name
    WHEN 'registry_company_claim_started'        THEN 'claim.evidence_required'
    WHEN 'registry_company_claim_submitted'      THEN 'claim.under_review'
    WHEN 'registry_company_claim_status_changed' THEN 'claim.status_changed'
    WHEN 'registry_company_claim_reviewed'       THEN 'claim.reviewed'
    WHEN 'registry_company_claim_evidence_added' THEN 'claim.evidence_added'
    WHEN 'registry_new_company_request_created'  THEN 'claim.new_company_requested'
    WHEN 'registry_new_company_request_reviewed' THEN 'claim.new_company_reviewed'
    WHEN 'registry_company_correction_request_created'  THEN 'claim.correction_requested'
    WHEN 'registry_company_correction_request_reviewed' THEN 'claim.correction_reviewed'
    WHEN 'registry_claim_conflict_opened'        THEN 'claim.conflict_created'
    WHEN 'registry_claim_conflict_resolved'      THEN 'claim.conflict_resolved'
    WHEN 'registry_outreach_blocked'             THEN 'claim.outreach_blocked'
    ELSE NULL
  END;
$$;

-- Trigger: when matching Batch 7 events are appended to event_store,
-- enqueue an outbox row. Never raises (best-effort).
CREATE OR REPLACE FUNCTION public.enqueue_claim_lifecycle_webhook()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event_type TEXT;
BEGIN
  v_event_type := public.batch7_event_name_to_webhook_event(NEW.event_name);
  IF v_event_type IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.claim_lifecycle_webhook_outbox
    (event_type, aggregate_id, aggregate_type, payload, request_id)
  VALUES (
    v_event_type,
    NEW.aggregate_id,
    NEW.aggregate_type,
    jsonb_build_object(
      'event_name', NEW.event_name,
      'aggregate_id', NEW.aggregate_id,
      'aggregate_type', NEW.aggregate_type,
      'occurred_at', NEW.created_at,
      'payload', COALESCE(NEW.payload, '{}'::jsonb)
    ),
    COALESCE(NEW.payload ->> 'request_id', NULL)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_claim_lifecycle_webhook ON public.event_store;
CREATE TRIGGER trg_enqueue_claim_lifecycle_webhook
AFTER INSERT ON public.event_store
FOR EACH ROW EXECUTE FUNCTION public.enqueue_claim_lifecycle_webhook();

-- 3. Admin-only audit export for Batch 7 decisions.
CREATE OR REPLACE FUNCTION public.admin_list_batch7_audit_events(
  p_from TIMESTAMPTZ DEFAULT (now() - INTERVAL '30 days'),
  p_to   TIMESTAMPTZ DEFAULT now(),
  p_limit INTEGER DEFAULT 500
) RETURNS TABLE (
  id UUID,
  event_name TEXT,
  aggregate_id TEXT,
  aggregate_type TEXT,
  actor_id UUID,
  payload JSONB,
  request_id TEXT,
  occurred_at TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT es.id, es.event_name, es.aggregate_id, es.aggregate_type, es.actor_id,
           es.payload, COALESCE(es.payload ->> 'request_id', NULL) AS request_id,
           es.created_at
      FROM public.event_store es
     WHERE es.created_at BETWEEN p_from AND p_to
       AND public.batch7_event_name_to_webhook_event(es.event_name) IS NOT NULL
     ORDER BY es.created_at DESC
     LIMIT LEAST(p_limit, 5000);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_batch7_audit_events(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_batch7_audit_events(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated, service_role;
