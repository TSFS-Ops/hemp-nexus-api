-- Rollback Stage 2B: pause the rescheduled job pending key reconciliation.
-- Guarded on existence: a disposable clean-replay database may not have
-- this jobname scheduled under the same conditions as production.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'engagement-reminder-daily') THEN
    PERFORM cron.alter_job(
      job_id := (SELECT jobid FROM cron.job WHERE jobname = 'engagement-reminder-daily'),
      active := false
    );
  END IF;
END $guard$;
