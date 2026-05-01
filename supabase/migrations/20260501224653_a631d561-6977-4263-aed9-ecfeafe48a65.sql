-- Rollback Stage 2B: pause the rescheduled job pending key reconciliation.
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'engagement-reminder-daily'),
  active := false
);