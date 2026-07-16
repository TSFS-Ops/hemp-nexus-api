-- Cron Stage 2B: replace anon-bearer command with x-internal-key from vault.
-- Guard: clean disposable-DB replay may not have this job registered yet if the
-- historical cron.schedule migration that created it was itself guarded/skipped.
DO $guard$
BEGIN
IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'engagement-reminder-daily') THEN
PERFORM cron.unschedule('engagement-reminder-daily');
END IF;
END
$guard$;

SELECT cron.schedule(
'engagement-reminder-daily',
'0 6 * * *',
$cron$
SELECT net.http_post(
url := 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/engagement-reminder',
headers := jsonb_build_object(
'Content-Type', 'application/json',
'x-internal-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'INTERNAL_CRON_KEY')
),
body := jsonb_build_object('time', now(), 'source', 'cron:engagement-reminder-daily')
) AS request_id;
$cron$
);
