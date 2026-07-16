-- C6.3 cleanup-expired-unsubscribe-tokens heartbeat coverage

-- 1. Wrapper function
CREATE OR REPLACE FUNCTION public.run_cleanup_expired_unsubscribe_tokens_with_heartbeat()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
v_deleted integer;
BEGIN
v_deleted := public.cleanup_expired_unsubscribe_tokens();

INSERT INTO public.cron_heartbeats (
job_name, last_run_at, last_status, last_error, last_http_status,
last_request_id, expected_interval_seconds, last_metadata, updated_at
) VALUES (
'cleanup-expired-unsubscribe-tokens', now(), 'success', NULL, NULL,
NULL, 86400,
jsonb_build_object(
'wrapper', 'run_cleanup_expired_unsubscribe_tokens_with_heartbeat',
'deleted_count', v_deleted
),
now()
)
ON CONFLICT (job_name) DO UPDATE
SET last_run_at = EXCLUDED.last_run_at,
last_status = 'success',
last_error = NULL,
last_http_status = NULL,
last_request_id = NULL,
expected_interval_seconds = 86400,
last_metadata = EXCLUDED.last_metadata,
updated_at = now();

RETURN v_deleted;
EXCEPTION WHEN OTHERS THEN
INSERT INTO public.cron_heartbeats (
job_name, last_run_at, last_status, last_error, last_http_status,
last_request_id, expected_interval_seconds, last_metadata, updated_at
) VALUES (
'cleanup-expired-unsubscribe-tokens', now(), 'failed', SQLERRM, NULL,
NULL, 86400,
jsonb_build_object(
'wrapper', 'run_cleanup_expired_unsubscribe_tokens_with_heartbeat',
'error', SQLERRM
),
now()
)
ON CONFLICT (job_name) DO UPDATE
SET last_run_at = EXCLUDED.last_run_at,
last_status = 'failed',
last_error = EXCLUDED.last_error,
last_http_status = NULL,
last_request_id = NULL,
expected_interval_seconds = 86400,
last_metadata = EXCLUDED.last_metadata,
updated_at = now();
RAISE;
END;
$function$;

-- 2. Seed heartbeat row (preserve history on conflict)
INSERT INTO public.cron_heartbeats (
job_name, last_status, expected_interval_seconds, updated_at
) VALUES (
'cleanup-expired-unsubscribe-tokens', 'pending', 86400, now()
)
ON CONFLICT (job_name) DO UPDATE
SET expected_interval_seconds = 86400,
updated_at = now();

-- 3. Repoint jobid 18 to the wrapper. Preserve jobid, jobname, schedule, active.
-- Guard: clean disposable-DB replay may not have jobid 18 registered if the
-- historical cron.schedule migration that created it was itself guarded/skipped.
DO $guard$
BEGIN
IF EXISTS (SELECT 1 FROM cron.job WHERE jobid = 18) THEN
PERFORM cron.alter_job(
job_id := 18,
command := 'SELECT public.run_cleanup_expired_unsubscribe_tokens_with_heartbeat();'
);
END IF;
END
$guard$;
