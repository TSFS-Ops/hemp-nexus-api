-- Cron Stage 1: re-enable two low-risk jobs only.
-- No command or schedule changes. Reversible via cron.alter_job(..., active := false).
SELECT cron.alter_job(job_id := 21, active := true); -- reconcile-acceptance-notifications (every 2 min, pure SQL)
SELECT cron.alter_job(job_id := 17, active := true); -- outreach-sla-monitor-hourly (hourly, edge fn)