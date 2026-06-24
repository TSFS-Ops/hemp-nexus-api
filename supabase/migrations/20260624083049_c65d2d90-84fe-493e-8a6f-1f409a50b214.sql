-- C6.1: heartbeat coverage for lifecycle-scheduler-job (jobid 3).
-- Schedule (0 3 * * *), job name, active state, and function URL all preserved.
-- No business-state mutation; no other cron job touched.

-- A. Pre-seed heartbeat row so cron_heartbeat_stale alert has a non-NULL
--    expected_interval_seconds before the next 03:00 UTC tick.
INSERT INTO public.cron_heartbeats (job_name, expected_interval_seconds, last_status, updated_at)
VALUES ('lifecycle-scheduler', 86400, 'pending', now())
ON CONFLICT (job_name) DO UPDATE
  SET expected_interval_seconds = EXCLUDED.expected_interval_seconds,
      updated_at = now();
-- NOTE: ON CONFLICT intentionally does NOT overwrite last_run_at /
-- last_request_id / last_http_status / last_error so any historical state
-- survives. last_status is only set on initial insert.

-- B. Repoint jobid 3 to cron_invoke wrapper. Preserves jobname
--    'lifecycle-scheduler-job', schedule '0 3 * * *', and active=true.
SELECT cron.alter_job(
  job_id  := 3,
  command := $cron$
    SELECT public.cron_invoke(
      'lifecycle-scheduler',
      'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/lifecycle-scheduler',
      jsonb_build_object('time', now(), 'source', 'cron:lifecycle-scheduler-job')
    );
  $cron$
);