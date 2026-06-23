-- C5a: heartbeat coverage for dispatch-acceptance-receipts (jobid 20).
-- Schedule, job name, active state, and function URL all preserved.

-- A. Pre-seed heartbeat row so cron_heartbeat_stale alert has a non-NULL
--    expected_interval_seconds before the next cron tick.
INSERT INTO public.cron_heartbeats (job_name, expected_interval_seconds, last_status, updated_at)
VALUES ('dispatch-acceptance-receipts', 120, 'pending', now())
ON CONFLICT (job_name) DO UPDATE
  SET expected_interval_seconds = EXCLUDED.expected_interval_seconds,
      updated_at = now();
-- NOTE: ON CONFLICT intentionally does NOT overwrite last_run_at /
-- last_request_id / last_http_status / last_error so any historical state
-- (none today) survives. last_status is only set on initial insert.

-- B. Repoint jobid 20 to cron_invoke wrapper. Preserves jobname
--    'dispatch-acceptance-receipts', schedule '*/2 * * * *', and active=true.
SELECT cron.alter_job(
  job_id  := 20,
  command := $cron$
    SELECT public.cron_invoke(
      'dispatch-acceptance-receipts',
      'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/dispatch-acceptance-receipts',
      jsonb_build_object('triggered_at', now(), 'source', 'cron:dispatch-acceptance-receipts')
    );
  $cron$
);
