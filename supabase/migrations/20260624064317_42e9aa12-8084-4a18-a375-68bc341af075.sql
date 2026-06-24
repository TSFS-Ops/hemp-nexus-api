CREATE OR REPLACE FUNCTION public.run_reconcile_acceptance_notifications_with_heartbeat()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.reconcile_acceptance_notifications();

  INSERT INTO public.cron_heartbeats (job_name, last_run_at, last_status, last_error, last_http_status, last_request_id, expected_interval_seconds)
  VALUES ('reconcile-acceptance-notifications', now(), 'success', NULL, NULL, NULL, 120)
  ON CONFLICT (job_name) DO UPDATE
    SET last_run_at = EXCLUDED.last_run_at,
        last_status = 'success',
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
$function$;