
-- C6 lifecycle-scheduler timeout remediation:
-- 1) Add optional p_timeout_milliseconds param to public.cron_invoke (default 5000, preserved).
-- 2) Repoint only the lifecycle-scheduler-job cron command to pass 15000 ms.

-- Drop existing 3-arg signature so we can extend with a defaulted 4th arg
-- (CREATE OR REPLACE cannot add a new parameter to an existing function).
DROP FUNCTION IF EXISTS public.cron_invoke(text, text, jsonb);

CREATE OR REPLACE FUNCTION public.cron_invoke(
  p_job_name             text,
  p_url                  text,
  p_body                 jsonb   DEFAULT '{}'::jsonb,
  p_timeout_milliseconds integer DEFAULT 5000
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault', 'net'
AS $function$
DECLARE
  v_key      text;
  v_req      bigint;
  v_run_id   uuid := gen_random_uuid();
  v_body     jsonb;
  v_meta     jsonb;
  v_timeout  integer;
BEGIN
  -- Clamp timeout to a safe range; default 5000 ms preserved for all
  -- existing 3-arg callers. Lifecycle-scheduler-job opts in to 15000.
  v_timeout := GREATEST(1000, LEAST(30000, COALESCE(p_timeout_milliseconds, 5000)));

  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'INTERNAL_CRON_KEY'
  LIMIT 1;

  IF v_key IS NULL THEN
    UPDATE public.cron_heartbeats
       SET last_run_at        = now(),
           last_status        = 'failed',
           last_error         = 'INTERNAL_CRON_KEY missing from vault',
           last_http_status   = NULL,
           last_correlation_id = v_run_id,
           last_metadata      = jsonb_build_object(
             'cron_job_name', p_job_name,
             'url', p_url,
             'missing_secret', true,
             'correlation_written_at', now()
           ),
           updated_at         = now()
     WHERE job_name = p_job_name;
    RETURN NULL;
  END IF;

  v_body := COALESCE(p_body, '{}'::jsonb)
            || jsonb_build_object(
                 'cron_run_id',   v_run_id,
                 'cron_job_name', p_job_name
               );

  SELECT net.http_post(
    url                  := p_url,
    headers              := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-internal-key', v_key
    ),
    body                 := v_body,
    timeout_milliseconds := v_timeout
  ) INTO v_req;

  v_meta := jsonb_build_object(
    'cron_job_name',          p_job_name,
    'url',                    p_url,
    'pg_net_request_id',      v_req,
    'timeout_milliseconds',   v_timeout,
    'correlation_written_at', now()
  );

  INSERT INTO public.cron_heartbeats AS h
    (job_name, last_run_at, last_request_id, last_status,
     last_http_status, last_error, last_correlation_id, last_metadata, updated_at)
  VALUES
    (p_job_name, now(), v_req, 'pending', NULL, NULL, v_run_id, v_meta, now())
  ON CONFLICT (job_name) DO UPDATE
    SET last_run_at         = EXCLUDED.last_run_at,
        last_request_id     = EXCLUDED.last_request_id,
        last_status         = 'pending',
        last_http_status    = NULL,
        last_error          = NULL,
        last_correlation_id = EXCLUDED.last_correlation_id,
        last_metadata       = EXCLUDED.last_metadata,
        updated_at          = now();

  RETURN v_req;
END;
$function$;

-- Repoint ONLY the lifecycle-scheduler-job (jobid 3) to pass a 15s timeout.
-- Schedule, active state, URL, payload, job name, and heartbeat name are preserved.
SELECT cron.alter_job(
  job_id  := 3,
  command := $cmd$
    SELECT public.cron_invoke(
      'lifecycle-scheduler',
      'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/lifecycle-scheduler',
      jsonb_build_object('time', now(), 'source', 'cron:lifecycle-scheduler-job'),
      15000
    );
  $cmd$
);
