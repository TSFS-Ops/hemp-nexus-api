CREATE OR REPLACE FUNCTION public.purge_old_email_send_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH d AS (
    DELETE FROM public.email_send_log
    WHERE created_at < now() - interval '90 days'
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM d;

  -- Always record an audit entry, even when nothing was deleted, so absence of
  -- evidence cannot be confused with absence of execution.
  INSERT INTO public.admin_audit_logs (action, target_type, details)
  VALUES (
    'email_send_log.purge',
    'email_send_log',
    jsonb_build_object(
      'rows_deleted', deleted_count,
      'retention_days', 90,
      'executed_at', now()
    )
  );

  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_email_send_log() FROM PUBLIC, anon, authenticated;