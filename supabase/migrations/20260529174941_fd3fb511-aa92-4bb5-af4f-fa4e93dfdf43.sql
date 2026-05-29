-- DATA-004 Phase 4 — HQ Retention Health helper.
-- Returns the cron.job rows that schedule the email_send_log purge edge
-- function, classifying each as dry_run vs live by inspecting the
-- command text for an explicit `'dry_run', true` / `"dry_run": true`
-- payload pinning. SECURITY DEFINER + service_role only so the HQ
-- health endpoint can surface the scheduling state without exposing
-- cron.job to other roles.

CREATE OR REPLACE FUNCTION public.get_purge_email_send_log_cron_jobs()
RETURNS TABLE (
  jobid bigint,
  jobname text,
  schedule text,
  active boolean,
  is_dry_run boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT
    j.jobid,
    j.jobname,
    j.schedule,
    j.active,
    (
      j.command ~* '[''"]dry_run[''"]\s*[:,]\s*true'
      AND j.command !~* '[''"]dry_run[''"]\s*[:,]\s*false'
    ) AS is_dry_run
  FROM cron.job j
  WHERE j.command ILIKE '%/functions/v1/purge-email-send-log-daily%'
$$;

REVOKE ALL ON FUNCTION public.get_purge_email_send_log_cron_jobs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_purge_email_send_log_cron_jobs() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_purge_email_send_log_cron_jobs() TO service_role;