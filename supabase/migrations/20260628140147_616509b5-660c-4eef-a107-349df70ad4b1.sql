-- C6.7 cold-storage-archive-dryrun heartbeat coverage
-- Scope: jobid 40 only. Does not touch jobid 41 (live), 39, 42, or any other.

-- 1) Seed/upsert a separate heartbeat row for the dry-run job.
INSERT INTO public.cron_heartbeats (job_name, last_status, expected_interval_seconds)
VALUES ('cold-storage-archive-dryrun', 'pending', 604800)
ON CONFLICT (job_name) DO UPDATE
SET expected_interval_seconds = 604800,
    updated_at = now();

-- 2) Convert jobid 40 raw net.http_post -> public.cron_invoke wrapper.
-- Preserves jobname, schedule, active flag, URL, and payload shape exactly.
-- Guarded: jobid 40 may not exist in a clean replay if earlier cron-setup
-- migrations were skipped/guarded for the same reason.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobid = 40) THEN
    PERFORM cron.alter_job(
      job_id := 40,
      command := $cmd$
        SELECT public.cron_invoke(
          'cold-storage-archive-dryrun',
          'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/cold-storage-archive',
          jsonb_build_object(
            'dry_run', true,
            'limit', 50,
            'source', 'cron:cold-storage-archive-dryrun'
          )
        );
      $cmd$
    );
  END IF;
END
$guard$;
