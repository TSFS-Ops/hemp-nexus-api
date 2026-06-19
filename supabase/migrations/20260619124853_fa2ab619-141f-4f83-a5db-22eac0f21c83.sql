
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
    'api_client_name', v_client.legal_entity_name,
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
