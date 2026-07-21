-- C6.2: outreach-sla-monitor-hourly heartbeat coverage
-- Converts jobid 17 from raw net.http_post (with hard-coded anon JWT) to
-- public.cron_invoke() with x-internal-key auth + heartbeat stamping.
-- Schedule, jobname, jobid, active state, target URL, and payload semantics preserved.

-- A. Seed heartbeat row for outreach-sla-monitor (hourly = 3600s)
INSERT INTO public.cron_heartbeats (job_name, expected_interval_seconds, last_status)
VALUES ('outreach-sla-monitor', 3600, 'pending')
ON CONFLICT (job_name) DO UPDATE
SET expected_interval_seconds = EXCLUDED.expected_interval_seconds,
    updated_at = now();

-- B. Repoint jobid 17 command only. No schedule change, no active change.
-- Guarded: jobid 17 may not exist in a clean replay if earlier cron-setup
-- migrations were skipped/guarded for the same reason.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobid = 17) THEN
    PERFORM cron.alter_job(
      job_id := 17,
      command := $cron$
        SELECT public.cron_invoke(
          'outreach-sla-monitor',
          'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/outreach-sla-monitor',
          jsonb_build_object('trigger','cron','time', now(), 'source','cron:outreach-sla-monitor-hourly')
        );
      $cron$
    );
  END IF;
END
$guard$;
