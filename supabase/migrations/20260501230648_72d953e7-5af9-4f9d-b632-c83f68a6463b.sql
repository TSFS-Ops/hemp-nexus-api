-- Guarded on jobid existence: a disposable clean-replay database has a
-- different cron.job id sequence than production, so jobid 23 is not
-- guaranteed to exist here. Production behaviour is unchanged.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobid = 23) THEN
    PERFORM cron.alter_job(job_id := 23, active := true);
  END IF;
END $guard$;
