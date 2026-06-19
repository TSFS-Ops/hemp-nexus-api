
-- Public API V1 · Batch 8 — Client Usage Dashboard & CSV Export
-- RLS-safe SECURITY DEFINER RPCs. No new tables. No public API endpoint.
-- Access:
--   • platform_admin: view/export any api_client usage.
--   • api_admin, auditor: read-only view/export any api_client usage.
--   • Org admin of api_clients.org_id (via is_org_admin): view/export own client usage.
--   • Ordinary users: blocked.
-- Returns derived counters from api_request_logs ONLY. Never exposes
-- raw API keys, key hashes, other-client data, documents, evidence,
-- governance, POI/WaD/payment/compliance fields.

-- ─── Authorisation helper ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_view_api_client_usage(
  _user_id uuid,
  _api_client_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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

GRANT EXECUTE ON FUNCTION public.can_view_api_client_usage(uuid, uuid) TO authenticated;

-- ─── Usage summary (dashboard) ───────────────────────────────────────────
-- Returns a JSON document with all dashboard fields for one client and one
-- UTC-month billing period (p_period_start must be first day of month UTC).
CREATE OR REPLACE FUNCTION public.get_api_client_usage_summary(
  p_api_client_id uuid,
  p_period_start timestamptz DEFAULT date_trunc('month', now() AT TIME ZONE 'UTC')
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_period_start timestamptz := date_trunc('month', p_period_start AT TIME ZONE 'UTC');
  v_period_end   timestamptz := v_period_start + interval '1 month';
  v_client       public.api_clients%ROWTYPE;
  v_plan         jsonb := NULL;
  v_allowance    integer := 5000;
  v_overage_allowed boolean := false;
  v_overage_price numeric := 0;
  v_monthly_fee  numeric := 0;
  v_currency     text := NULL;
  v_plan_name    text := NULL;
  v_plan_id      uuid := NULL;

  v_total         integer := 0;
  v_lookups       integer := 0;
  v_summaries     integer := 0;
  v_billable      integer := 0;
  v_non_billable  integer := 0;
  v_sandbox       integer := 0;
  v_production    integer := 0;
  v_errors        integer := 0;
  v_rate_limited  integer := 0;
  v_last_success  timestamptz := NULL;
  v_last_failure  timestamptz := NULL;
  v_overage       integer := 0;
  v_est_overage   numeric := 0;
  v_est_total     numeric := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_view_api_client_usage(v_uid, p_api_client_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_client FROM public.api_clients WHERE id = p_api_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'api_client not found' USING ERRCODE = 'P0002';
  END IF;

  -- Active plan (if any)
  SELECT p.id, p.plan_name, p.currency, p.monthly_fee,
         p.included_lookup_allowance, p.overage_price_per_successful_lookup,
         p.overage_allowed
    INTO v_plan_id, v_plan_name, v_currency, v_monthly_fee,
         v_allowance, v_overage_price, v_overage_allowed
  FROM public.api_client_plan_assignments a
  JOIN public.api_commercial_plans p ON p.id = a.api_commercial_plan_id
  WHERE a.api_client_id = p_api_client_id
    AND a.active = true
    AND p.active = true
  ORDER BY a.assigned_at DESC
  LIMIT 1;

  IF v_plan_id IS NULL THEN
    v_allowance := 5000; v_overage_price := 0; v_monthly_fee := 0;
    v_currency := NULL; v_plan_name := NULL; v_overage_allowed := false;
  END IF;

  -- Aggregate from request logs scoped by client's keys
  WITH client_keys AS (
    SELECT id FROM public.api_keys WHERE api_client_id = p_api_client_id
  ),
  logs AS (
    SELECT * FROM public.api_request_logs
    WHERE api_key_id IN (SELECT id FROM client_keys)
      AND created_at >= v_period_start
      AND created_at <  v_period_end
  )
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE endpoint = '/v1/counterparty/lookup' AND error_code IS NULL)::int,
    COUNT(*) FILTER (WHERE endpoint = '/v1/counterparty/summary' AND error_code IS NULL)::int,
    COUNT(*) FILTER (WHERE billable = true)::int,
    COUNT(*) FILTER (WHERE COALESCE(billable, false) = false)::int,
    COUNT(*) FILTER (WHERE environment <> 'production')::int,
    COUNT(*) FILTER (WHERE environment = 'production')::int,
    COUNT(*) FILTER (WHERE error_code IS NOT NULL)::int,
    COUNT(*) FILTER (WHERE error_code = 'rate_limited' OR status_code = 429)::int,
    MAX(created_at) FILTER (WHERE error_code IS NULL),
    MAX(created_at) FILTER (WHERE error_code IS NOT NULL)
  INTO v_total, v_lookups, v_summaries, v_billable, v_non_billable,
       v_sandbox, v_production, v_errors, v_rate_limited,
       v_last_success, v_last_failure
  FROM logs;

  -- Billable production successful lookups/summaries → allowance basis
  SELECT COUNT(*)::int
    INTO v_billable
  FROM public.api_request_logs
  WHERE api_key_id IN (SELECT id FROM public.api_keys WHERE api_client_id = p_api_client_id)
    AND created_at >= v_period_start AND created_at < v_period_end
    AND environment = 'production'
    AND billable = true
    AND error_code IS NULL
    AND endpoint IN ('/v1/counterparty/lookup', '/v1/counterparty/summary');

  v_overage := GREATEST(0, v_billable - v_allowance);
  v_est_overage := ROUND((v_overage * v_overage_price)::numeric, 2);
  v_est_total   := ROUND((v_monthly_fee + v_est_overage)::numeric, 2);

  RETURN jsonb_build_object(
    'api_client_id', p_api_client_id,
    'api_client_name', v_client.client_name,
    'plan_id', v_plan_id,
    'plan_name', v_plan_name,
    'currency', v_currency,
    'monthly_fee', v_monthly_fee,
    'billing_period_start', v_period_start,
    'billing_period_end', v_period_end,
    'total_requests', v_total,
    'successful_lookup_calls', v_lookups,
    'successful_summary_calls', v_summaries,
    'billable_calls', v_billable,
    'non_billable_calls', v_non_billable,
    'sandbox_calls', v_sandbox,
    'production_calls', v_production,
    'error_count', v_errors,
    'rate_limit_events', v_rate_limited,
    'monthly_included_allowance', v_allowance,
    'allowance_used', LEAST(v_billable, v_allowance),
    'overage_calls', v_overage,
    'overage_allowed', v_overage_allowed,
    'estimated_overage_amount', v_est_overage,
    'estimated_total_amount', v_est_total,
    'usage_percentage',
      CASE WHEN v_allowance > 0
        THEN ROUND((v_billable::numeric / v_allowance::numeric) * 100, 2)
        ELSE NULL END,
    'last_successful_call', v_last_success,
    'last_failed_call', v_last_failure,
    'disclaimer', 'Usage and charges shown here are estimates for visibility only. This is not an invoice and does not collect payment.',
    'generated_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_api_client_usage_summary(uuid, timestamptz) TO authenticated;

-- ─── CSV rows (export) ───────────────────────────────────────────────────
-- Returns per-request rows scoped strictly to ONE api_client and selected
-- period, with NO raw key material, NO secrets, NO documents/evidence/POI/
-- WaD/payment/compliance fields, NO other clients' data.
CREATE OR REPLACE FUNCTION public.get_api_client_usage_csv_rows(
  p_api_client_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_environment text DEFAULT NULL,
  p_endpoint text DEFAULT NULL,
  p_status text DEFAULT NULL,     -- 'success' | 'error' | NULL
  p_billable text DEFAULT NULL    -- 'billable' | 'non_billable' | NULL
)
RETURNS TABLE (
  billing_period_start timestamptz,
  billing_period_end timestamptz,
  request_timestamp timestamptz,
  endpoint text,
  method text,
  environment text,
  status_code integer,
  billable boolean,
  error_code text,
  response_time_ms integer,
  external_reference text,
  request_id text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_view_api_client_usage(v_uid, p_api_client_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_period_end <= p_period_start THEN
    RAISE EXCEPTION 'invalid period' USING ERRCODE = '22023';
  END IF;
  IF (p_period_end - p_period_start) > interval '93 days' THEN
    RAISE EXCEPTION 'period too large (max 93 days)' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    p_period_start,
    p_period_end,
    l.created_at,
    l.endpoint,
    l.method,
    l.environment,
    l.status_code,
    l.billable,
    l.error_code,
    l.response_time_ms,
    l.external_reference,
    l.request_id::text
  FROM public.api_request_logs l
  WHERE l.api_key_id IN (
          SELECT id FROM public.api_keys WHERE api_client_id = p_api_client_id
        )
    AND l.created_at >= p_period_start
    AND l.created_at <  p_period_end
    AND (p_environment IS NULL OR l.environment = p_environment)
    AND (p_endpoint    IS NULL OR l.endpoint = p_endpoint)
    AND (p_status IS NULL
         OR (p_status = 'success' AND l.error_code IS NULL)
         OR (p_status = 'error'   AND l.error_code IS NOT NULL))
    AND (p_billable IS NULL
         OR (p_billable = 'billable'     AND l.billable = true)
         OR (p_billable = 'non_billable' AND COALESCE(l.billable, false) = false))
  ORDER BY l.created_at DESC
  LIMIT 50000;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_api_client_usage_csv_rows(uuid, timestamptz, timestamptz, text, text, text, text) TO authenticated;

-- ─── Audit logger for CSV export ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_api_client_usage_csv_export(
  p_api_client_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_row_count integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_view_api_client_usage(v_uid, p_api_client_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT org_id INTO v_org FROM public.api_clients WHERE id = p_api_client_id;

  INSERT INTO public.audit_logs (action, entity_type, entity_id, actor_id, org_id, metadata)
  VALUES (
    'public_api.v1.usage.csv_exported',
    'api_client',
    p_api_client_id,
    v_uid,
    v_org,
    jsonb_build_object(
      'api_client_id', p_api_client_id,
      'org_id', v_org,
      'period_start', p_period_start,
      'period_end', p_period_end,
      'row_count', COALESCE(p_row_count, 0),
      'exported_at', now()
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_api_client_usage_csv_export(uuid, timestamptz, timestamptz, integer) TO authenticated;
