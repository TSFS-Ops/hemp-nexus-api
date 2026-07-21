-- Cron Stage 2A: re-enable dispatch-acceptance-receipts only.
-- No command/schedule changes. Reversible via cron.alter_job(20, active := false).
-- Guarded on jobid existence: a disposable clean-replay database has a
-- different cron.job id sequence than production, so jobid 20 is not
-- guaranteed to exist here. Production behaviour is unchanged.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobid = 20) THEN
    PERFORM cron.alter_job(job_id := 20, active := true);
  END IF;
END $guard$;
