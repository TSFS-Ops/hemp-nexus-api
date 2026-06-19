
-- ============================================================
-- Batch 4 follow-up · Token / credit balance alert triggers
-- Adds two new alert_type values produced by a dedicated detector:
--   • token_balance_low   (warning, balance < 20% of minimum_required)
--   • token_balance_zero  (critical, balance <= 0 with minimum_required > 0)
-- Internal-only. Reuses can_access_api_monitoring gate and the same
-- api_usage_alerts table / strip trigger / RLS.
-- ============================================================

CREATE OR REPLACE FUNCTION public.detect_api_token_balance_alerts()
RETURNS TABLE(inserted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inserted integer := 0;
  v_now timestamptz := now();
  v_day text := to_char(date_trunc('day', now()), 'YYYYMMDD');
BEGIN
  -- service_role (no auth) or any internal monitor may trigger detection.
  IF v_uid IS NOT NULL AND NOT public.can_access_api_monitoring(v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- token_balance_zero -----------------------------------------
  WITH ins AS (
    INSERT INTO public.api_usage_alerts
      (alert_type, severity, api_client_id, environment,
       trigger_value, threshold_value, details, dedupe_key)
    SELECT
      'token_balance_zero',
      'critical',
      c.id,
      NULL,
      tb.balance,
      0,
      jsonb_build_object(
        'org_id', tb.org_id,
        'balance', tb.balance,
        'minimum_required', tb.minimum_required
      ),
      'token_balance_zero:' || c.id::text || ':' || v_day
    FROM public.token_balances tb
    JOIN public.api_clients c
      ON c.org_id = tb.org_id
     AND c.status NOT IN ('revoked','suspended')
    WHERE COALESCE(tb.minimum_required, 0) > 0
      AND tb.balance <= 0
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT v_inserted + count(*) INTO v_inserted FROM ins;

  -- token_balance_low ------------------------------------------
  -- < 20% of minimum_required but still > 0 (zero handled above)
  WITH ins AS (
    INSERT INTO public.api_usage_alerts
      (alert_type, severity, api_client_id, environment,
       trigger_value, threshold_value, details, dedupe_key)
    SELECT
      'token_balance_low',
      'warning',
      c.id,
      NULL,
      tb.balance,
      ceil(tb.minimum_required * 0.20),
      jsonb_build_object(
        'org_id', tb.org_id,
        'balance', tb.balance,
        'minimum_required', tb.minimum_required,
        'threshold_pct', 20
      ),
      'token_balance_low:' || c.id::text || ':' || v_day
    FROM public.token_balances tb
    JOIN public.api_clients c
      ON c.org_id = tb.org_id
     AND c.status NOT IN ('revoked','suspended')
    WHERE COALESCE(tb.minimum_required, 0) > 0
      AND tb.balance > 0
      AND tb.balance::numeric < (tb.minimum_required::numeric * 0.20)
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT v_inserted + count(*) INTO v_inserted FROM ins;

  RETURN QUERY SELECT v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.detect_api_token_balance_alerts() TO authenticated;
