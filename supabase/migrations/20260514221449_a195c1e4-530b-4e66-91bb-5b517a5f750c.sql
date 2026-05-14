-- AUD-003 Fix 1: schedule burn-poi-reconciliation in pg_cron.
-- Mirrors the engagement-reminder-daily pattern (uses INTERNAL_CRON_KEY from vault).
-- Idempotent: unschedule any prior job of the same name before scheduling.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'burn-poi-reconciliation-daily') THEN
    PERFORM cron.unschedule('burn-poi-reconciliation-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'burn-poi-reconciliation-daily',
  '30 3 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/burn-poi-reconciliation',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'INTERNAL_CRON_KEY')
    ),
    body := jsonb_build_object('time', now(), 'source', 'cron:burn-poi-reconciliation-daily', 'window_days', 7, 'open_risk_items', true)
  ) AS request_id;
  $cron$
);