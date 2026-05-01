-- Cron Stage 2A: re-enable dispatch-acceptance-receipts only.
-- No command/schedule changes. Reversible via cron.alter_job(20, active := false).
SELECT cron.alter_job(job_id := 20, active := true);