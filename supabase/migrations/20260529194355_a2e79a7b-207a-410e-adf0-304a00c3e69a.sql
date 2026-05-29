-- DATA-004 Batch 9A — schedule cold-storage-archive DRY-RUN ONLY.
-- Adds a single weekly scheduled dry-run for cold-storage-archive and the
-- HQ-health RPC that surfaces the schedule state. NO live archive schedule
-- is created. Authenticated via INTERNAL_CRON_KEY from vault (never anon).
-- Reversible: SELECT cron.unschedule('cold-storage-archive-dryrun');

-- Defensive: drop any pre-existing schedule of this name before scheduling
-- so re-running the migration is idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cold-storage-archive-dryrun') THEN
    PERFORM cron.unschedule('cold-storage-archive-dryrun');
  END IF;
END
$$;

SELECT cron.schedule(
  'cold-storage-archive-dryrun',
  '40 3 * * 0',  -- Sunday 03:40 UTC, weekly
  $job$
  SELECT net.http_post(
    url := 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/cold-storage-archive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'INTERNAL_CRON_KEY' LIMIT 1)
    ),
    body := jsonb_build_object(
      'dry_run', true,
      'limit', 50,
      'source', 'cron:cold-storage-archive-dryrun'
    )
  ) AS request_id;
  $job$
);

-- HQ Retention Health helper for cold-storage-archive schedules.
-- Mirrors get_purge_email_send_log_cron_jobs(): classifies each schedule
-- as dry_run vs live by inspecting the command text for explicit
-- 'dry_run', true pinning. SECURITY DEFINER + service_role only.
CREATE OR REPLACE FUNCTION public.get_cold_storage_archive_cron_jobs()
RETURNS TABLE (
  jobid bigint,
  jobname text,
  schedule text,
  active boolean,
  is_dry_run boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT
    j.jobid,
    j.jobname,
    j.schedule,
    j.active,
    (
      j.command ~* '[''"]dry_run[''"]\s*[:,]\s*true'
      AND j.command !~* '[''"]dry_run[''"]\s*[:,]\s*false'
    ) AS is_dry_run
  FROM cron.job j
  WHERE j.command ILIKE '%/functions/v1/cold-storage-archive%'
$$;

REVOKE ALL ON FUNCTION public.get_cold_storage_archive_cron_jobs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cold_storage_archive_cron_jobs() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cold_storage_archive_cron_jobs() TO service_role;