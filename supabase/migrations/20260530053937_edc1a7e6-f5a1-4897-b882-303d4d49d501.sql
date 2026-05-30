-- DATA-004 Batch 10 — first live scheduled-tick evidence dispatch.
-- Fires one invocation of the cold-storage-archive edge function with the
-- IDENTICAL auth (x-internal-key from vault.INTERNAL_CRON_KEY) and body
-- (dry_run=false, limit=50) that scheduled jobid 41 uses every Sunday at
-- 04:10 UTC, so the live cron pathway is exercised end-to-end without
-- waiting for the next natural tick. Adds no schema and no cron schedule.
DO $$
DECLARE
  req_id bigint;
BEGIN
  SELECT net.http_post(
    url := 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/cold-storage-archive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'INTERNAL_CRON_KEY' LIMIT 1)
    ),
    body := jsonb_build_object(
      'dry_run', false,
      'limit', 50,
      'source', 'batch-10-first-live-tick'
    )
  ) INTO req_id;
  RAISE NOTICE 'batch-10-first-live-tick request_id=%', req_id;
END
$$;