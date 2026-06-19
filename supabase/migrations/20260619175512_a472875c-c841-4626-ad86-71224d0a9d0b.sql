
-- ============================================================
-- API Usage Dashboard · Batch 4 — Alerts & Suspicious Activity
-- Internal-only. Reuses can_access_api_monitoring gate.
-- ============================================================

-- 1. Table -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_usage_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  api_client_id uuid NULL REFERENCES public.api_clients(id) ON DELETE CASCADE,
  api_key_id uuid NULL REFERENCES public.api_keys(id) ON DELETE SET NULL,
  environment text NULL CHECK (environment IS NULL OR environment IN ('sandbox','production')),
  trigger_value numeric NULL,
  threshold_value numeric NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL,
  latest_note text NULL,
  acknowledged_by uuid NULL,
  acknowledged_at timestamptz NULL,
  resolved_by uuid NULL,
  resolved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_usage_alerts_dedupe_key_unique UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS api_usage_alerts_status_created_idx
  ON public.api_usage_alerts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS api_usage_alerts_client_idx
  ON public.api_usage_alerts(api_client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_usage_alerts_type_idx
  ON public.api_usage_alerts(alert_type, created_at DESC);

-- Hard guard: never store sensitive blobs in details
CREATE OR REPLACE FUNCTION public.api_usage_alerts_strip_sensitive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.details IS NULL THEN
    NEW.details := '{}'::jsonb;
  END IF;
  -- Strip well-known sensitive keys defensively
  NEW.details := NEW.details
    - 'request_body' - 'response_body'
    - 'api_key' - 'key_hash' - 'secret'
    - 'authorization' - 'stack' - 'stack_trace';
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_api_usage_alerts_strip ON public.api_usage_alerts;
CREATE TRIGGER trg_api_usage_alerts_strip
BEFORE INSERT OR UPDATE ON public.api_usage_alerts
FOR EACH ROW EXECUTE FUNCTION public.api_usage_alerts_strip_sensitive();

-- 2. Grants ----------------------------------------------------
-- All access is mediated by SECURITY DEFINER RPCs below; deny direct
-- table access from anon/authenticated. Only service_role gets DML.
GRANT ALL ON public.api_usage_alerts TO service_role;

-- 3. RLS -------------------------------------------------------
ALTER TABLE public.api_usage_alerts ENABLE ROW LEVEL SECURITY;

-- Read policy: only users who pass can_access_api_monitoring.
DROP POLICY IF EXISTS "internal monitors read api usage alerts"
  ON public.api_usage_alerts;
CREATE POLICY "internal monitors read api usage alerts"
ON public.api_usage_alerts
FOR SELECT
TO authenticated
USING (public.can_access_api_monitoring(auth.uid()));

-- No INSERT/UPDATE/DELETE policies for authenticated → all writes go
-- through SECURITY DEFINER RPCs (service_role context).

-- 4. RPC: detect_api_usage_alerts ------------------------------
CREATE OR REPLACE FUNCTION public.detect_api_usage_alerts()
RETURNS TABLE(inserted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inserted integer := 0;
  v_now timestamptz := now();
  v_window_15m timestamptz := now() - interval '15 minutes';
  v_window_10m timestamptz := now() - interval '10 minutes';
  v_window_1h  timestamptz := now() - interval '1 hour';
BEGIN
  -- Allow service_role (no auth) or platform_admin to trigger detection.
  IF v_uid IS NOT NULL AND NOT public.can_access_api_monitoring(v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- 4a. High error rate (>5% over last 15m, min 20 calls) per client+env
  INSERT INTO public.api_usage_alerts
    (alert_type, severity, api_client_id, environment, trigger_value, threshold_value, details, dedupe_key)
  SELECT
    'high_error_rate',
    'warning',
    l.api_client_id,
    l.environment,
    round((sum(CASE WHEN l.status_code >= 400 THEN 1 ELSE 0 END)::numeric
           / nullif(count(*),0)) * 100, 2),
    5,
    jsonb_build_object(
      'window_minutes', 15,
      'total_calls', count(*),
      'error_calls', sum(CASE WHEN l.status_code >= 400 THEN 1 ELSE 0 END)
    ),
    'high_error_rate:' || coalesce(l.api_client_id::text,'null') || ':'
      || coalesce(l.environment,'null') || ':'
      || to_char(date_trunc('hour', v_now), 'YYYYMMDDHH24')
      || ':' || lpad((extract(minute from v_now)::int / 15)::text, 1, '0')
  FROM public.api_request_logs l
  WHERE l.created_at >= v_window_15m
    AND l.api_client_id IS NOT NULL
  GROUP BY l.api_client_id, l.environment
  HAVING count(*) >= 20
     AND (sum(CASE WHEN l.status_code >= 400 THEN 1 ELSE 0 END)::numeric
          / nullif(count(*),0)) > 0.05
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- 4b. Internal-error burst (>10 5xx in 15m) per client+env
  WITH ins AS (
    INSERT INTO public.api_usage_alerts
      (alert_type, severity, api_client_id, environment, trigger_value, threshold_value, details, dedupe_key)
    SELECT
      'internal_error_burst',
      'critical',
      l.api_client_id,
      l.environment,
      count(*),
      10,
      jsonb_build_object('window_minutes', 15, 'count_5xx', count(*)),
      'internal_error_burst:' || coalesce(l.api_client_id::text,'null') || ':'
        || coalesce(l.environment,'null') || ':'
        || to_char(date_trunc('hour', v_now), 'YYYYMMDDHH24')
        || ':' || lpad((extract(minute from v_now)::int / 15)::text, 1, '0')
    FROM public.api_request_logs l
    WHERE l.created_at >= v_window_15m
      AND l.status_code >= 500
    GROUP BY l.api_client_id, l.environment
    HAVING count(*) > 10
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT v_inserted + count(*) INTO v_inserted FROM ins;

  -- 4c. Repeated failed auth: 5 in 10m or 20 in 1h
  WITH ins AS (
    INSERT INTO public.api_usage_alerts
      (alert_type, severity, api_client_id, environment, trigger_value, threshold_value, details, dedupe_key)
    SELECT
      'repeated_failed_auth_10m',
      'warning',
      l.api_client_id,
      l.environment,
      count(*),
      5,
      jsonb_build_object('window_minutes', 10, 'failures', count(*)),
      'failed_auth_10m:' || coalesce(l.api_client_id::text,'null') || ':'
        || coalesce(l.environment,'null') || ':'
        || to_char(date_trunc('hour', v_now), 'YYYYMMDDHH24')
        || ':' || lpad((extract(minute from v_now)::int / 10)::text, 1, '0')
    FROM public.api_request_logs l
    WHERE l.created_at >= v_window_10m
      AND l.status_code = 401
    GROUP BY l.api_client_id, l.environment
    HAVING count(*) >= 5
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT v_inserted + count(*) INTO v_inserted FROM ins;

  -- 4d. Rate-limit hits (>10 429s in 15m)
  WITH ins AS (
    INSERT INTO public.api_usage_alerts
      (alert_type, severity, api_client_id, environment, trigger_value, threshold_value, details, dedupe_key)
    SELECT
      'rate_limit_hits',
      'warning',
      l.api_client_id,
      l.environment,
      count(*),
      10,
      jsonb_build_object('window_minutes', 15, 'count_429', count(*)),
      'rate_limit_hits:' || coalesce(l.api_client_id::text,'null') || ':'
        || coalesce(l.environment,'null') || ':'
        || to_char(date_trunc('hour', v_now), 'YYYYMMDDHH24')
        || ':' || lpad((extract(minute from v_now)::int / 15)::text, 1, '0')
    FROM public.api_request_logs l
    WHERE l.created_at >= v_window_15m
      AND l.status_code = 429
    GROUP BY l.api_client_id, l.environment
    HAVING count(*) > 10
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT v_inserted + count(*) INTO v_inserted FROM ins;

  -- 4e. Production key expiring soon / expired
  WITH ins AS (
    INSERT INTO public.api_usage_alerts
      (alert_type, severity, api_client_id, api_key_id, environment, trigger_value, threshold_value, details, dedupe_key)
    SELECT
      CASE
        WHEN k.expires_at <= v_now THEN 'production_key_expired'
        WHEN k.expires_at <= v_now + interval '1 day' THEN 'production_key_expiring_1d'
        WHEN k.expires_at <= v_now + interval '7 days' THEN 'production_key_expiring_7d'
        ELSE 'production_key_expiring_14d'
      END,
      CASE
        WHEN k.expires_at <= v_now + interval '1 day' THEN 'critical'
        WHEN k.expires_at <= v_now + interval '7 days' THEN 'warning'
        ELSE 'info'
      END,
      c.id,
      k.id,
      'production',
      extract(epoch from (k.expires_at - v_now)) / 86400,
      14,
      jsonb_build_object('expires_at', k.expires_at, 'key_alias', k.name),
      'prod_key_expiry:' || k.id::text || ':' ||
        CASE
          WHEN k.expires_at <= v_now THEN 'expired'
          WHEN k.expires_at <= v_now + interval '1 day' THEN '1d'
          WHEN k.expires_at <= v_now + interval '7 days' THEN '7d'
          ELSE '14d'
        END
    FROM public.api_keys k
    JOIN public.api_clients c ON c.org_id = k.org_id
    WHERE k.environment = 'production'
      AND k.status = 'active'
      AND k.expires_at IS NOT NULL
      AND k.expires_at <= v_now + interval '14 days'
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT v_inserted + count(*) INTO v_inserted FROM ins;

  -- 4f. Revoked/suspended key attempts (401/403 against keys whose status != active)
  WITH ins AS (
    INSERT INTO public.api_usage_alerts
      (alert_type, severity, api_client_id, api_key_id, environment, trigger_value, threshold_value, details, dedupe_key)
    SELECT
      'revoked_or_suspended_key_attempt',
      'critical',
      l.api_client_id,
      l.api_key_id,
      l.environment,
      count(*),
      1,
      jsonb_build_object('window_minutes', 60, 'attempts', count(*), 'key_status', k.status),
      'revoked_key_attempt:' || coalesce(l.api_key_id::text,'null') || ':'
        || to_char(date_trunc('hour', v_now), 'YYYYMMDDHH24')
    FROM public.api_request_logs l
    JOIN public.api_keys k ON k.id = l.api_key_id
    WHERE l.created_at >= v_window_1h
      AND l.api_key_id IS NOT NULL
      AND k.status IN ('revoked','suspended','expired')
    GROUP BY l.api_client_id, l.api_key_id, l.environment, k.status
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT v_inserted + count(*) INTO v_inserted FROM ins;

  RETURN QUERY SELECT v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.detect_api_usage_alerts() TO authenticated;

-- 5. RPC: list_api_usage_alerts --------------------------------
CREATE OR REPLACE FUNCTION public.list_api_usage_alerts(
  p_status text DEFAULT NULL,        -- open|acknowledged|resolved|NULL=all
  p_environment text DEFAULT NULL,
  p_severity text DEFAULT NULL,
  p_api_client_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.can_access_api_monitoring(v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', a.id,
    'alert_type', a.alert_type,
    'severity', a.severity,
    'status', a.status,
    'api_client_id', a.api_client_id,
    'api_client_name', c.client_name,
    'api_key_id', a.api_key_id,
    'api_key_alias', k.name,
    'environment', a.environment,
    'trigger_value', a.trigger_value,
    'threshold_value', a.threshold_value,
    'details', a.details,
    'latest_note', a.latest_note,
    'acknowledged_by', a.acknowledged_by,
    'acknowledged_at', a.acknowledged_at,
    'resolved_by', a.resolved_by,
    'resolved_at', a.resolved_at,
    'created_at', a.created_at,
    'updated_at', a.updated_at
  )
  FROM public.api_usage_alerts a
  LEFT JOIN public.api_clients c ON c.id = a.api_client_id
  LEFT JOIN public.api_keys k ON k.id = a.api_key_id
  WHERE (p_status IS NULL OR a.status = p_status)
    AND (p_environment IS NULL OR a.environment = p_environment)
    AND (p_severity IS NULL OR a.severity = p_severity)
    AND (p_api_client_id IS NULL OR a.api_client_id = p_api_client_id)
  ORDER BY
    CASE a.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
    CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
    a.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 200), 1000));
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_api_usage_alerts(text,text,text,uuid,integer) TO authenticated;

-- 6. Mutation RPCs (platform_admin only) -----------------------
CREATE OR REPLACE FUNCTION public.acknowledge_api_usage_alert(
  p_alert_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'platform_admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.api_usage_alerts
     SET status = 'acknowledged',
         acknowledged_by = v_uid,
         acknowledged_at = now(),
         latest_note = COALESCE(left(p_note, 1000), latest_note)
   WHERE id = p_alert_id
     AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'alert not found or not open' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.admin_audit_logs(admin_user_id, action, target_type, target_id, details)
  VALUES (v_uid, 'api_usage_alert.acknowledged', 'api_usage_alert', p_alert_id,
          jsonb_build_object('note_present', p_note IS NOT NULL));

  RETURN jsonb_build_object('id', p_alert_id, 'status', 'acknowledged');
END;
$$;
GRANT EXECUTE ON FUNCTION public.acknowledge_api_usage_alert(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_api_usage_alert(
  p_alert_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'platform_admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.api_usage_alerts
     SET status = 'resolved',
         resolved_by = v_uid,
         resolved_at = now(),
         latest_note = COALESCE(left(p_note, 1000), latest_note)
   WHERE id = p_alert_id
     AND status IN ('open','acknowledged');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'alert not found or already resolved' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.admin_audit_logs(admin_user_id, action, target_type, target_id, details)
  VALUES (v_uid, 'api_usage_alert.resolved', 'api_usage_alert', p_alert_id,
          jsonb_build_object('note_present', p_note IS NOT NULL));

  RETURN jsonb_build_object('id', p_alert_id, 'status', 'resolved');
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_api_usage_alert(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_api_usage_alert_note(
  p_alert_id uuid,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'platform_admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) = 0 THEN
    RAISE EXCEPTION 'note required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.api_usage_alerts
     SET latest_note = left(p_note, 1000)
   WHERE id = p_alert_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'alert not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.admin_audit_logs(admin_user_id, action, target_type, target_id, details)
  VALUES (v_uid, 'api_usage_alert.note_added', 'api_usage_alert', p_alert_id,
          jsonb_build_object('note_length', length(p_note)));

  RETURN jsonb_build_object('id', p_alert_id, 'status', 'note_added');
END;
$$;
GRANT EXECUTE ON FUNCTION public.add_api_usage_alert_note(uuid,text) TO authenticated;

COMMENT ON TABLE public.api_usage_alerts IS
'Batch 4 — Internal API usage alerts & suspicious-activity flags. Read-gated by can_access_api_monitoring; mutations restricted to platform_admin via SECURITY DEFINER RPCs. Never stores payloads, full keys, secrets, or stack traces.';
