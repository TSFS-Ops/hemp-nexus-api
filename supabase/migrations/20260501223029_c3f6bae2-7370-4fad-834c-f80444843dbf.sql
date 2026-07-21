-- Cron Stage 1: re-enable two low-risk jobs only.
-- No command or schedule changes. Reversible via cron.alter_job(..., active := false).
-- Guarded on jobid existence: a disposable clean-replay database has a
-- different cron.job id sequence than production (ids are assigned by
-- the order cron.schedule() has been called across all migration
-- history), so jobid 21/17 are not guaranteed to exist here. This does
-- not change production behaviour where both jobs already exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobid = 21) THEN
    PERFORM cron.alter_job(job_id := 21, active := true); -- reconcile-acceptance-notifications (every 2 min, pure SQL)
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobid = 17) THEN
    PERFORM cron.alter_job(job_id := 17, active := true); -- outreach-sla-monitor-hourly (hourly, edge fn)
  END IF;
END $$;
