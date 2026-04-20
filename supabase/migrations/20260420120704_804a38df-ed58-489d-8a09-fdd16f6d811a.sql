DROP FUNCTION IF EXISTS public.check_engagement_log_integrity();

CREATE FUNCTION public.check_engagement_log_integrity()
RETURNS TABLE(eng_id uuid, issue_type text, details text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT pe.id,
         'STATE_LOG_DRIFT'::text,
         format('engagement_status=%s but latest log new_status=%s', pe.engagement_status::text, latest.new_status::text)::text
  FROM poi_engagements pe
  JOIN LATERAL (
    SELECT eol.new_status
    FROM engagement_outreach_logs eol
    WHERE eol.engagement_id = pe.id
    ORDER BY eol.created_at DESC, eol.id DESC
    LIMIT 1
  ) latest ON true
  WHERE pe.engagement_status::text <> latest.new_status::text;

  RETURN QUERY
  SELECT aal.target_id,
         'ADMIN_UPDATE_NO_LOG'::text,
         format('admin_audit_logs row %s at %s has no matching outreach_log row from admin %s', aal.id, aal.created_at, aal.admin_user_id)::text
  FROM admin_audit_logs aal
  WHERE aal.action = 'engagement.updated'
    AND aal.created_at > now() - interval '90 days'
    AND NOT EXISTS (
      SELECT 1 FROM engagement_outreach_logs eol
      WHERE eol.engagement_id = aal.target_id
        AND eol.admin_user_id = aal.admin_user_id
        AND eol.created_at BETWEEN aal.created_at - interval '10 seconds' AND aal.created_at + interval '10 seconds'
    );

  RETURN QUERY
  SELECT al.entity_id,
         'COUNTERPARTY_RESP_NO_LOG'::text,
         format('audit_logs row %s at %s has no matching counterparty outreach_log row', al.id, al.created_at)::text
  FROM audit_logs al
  WHERE al.action = 'engagement.counterparty_responded'
    AND al.created_at > now() - interval '90 days'
    AND NOT EXISTS (
      SELECT 1 FROM engagement_outreach_logs eol
      WHERE eol.engagement_id = al.entity_id
        AND eol.actor_type = 'counterparty'
        AND eol.created_at BETWEEN al.created_at - interval '10 seconds' AND al.created_at + interval '10 seconds'
    );
END;
$$;