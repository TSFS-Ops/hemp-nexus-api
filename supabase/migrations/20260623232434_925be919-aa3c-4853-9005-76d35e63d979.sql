-- C5b: Heartbeat coverage for reconcile-acceptance-notifications (pure SQL cron, jobid 21)

-- A. Pre-seed the heartbeat row so stale-alert has a non-NULL interval before first tick.
INSERT INTO public.cron_heartbeats (job_name, expected_interval_seconds, last_status)
VALUES ('reconcile-acceptance-notifications', 120, 'pending')
ON CONFLICT (job_name) DO UPDATE
  SET expected_interval_seconds = EXCLUDED.expected_interval_seconds;

-- B. Dedicated wrapper — SECURITY DEFINER, swallow-and-stamp.
CREATE OR REPLACE FUNCTION public.run_reconcile_acceptance_notifications_with_heartbeat()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.reconcile_acceptance_notifications();

  INSERT INTO public.cron_heartbeats (job_name, last_run_at, last_status, last_error, last_http_status, last_request_id, expected_interval_seconds)
  VALUES ('reconcile-acceptance-notifications', now(), 'ok', NULL, NULL, NULL, 120)
  ON CONFLICT (job_name) DO UPDATE
    SET last_run_at = EXCLUDED.last_run_at,
        last_status = 'ok',
        last_error = NULL,
        last_http_status = NULL,
        last_request_id = NULL,
        updated_at = now();

  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.cron_heartbeats (job_name, last_run_at, last_status, last_error, last_http_status, last_request_id, expected_interval_seconds)
  VALUES ('reconcile-acceptance-notifications', now(), 'failed', SQLERRM, NULL, NULL, 120)
  ON CONFLICT (job_name) DO UPDATE
    SET last_run_at = EXCLUDED.last_run_at,
        last_status = 'failed',
        last_error = EXCLUDED.last_error,
        last_http_status = NULL,
        last_request_id = NULL,
        updated_at = now();
  RETURN jsonb_build_object('status', 'failed', 'error', SQLERRM);
END;
$$;

-- C. Swap cron command for jobid 21. Schedule/name/active preserved by cron.alter_job.
SELECT cron.alter_job(
  job_id := 21,
  command := 'SELECT public.run_reconcile_acceptance_notifications_with_heartbeat();'
);