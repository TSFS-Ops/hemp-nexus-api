
CREATE OR REPLACE FUNCTION public.check_engagement_email_delivery()
RETURNS TABLE(
  engagement_id uuid,
  match_id uuid,
  counterparty_email text,
  engagement_status text,
  email_status text,
  issue text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pe.id AS engagement_id,
    pe.match_id,
    pe.counterparty_email,
    pe.engagement_status::text,
    COALESCE(esl.status, 'NO_RECORD')::text AS email_status,
    CASE
      WHEN esl.id IS NULL THEN 'No email_send_log entry found for this engagement'
      WHEN esl.status = 'failed' THEN format('Email delivery failed: %s', esl.error_message)
      ELSE 'Email status: ' || esl.status
    END::text AS issue
  FROM poi_engagements pe
  LEFT JOIN email_send_log esl ON (
    esl.metadata->>'engagement_id' = pe.id::text
    OR esl.recipient_email = pe.counterparty_email
  )
  WHERE pe.engagement_status::text = 'notification_sent'
    AND (esl.id IS NULL OR esl.status != 'sent')
  ORDER BY pe.created_at DESC;
END;
$$;
