-- API Usage Dashboard V1 · Batch 2 — Platform Admin summary aggregation
-- Additive helper. Reuses existing can_access_api_monitoring gate.
-- Returns a single jsonb summary with cross-cutting totals + safe lists.
-- Never returns request/response bodies, IPs, user agents, keys or secrets.

CREATE OR REPLACE FUNCTION public.get_api_usage_dashboard_summary(
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today_start  timestamptz := date_trunc('day',   p_now AT TIME ZONE 'UTC');
  v_today_end    timestamptz := v_today_start + interval '1 day';
  v_month_start  timestamptz := date_trunc('month', p_now AT TIME ZONE 'UTC');
  v_month_end    timestamptz := v_month_start + interval '1 month';
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_api_monitoring(v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH
  today AS (
    SELECT
      COUNT(*)::int                                                AS calls,
      COUNT(*) FILTER (WHERE environment = 'production')::int      AS prod_calls,
      COUNT(*) FILTER (WHERE environment = 'sandbox')::int         AS sandbox_calls,
      COUNT(*) FILTER (WHERE billable = true)::int                 AS billable_calls,
      COUNT(*) FILTER (WHERE COALESCE(billable,false) = false)::int AS non_billable_calls,
      COUNT(*) FILTER (WHERE error_code IS NOT NULL)::int          AS error_count
    FROM public.api_request_logs
    WHERE created_at >= v_today_start AND created_at < v_today_end
  ),
  month AS (
    SELECT
      COUNT(*)::int                                                AS calls,
      COUNT(*) FILTER (WHERE environment = 'production')::int      AS prod_calls,
      COUNT(*) FILTER (WHERE environment = 'sandbox')::int         AS sandbox_calls,
      COUNT(*) FILTER (WHERE billable = true)::int                 AS billable_calls,
      COUNT(*) FILTER (WHERE COALESCE(billable,false) = false)::int AS non_billable_calls,
      COUNT(*) FILTER (WHERE error_code IS NOT NULL)::int          AS error_count,
      COUNT(*) FILTER (WHERE error_code = 'rate_limited' OR status_code = 429)::int AS rate_limit_events,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY response_time_ms)
        FILTER (WHERE response_time_ms IS NOT NULL)::numeric       AS p50_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms)
        FILTER (WHERE response_time_ms IS NOT NULL)::numeric       AS p95_ms
    FROM public.api_request_logs
    WHERE created_at >= v_month_start AND created_at < v_month_end
  ),
  active_clients AS (
    SELECT COUNT(*)::int AS n
    FROM public.api_clients
    WHERE status NOT IN ('suspended','revoked')
  ),
  prod_keys AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'active' AND environment = 'production')::int AS active_prod_keys,
      COUNT(*) FILTER (WHERE status = 'active'
                        AND environment = 'production'
                        AND expires_at IS NOT NULL
                        AND expires_at > p_now
                        AND expires_at < (p_now + interval '14 days'))::int        AS expiring_14d
    FROM public.api_keys
  ),
  top_eps AS (
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.calls DESC) AS list
    FROM (
      SELECT endpoint,
             COUNT(*)::int                                          AS calls,
             COUNT(*) FILTER (WHERE error_code IS NOT NULL)::int    AS errors
      FROM public.api_request_logs
      WHERE created_at >= v_month_start AND created_at < v_month_end
      GROUP BY endpoint
      ORDER BY COUNT(*) DESC
      LIMIT 5
    ) t
  ),
  recent_prod_errors AS (
    SELECT jsonb_agg(row_to_json(e) ORDER BY e.created_at DESC) AS list
    FROM (
      SELECT l.created_at, l.endpoint, l.method, l.status_code,
             l.error_code, l.environment, l.request_id,
             k.api_client_id
      FROM public.api_request_logs l
      LEFT JOIN public.api_keys k ON k.id = l.api_key_id
      WHERE l.environment = 'production'
        AND l.error_code IS NOT NULL
        AND l.created_at >= (p_now - interval '24 hours')
      ORDER BY l.created_at DESC
      LIMIT 20
    ) e
  ),
  quota_threshold AS (
    -- Reuse the existing per-client overview so threshold logic stays SSOT.
    SELECT COUNT(*)::int AS n
    FROM public.get_api_monitoring_overview(
      v_month_start, NULL, NULL, NULL, NULL, 80::numeric, false
    ) r
  )
  SELECT jsonb_build_object(
    'generated_at', p_now,
    'today_start',  v_today_start,
    'today_end',    v_today_end,
    'month_start',  v_month_start,
    'month_end',    v_month_end,

    'today', jsonb_build_object(
      'calls',              today.calls,
      'production_calls',   today.prod_calls,
      'sandbox_calls',      today.sandbox_calls,
      'billable_calls',     today.billable_calls,
      'non_billable_calls', today.non_billable_calls,
      'error_count',        today.error_count
    ),
    'month', jsonb_build_object(
      'calls',              month.calls,
      'production_calls',   month.prod_calls,
      'sandbox_calls',      month.sandbox_calls,
      'billable_calls',     month.billable_calls,
      'non_billable_calls', month.non_billable_calls,
      'error_count',        month.error_count,
      'error_rate_pct',
        CASE WHEN month.calls > 0
          THEN ROUND((month.error_count::numeric / month.calls::numeric) * 100, 2)
          ELSE NULL END,
      'rate_limit_events',  month.rate_limit_events,
      'p50_response_ms',    ROUND(month.p50_ms, 2),
      'p95_response_ms',    ROUND(month.p95_ms, 2)
    ),

    'active_api_clients',      active_clients.n,
    'active_production_keys',  prod_keys.active_prod_keys,
    'keys_expiring_14d',       prod_keys.expiring_14d,
    'quota_threshold_clients', quota_threshold.n,

    'top_endpoints',           COALESCE(top_eps.list,           '[]'::jsonb),
    'recent_production_errors',COALESCE(recent_prod_errors.list,'[]'::jsonb)
  )
  INTO v_result
  FROM today, month, active_clients, prod_keys, top_eps, recent_prod_errors, quota_threshold;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_api_usage_dashboard_summary(timestamptz) TO authenticated;