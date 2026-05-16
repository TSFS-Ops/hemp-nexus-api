
-- Batch V — Final reconciliation and closeout readiness
-- 1. Index for closeout query
CREATE INDEX IF NOT EXISTS idx_admin_risk_items_kind_status
  ON public.admin_risk_items (kind, status);

-- 2. Closeout drift summary RPC -------------------------------------------
CREATE OR REPLACE FUNCTION public.closeout_drift_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean := false;
  v_open_total int := 0;
  v_critical int := 0;
  v_balance int := 0;
  v_burn_poi int := 0;
  v_wad_poi int := 0;
  v_engagement_no_poi int := 0;
  v_missing_side_effect int := 0;
  v_self_incident int := 0;
  v_by_kind jsonb := '{}'::jsonb;
  v_by_severity jsonb := '{}'::jsonb;
BEGIN
  IF v_caller IS NOT NULL THEN
    v_is_admin := public.is_admin(v_caller);
  END IF;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'closeout_drift_summary: admin role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_open_total
    FROM public.admin_risk_items
   WHERE status IN ('open','investigating','acknowledged','in_progress','monitoring','escalated');

  SELECT COUNT(*) INTO v_critical
    FROM public.admin_risk_items
   WHERE status IN ('open','investigating','acknowledged','in_progress','monitoring','escalated')
     AND severity IN ('critical','high');

  SELECT COUNT(*) INTO v_balance
    FROM public.admin_risk_items
   WHERE status IN ('open','investigating','acknowledged','in_progress','monitoring','escalated')
     AND kind = 'balance_drift';

  SELECT COUNT(*) INTO v_burn_poi
    FROM public.admin_risk_items
   WHERE status IN ('open','investigating','acknowledged','in_progress','monitoring','escalated')
     AND (kind = 'burn_poi_drift' OR title LIKE 'Reconciliation: burn without POI%'
          OR title LIKE 'Reconciliation: POI without burn%'
          OR title LIKE 'Reconciliation: minted state without ledger event%');

  SELECT COUNT(*) INTO v_wad_poi
    FROM public.admin_risk_items
   WHERE status IN ('open','investigating','acknowledged','in_progress','monitoring','escalated')
     AND (kind = 'wad_poi_drift' OR title LIKE 'Reconciliation: wad-poi%');

  SELECT COUNT(*) INTO v_engagement_no_poi
    FROM public.admin_risk_items
   WHERE status IN ('open','investigating','acknowledged','in_progress','monitoring','escalated')
     AND (kind = 'engagement_without_poi' OR title LIKE 'Reconciliation: engagement without POI%');

  SELECT COUNT(*) INTO v_missing_side_effect
    FROM public.admin_risk_items
   WHERE status IN ('open','investigating','acknowledged','in_progress','monitoring','escalated')
     AND (kind = 'missing_side_effect' OR title LIKE 'Reconciliation: missing side-effect%');

  SELECT COUNT(*) INTO v_self_incident
    FROM public.admin_risk_items
   WHERE status IN ('open','investigating','acknowledged','in_progress','monitoring','escalated')
     AND title LIKE 'Reconciliation: % run failed%';

  SELECT COALESCE(jsonb_object_agg(kind, c), '{}'::jsonb) INTO v_by_kind
  FROM (
    SELECT COALESCE(kind, 'unspecified') AS kind, COUNT(*) AS c
      FROM public.admin_risk_items
     WHERE status IN ('open','investigating','acknowledged','in_progress','monitoring','escalated')
     GROUP BY 1
  ) k;

  SELECT COALESCE(jsonb_object_agg(severity, c), '{}'::jsonb) INTO v_by_severity
  FROM (
    SELECT severity, COUNT(*) AS c
      FROM public.admin_risk_items
     WHERE status IN ('open','investigating','acknowledged','in_progress','monitoring','escalated')
     GROUP BY 1
  ) s;

  RETURN jsonb_build_object(
    'open_total', v_open_total,
    'critical', v_critical,
    'balance_drift', v_balance,
    'burn_poi_drift', v_burn_poi,
    'wad_poi_drift', v_wad_poi,
    'engagement_without_poi', v_engagement_no_poi,
    'missing_side_effect', v_missing_side_effect,
    'self_incident', v_self_incident,
    'by_kind', v_by_kind,
    'by_severity', v_by_severity,
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.closeout_drift_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.closeout_drift_summary() TO authenticated;

-- 3. Heartbeat seeds for new jobs -----------------------------------------
INSERT INTO public.cron_heartbeats (job_name, expected_interval_seconds)
VALUES
  ('balance-drift-reconciliation-daily', 86400),
  ('side-effect-reconciliation-daily',   86400),
  ('transaction-reconciliation-job',     900)
ON CONFLICT (job_name) DO NOTHING;

-- 4. Schedule new jobs through cron_invoke --------------------------------
DO $$
DECLARE j text;
BEGIN
  FOR j IN SELECT unnest(ARRAY[
    'balance-drift-reconciliation-daily',
    'side-effect-reconciliation-daily',
    'transaction-reconciliation-job'
  ]) LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.unschedule(j);
    END IF;
  END LOOP;
END $$;

SELECT cron.schedule(
  'balance-drift-reconciliation-daily',
  '15 3 * * *',
  $cron$ SELECT public.cron_invoke(
    'balance-drift-reconciliation-daily',
    'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/balance-drift-reconciliation',
    jsonb_build_object('time', now(), 'source', 'cron:balance-drift-reconciliation-daily', 'open_risk_items', true)
  ); $cron$
);

SELECT cron.schedule(
  'side-effect-reconciliation-daily',
  '45 3 * * *',
  $cron$ SELECT public.cron_invoke(
    'side-effect-reconciliation-daily',
    'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/side-effect-reconciliation',
    jsonb_build_object('time', now(), 'source', 'cron:side-effect-reconciliation-daily', 'open_risk_items', true)
  ); $cron$
);

SELECT cron.schedule(
  'transaction-reconciliation-job',
  '*/15 * * * *',
  $cron$ SELECT public.cron_invoke(
    'transaction-reconciliation-job',
    'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/transaction-reconciliation',
    jsonb_build_object('time', now(), 'source', 'cron:transaction-reconciliation-job')
  ); $cron$
);
