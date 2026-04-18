-- 1. Allow platform admins to audit the log directly (raw access for incident response)
CREATE POLICY "Platform admins can read send log"
  ON public.email_send_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2. Masked view for general admin audit UI (hides full email, exposes domain only)
CREATE OR REPLACE VIEW public.email_send_log_masked
WITH (security_invoker = on) AS
SELECT
  id,
  template_name,
  status,
  message_id,
  -- Mask local-part: j***@example.com
  CASE
    WHEN recipient_email IS NULL OR position('@' in recipient_email) = 0 THEN '***'
    ELSE left(split_part(recipient_email, '@', 1), 1) || '***@' || split_part(recipient_email, '@', 2)
  END AS recipient_email_masked,
  split_part(recipient_email, '@', 2) AS recipient_domain,
  error_message,
  metadata,
  created_at
FROM public.email_send_log;

GRANT SELECT ON public.email_send_log_masked TO authenticated;

-- 3. Retention purge: delete log rows older than 90 days
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
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_email_send_log() FROM PUBLIC, anon, authenticated;