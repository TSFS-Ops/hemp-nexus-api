-- Public API V1 · Batch 9 — Internal Monitoring Dashboard
-- All access via SECURITY DEFINER RPCs. No new tables. No public endpoint.
-- Roles: platform_admin (full), api_admin (read), auditor (read).
-- Never returns raw key material, secrets, documents, evidence, governance,
-- POI/WaD/payment/compliance fields, or raw request log rows.

-- ─── Access gate ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_access_api_monitoring(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND (
    public.has_role(_user_id, 'platform_admin'::public.app_role)
    OR public.has_role(_user_id, 'api_admin'::public.app_role)
    OR public.has_role(_user_id, 'auditor'::public.app_role)
  )
$$;

GRANT EXECUTE ON FUNCTION public.can_access_api_monitoring(uuid) TO authenticated;

-- ─── Internal monitoring overview ────────────────────────────────────────
-- Returns one JSON row per (api_client, environment) for the selected month.
CREATE OR REPLACE FUNCTION public.get_api_monitoring_overview(
  p_period_start timestamptz DEFAULT date_trunc('month', now() AT TIME ZONE 'UTC'),
  p_environment text DEFAULT NULL,        -- 'sandbox' | 'production' | NULL
  p_status_label text DEFAULT NULL,       -- healthy|warning|blocked|suspended|no_recent_traffic|needs_attention
  p_api_client_id uuid DEFAULT NULL,
  p_plan_id uuid DEFAULT NULL,
  p_min_usage_pct numeric DEFAULT NULL,   -- e.g. 80 → only rows with allowance use ≥ 80%
  p_errors_only boolean DEFAULT false
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  WITH envs AS (
    SELECT unnest(ARRAY['sandbox','production'])::text AS environment
  ),
  client_envs AS (
    SELECT c.id AS api_client_id, c.org_id, c.legal_entity_name, c.status AS client_status,
           e.environment
    FROM public.api_clients c CROSS JOIN envs e
    WHERE (p_api_client_id IS NULL OR c.id = p_api_client_id)
      AND (p_environment IS NULL OR e.environment = p_environment)
  ),
  plan_active AS (
    SELECT DISTINCT ON (a.api_client_id)
           a.api_client_id, p.id AS plan_id, p.plan_name, p.currency,
           p.monthly_fee, p.included_lookup_allowance,
           p.overage_price_per_successful_lookup, p.overage_allowed
    FROM public.api_client_plan_assignments a
    JOIN public.api_commercial_plans p ON p.id = a.api_commercial_plan_id
    WHERE a.active = true AND p.active = true
    ORDER BY a.api_client_id, a.assigned_at DESC
  ),
  key_stats AS (
    SELECT k.api_client_id, k.environment,
           COUNT(*)::int AS key_count,
           COUNT(*) FILTER (WHERE k.status = 'active')::int AS active_keys,
           COUNT(*) FILTER (WHERE k.status IN ('suspended','revoked')
                            OR k.revoked_at IS NOT NULL)::int AS revoked_keys,
           COUNT(*) FILTER (WHERE k.expires_at IS NOT NULL
                            AND k.expires_at < now())::int AS expired_keys,
           MIN(k.expires_at) FILTER (WHERE k.expires_at IS NOT NULL
                                     AND k.expires_at > now()
                                     AND COALESCE(k.status,'active') = 'active') AS next_expiry
    FROM public.api_keys k
    GROUP BY k.api_client_id, k.environment
  ),
  ip_excs AS (
    SELECT api_client_id, BOOL_OR(active) AS has_active_exception
    FROM public.api_ip_allowlist_exceptions
    GROUP BY api_client_id
  ),
  logs AS (
    SELECT k.api_client_id, l.environment, l.endpoint, l.status_code,
           l.error_code, l.billable, l.response_time_ms, l.created_at
    FROM public.api_request_logs l
    JOIN public.api_keys k ON k.id = l.api_key_id
    WHERE l.created_at >= v_period_start
      AND l.created_at <  v_period_end
  ),
  agg AS (
    SELECT
      ce.api_client_id, ce.environment,
      COUNT(l.*)::int AS request_count,
      COUNT(l.*) FILTER (WHERE l.endpoint = '/v1/counterparty/lookup'
                         AND l.error_code IS NULL)::int AS lookup_count,
      COUNT(l.*) FILTER (WHERE l.endpoint = '/v1/counterparty/summary'
                         AND l.error_code IS NULL)::int AS summary_count,
      COUNT(l.*) FILTER (WHERE l.billable = true)::int AS billable_count,
      COUNT(l.*) FILTER (WHERE COALESCE(l.billable,false) = false)::int AS non_billable_count,
      COUNT(l.*) FILTER (WHERE l.error_code IS NOT NULL)::int AS error_count,
      COUNT(l.*) FILTER (WHERE l.error_code = 'rate_limited' OR l.status_code = 429)::int AS rate_limit_events,
      COUNT(l.*) FILTER (WHERE l.error_code = 'monthly_limit_reached')::int AS monthly_limit_events,
      COUNT(l.*) FILTER (WHERE l.error_code IN ('unauthorized','invalid_api_key','invalid_scope') OR l.status_code = 401)::int AS auth_failures,
      AVG(l.response_time_ms) FILTER (WHERE l.response_time_ms IS NOT NULL)::numeric AS avg_latency_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY l.response_time_ms)
        FILTER (WHERE l.response_time_ms IS NOT NULL)::numeric AS p95_latency_ms,
      MAX(l.created_at) FILTER (WHERE l.error_code IS NULL) AS last_success,
      MAX(l.created_at) FILTER (WHERE l.error_code IS NOT NULL) AS last_failure,
      COUNT(l.*) FILTER (WHERE l.environment = 'production'
                         AND l.billable = true
                         AND l.error_code IS NULL
                         AND l.endpoint IN ('/v1/counterparty/lookup','/v1/counterparty/summary'))::int AS prod_billable_calls
    FROM client_envs ce
    LEFT JOIN logs l
      ON l.api_client_id = ce.api_client_id
     AND l.environment = ce.environment
    GROUP BY ce.api_client_id, ce.environment
  ),
  top_err AS (
    SELECT api_client_id, environment, error_code, COUNT(*)::int AS n,
           ROW_NUMBER() OVER (PARTITION BY api_client_id, environment ORDER BY COUNT(*) DESC) AS rn
    FROM logs
    WHERE error_code IS NOT NULL
    GROUP BY api_client_id, environment, error_code
  ),
  final_rows AS (
    SELECT
      ce.api_client_id, ce.org_id, ce.legal_entity_name, ce.client_status, ce.environment,
      pa.plan_id, pa.plan_name, pa.currency, pa.monthly_fee, pa.overage_allowed,
      COALESCE(pa.included_lookup_allowance,
               CASE WHEN ce.environment = 'sandbox' THEN 10000 ELSE 5000 END)::int AS allowance,
      COALESCE(pa.overage_price_per_successful_lookup, 0)::numeric AS overage_price,
      COALESCE(ag.request_count,0) AS request_count,
      COALESCE(ag.lookup_count,0) AS lookup_count,
      COALESCE(ag.summary_count,0) AS summary_count,
      COALESCE(ag.billable_count,0) AS billable_count,
      COALESCE(ag.non_billable_count,0) AS non_billable_count,
      COALESCE(ag.error_count,0) AS error_count,
      COALESCE(ag.rate_limit_events,0) AS rate_limit_events,
      COALESCE(ag.monthly_limit_events,0) AS monthly_limit_events,
      COALESCE(ag.auth_failures,0) AS auth_failures,
      ROUND(ag.avg_latency_ms, 2) AS avg_latency_ms,
      ROUND(ag.p95_latency_ms, 2) AS p95_latency_ms,
      ag.last_success, ag.last_failure,
      COALESCE(ag.prod_billable_calls,0) AS prod_billable_calls,
      ks.key_count, ks.active_keys, ks.revoked_keys, ks.expired_keys, ks.next_expiry,
      COALESCE(ipx.has_active_exception, false) AS ip_exception_active
    FROM client_envs ce
    LEFT JOIN agg ag ON ag.api_client_id = ce.api_client_id AND ag.environment = ce.environment
    LEFT JOIN plan_active pa ON pa.api_client_id = ce.api_client_id
    LEFT JOIN key_stats ks ON ks.api_client_id = ce.api_client_id AND ks.environment = ce.environment
    LEFT JOIN ip_excs ipx ON ipx.api_client_id = ce.api_client_id
  ),
  labelled AS (
    SELECT
      fr.*,
      (SELECT error_code FROM top_err te
        WHERE te.api_client_id = fr.api_client_id
          AND te.environment   = fr.environment
          AND te.rn = 1) AS top_error_code,
      CASE
        WHEN fr.allowance > 0
          THEN ROUND((LEAST(fr.prod_billable_calls, fr.allowance)::numeric
                     / fr.allowance::numeric) * 100, 2)
        ELSE NULL
      END AS allowance_used_pct,
      GREATEST(0, fr.prod_billable_calls - fr.allowance) AS overage_calls,
      CASE WHEN fr.client_status IN ('suspended','revoked') THEN 'suspended'
           WHEN fr.environment = 'production'
                AND (fr.active_keys IS NULL OR fr.active_keys = 0)
                AND fr.client_status = 'production_approved' THEN 'needs_attention'
           WHEN fr.plan_id IS NULL AND fr.environment = 'production'
                AND fr.client_status = 'production_approved' THEN 'needs_attention'
           WHEN fr.environment = 'production' AND fr.allowance > 0
                AND GREATEST(0, fr.prod_billable_calls - fr.allowance) > 0
                AND COALESCE(fr.overage_allowed, false) = false THEN 'blocked'
           WHEN fr.monthly_limit_events > 0 THEN 'blocked'
           WHEN fr.request_count = 0 THEN 'no_recent_traffic'
           WHEN fr.error_count > 0
                AND fr.request_count > 0
                AND (fr.error_count::numeric / fr.request_count::numeric) >= 0.10 THEN 'warning'
           WHEN fr.rate_limit_events >= 10 THEN 'warning'
           WHEN fr.next_expiry IS NOT NULL AND fr.next_expiry < (now() + interval '14 days') THEN 'warning'
           WHEN fr.allowance > 0 AND fr.prod_billable_calls::numeric / NULLIF(fr.allowance,0)::numeric >= 0.80 THEN 'warning'
           ELSE 'healthy'
      END AS status_label
    FROM final_rows fr
  )
  SELECT jsonb_build_object(
    'api_client_id', api_client_id,
    'api_client_name', legal_entity_name,
    'org_id', org_id,
    'client_status', client_status,
    'environment', environment,
    'plan_id', plan_id,
    'plan_name', plan_name,
    'currency', currency,
    'monthly_fee', monthly_fee,
    'allowance', allowance,
    'allowance_used', LEAST(prod_billable_calls, allowance),
    'allowance_used_pct', allowance_used_pct,
    'overage_calls', overage_calls,
    'overage_allowed', COALESCE(overage_allowed, false),
    'estimated_overage_amount', ROUND((overage_calls * overage_price)::numeric, 2),
    'estimated_total_amount',
      ROUND((COALESCE(monthly_fee,0) + overage_calls * overage_price)::numeric, 2),
    'request_count', request_count,
    'successful_lookup_calls', lookup_count,
    'successful_summary_calls', summary_count,
    'billable_calls', billable_count,
    'non_billable_calls', non_billable_count,
    'success_rate_pct',
      CASE WHEN request_count > 0
        THEN ROUND(((request_count - error_count)::numeric / request_count::numeric) * 100, 2)
        ELSE NULL END,
    'error_count', error_count,
    'top_error_code', top_error_code,
    'rate_limit_events', rate_limit_events,
    'monthly_limit_events', monthly_limit_events,
    'failed_auth_attempts', auth_failures,
    'avg_latency_ms', avg_latency_ms,
    'p95_latency_ms', p95_latency_ms,
    'key_count', COALESCE(key_count, 0),
    'active_key_count', COALESCE(active_keys, 0),
    'suspended_revoked_key_count', COALESCE(revoked_keys, 0),
    'expired_key_count', COALESCE(expired_keys, 0),
    'next_key_expiry', next_expiry,
    'key_expiry_warning',
      (next_expiry IS NOT NULL AND next_expiry < (now() + interval '14 days')),
    'ip_allowlist_exception_active', ip_exception_active,
    'last_successful_call', last_success,
    'last_failed_call', last_failure,
    'open_support_tickets', NULL,
    'open_support_tickets_status', 'deferred_no_support_ticket_table',
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

-- ─── CSV export audit (summary rows only, platform_admin only) ───────────
CREATE OR REPLACE FUNCTION public.log_api_monitoring_csv_export(
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_filters jsonb,
  p_row_count integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(v_uid, 'platform_admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_logs (action, entity_type, entity_id, actor_id, metadata)
  VALUES (
    'public_api.v1.monitoring.csv_exported',
    'api_monitoring',
    NULL,
    v_uid,
    jsonb_build_object(
      'period_start', p_period_start,
      'period_end', p_period_end,
      'filters', COALESCE(p_filters, '{}'::jsonb),
      'row_count', COALESCE(p_row_count, 0),
      'exported_at', now()
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_api_monitoring_csv_export(timestamptz, timestamptz, jsonb, integer) TO authenticated;