-- Read-only health probe for the email_send_log retention purge.
-- Returns last successful run, rows deleted, hours since last run, and whether
-- the cron job is currently scheduled and active. Admin-only; SECURITY DEFINER
-- so callers do not need direct read access to admin_audit_logs or cron.job.
CREATE OR REPLACE FUNCTION public.get_email_retention_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $$
DECLARE
  v_last_run timestamptz;
  v_last_deleted integer;
  v_hours_since numeric;
  v_cron_active boolean;
  v_cron_schedule text;
  v_total_rows integer;
  v_oldest timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT created_at, (details->>'rows_deleted')::int
    INTO v_last_run, v_last_deleted
  FROM public.admin_audit_logs
  WHERE action = 'email_send_log.purge'
  ORDER BY created_at DESC
  LIMIT 1;

  v_hours_since := CASE
    WHEN v_last_run IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (now() - v_last_run)) / 3600.0
  END;

  SELECT active, schedule
    INTO v_cron_active, v_cron_schedule
  FROM cron.job
  WHERE jobname = 'purge-email-send-log-daily'
  LIMIT 1;

  SELECT count(*), min(created_at)
    INTO v_total_rows, v_oldest
  FROM public.email_send_log;

  RETURN jsonb_build_object(
    'retention_days', 90,
    'last_run_at', v_last_run,
    'last_run_rows_deleted', v_last_deleted,
    'hours_since_last_run', v_hours_since,
    'cron_active', COALESCE(v_cron_active, false),
    'cron_schedule', v_cron_schedule,
    'current_row_count', v_total_rows,
    'oldest_row_at', v_oldest,
    'healthy', (
      COALESCE(v_cron_active, false)
      AND (v_last_run IS NULL OR v_hours_since < 26)
    ),
    'suppressed_emails_note', 'suppressed_emails table is intentionally exempt from purge to maintain permanent bounce/complaint suppression as required for sender reputation.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_email_retention_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_email_retention_health() TO authenticated;

COMMENT ON FUNCTION public.get_email_retention_health() IS
  'Admin-only health probe for the email_send_log 90-day retention purge. Surfaces last-run timestamp, rows deleted, cron schedule, and a healthy flag (false if cron inactive or last run >26h ago).';