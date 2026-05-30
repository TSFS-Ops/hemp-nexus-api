-- DATA-004 Batch 10 — schedule cold-storage-archive LIVE (dry_run=false).
-- Adds a weekly live schedule for the cold-storage-archive edge function.
-- Cold-storage archive is non-destructive by contract: it writes JSON
-- exports to the cold-storage bucket and never deletes or destructively
-- mutates source records (enforced by Batch 7 guard).
--
-- Cadence: Sunday 04:10 UTC, weekly — runs 30 minutes AFTER the existing
-- dry-run job (40 3 * * 0 / jobid 40) so the dry-run baseline is captured
-- first each week.
--
-- The Batch 9A dry-run schedule (jobid 40, 'cold-storage-archive-dryrun')
-- is intentionally left in place per the Batch 10 runbook so dry-run vs
-- live comparison evidence keeps accumulating.
--
-- Auth: x-internal-key sourced from vault.INTERNAL_CRON_KEY (never anon).
--
-- Rollback:
--   SELECT cron.unschedule('cold-storage-archive-live');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cold-storage-archive-live') THEN
    PERFORM cron.unschedule('cold-storage-archive-live');
  END IF;
END
$$;

SELECT cron.schedule(
  'cold-storage-archive-live',
  '10 4 * * 0',  -- Sunday 04:10 UTC, weekly (after dry-run at 03:40)
  $job$
  SELECT net.http_post(
    url := 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/cold-storage-archive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'INTERNAL_CRON_KEY' LIMIT 1)
    ),
    body := jsonb_build_object(
      'dry_run', false,
      'limit', 50,
      'source', 'cron:cold-storage-archive-live'
    )
  ) AS request_id;
  $job$
);