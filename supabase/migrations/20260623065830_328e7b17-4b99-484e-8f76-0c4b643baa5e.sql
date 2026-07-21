DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'webhook-retry-job') THEN
    PERFORM cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'webhook-retry-job'), active := true);
  END IF;
END
$guard$;
