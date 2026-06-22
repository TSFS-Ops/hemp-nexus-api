
-- Step A: temporarily disable higher-risk cron jobs via cron.alter_job
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid, jobname
      FROM cron.job
     WHERE jobname IN (
       'engagement-reminder-daily',
       'webhook-retry-job',
       'infra-alerts-cron'
     )
  LOOP
    PERFORM cron.alter_job(job_id := r.jobid, active := false);
  END LOOP;
END $$;

-- Step B: minimal fix to public.cron_invoke
CREATE OR REPLACE FUNCTION public.cron_invoke(p_job_name text, p_url text, p_body jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'net'
AS $function$
DECLARE
  v_key text;
  v_req bigint;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'INTERNAL_CRON_KEY'
  LIMIT 1;

  IF v_key IS NULL THEN
    UPDATE public.cron_heartbeats
       SET last_run_at  = now(),
           last_status  = 'failed',
           last_error   = 'INTERNAL_CRON_KEY missing from vault',
           last_http_status = NULL,
           updated_at   = now()
     WHERE job_name = p_job_name;
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url     := p_url,
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-internal-key', v_key
    ),
    body    := COALESCE(p_body, '{}'::jsonb)
  ) INTO v_req;

  INSERT INTO public.cron_heartbeats AS h
    (job_name, last_run_at, last_request_id, last_status,
     last_http_status, last_error, updated_at)
  VALUES
    (p_job_name, now(), v_req, 'pending', NULL, NULL, now())
  ON CONFLICT (job_name) DO UPDATE
    SET last_run_at      = EXCLUDED.last_run_at,
        last_request_id  = EXCLUDED.last_request_id,
        last_status      = 'pending',
        last_http_status = NULL,
        last_error       = NULL,
        updated_at       = now();

  RETURN v_req;
END;
$function$;
