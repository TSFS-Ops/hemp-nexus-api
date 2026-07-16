-- C6.4 — account-deletion-sweeper-daily-dryrun heartbeat coverage.
--
-- Pre-apply safety check (cron_invoke payload preservation) verified against
-- the live function definition before this migration was authored. See
-- evidence/c6-chron-observability/account-deletion-sweeper-dryrun-heartbeat/README.md.
--
-- This migration:
-- 1) seeds public.cron_heartbeats for job_name='account-deletion-sweeper'
--    with expected_interval_seconds=86400 (preserves existing history),
-- 2) alters ONLY jobid 25 to call public.cron_invoke(...) with the same
--    dry-run payload it sent before (dry_run=true, max_rows=50, source=...).
--
-- It does NOT change schedule, active flag, jobname, edge function source,
-- or any account/user/profile/org/business table. It does NOT add confirm or
-- HARD_DELETE. It does NOT set dry_run to false.

-- 1) Seed heartbeat row idempotently.
INSERT INTO public.cron_heartbeats AS h
  (job_name, last_status, expected_interval_seconds, updated_at)
VALUES
  ('account-deletion-sweeper', 'pending', 86400, now())
ON CONFLICT (job_name) DO UPDATE
SET expected_interval_seconds = 86400,
    updated_at = now();

-- 2) Alter ONLY jobid 25 to use the cron_invoke wrapper.
-- Guarded: jobid 25 may not exist in a clean replay if earlier cron-setup
-- migrations were skipped/guarded for the same reason.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobid = 25) THEN
    PERFORM cron.alter_job(
      job_id := 25,
      command := $cmd$
        SELECT public.cron_invoke(
          'account-deletion-sweeper',
          'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/account-deletion-sweeper',
          jsonb_build_object(
            'dry_run', true,
            'max_rows', 50,
            'source', 'cron:account-deletion-sweeper-daily-dryrun',
            'trigger', 'cron',
            'time', now()
          )
        );
      $cmd$
    );
  END IF;
END
$guard$;
