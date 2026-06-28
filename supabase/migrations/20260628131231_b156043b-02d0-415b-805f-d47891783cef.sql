-- C6.5 — purge-email-send-log-daily-dryrun heartbeat coverage
-- Strict scope: jobid 39 only. Jobid 42 (live) is NOT touched.
-- Pre-apply check (documented in evidence README): public.cron_invoke preserves
-- arbitrary payload keys via COALESCE(p_body,'{}'::jsonb) || jsonb_build_object(
-- 'cron_run_id', ..., 'cron_job_name', ...). dry_run/max_orgs/max_rows_per_org/
-- source/trigger/time are forwarded unchanged; only cron_run_id and
-- cron_job_name are appended, and we do not send those keys.

-- 1) Seed heartbeat row for the dry-run job, preserving history on conflict.
INSERT INTO public.cron_heartbeats AS h
  (job_name, expected_interval_seconds, last_status, updated_at)
VALUES
  ('purge-email-send-log-daily-dryrun', 86400, 'pending', now())
ON CONFLICT (job_name) DO UPDATE
  SET expected_interval_seconds = 86400,
      updated_at = now();

-- 2) Alter jobid 39 only (purge-email-send-log-daily-dryrun) to use cron_invoke.
SELECT cron.alter_job(
  job_id  := 39,
  command := $cmd$SELECT public.cron_invoke(
  'purge-email-send-log-daily-dryrun',
  'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/purge-email-send-log-daily',
  jsonb_build_object(
    'dry_run', true,
    'max_orgs', 50,
    'max_rows_per_org', 5000,
    'source', 'cron:purge-email-send-log-daily-dryrun',
    'trigger', 'cron',
    'time', now()
  )
);$cmd$
);
