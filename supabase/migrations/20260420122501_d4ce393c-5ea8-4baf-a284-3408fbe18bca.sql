DROP FUNCTION IF EXISTS public.check_engagement_log_integrity();

CREATE FUNCTION public.check_engagement_log_integrity()
RETURNS TABLE(out_engagement_id uuid, issue_type text, details text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT pe.id, 'STATE_LOG_DRIFT'::text,
         format('engagement_status=%s but latest log new_status=%s', pe.engagement_status, latest.new_status)::text
  FROM poi_engagements pe
  JOIN LATERAL (
    SELECT eol2.new_status FROM engagement_outreach_logs eol2
    WHERE eol2.engagement_id = pe.id ORDER BY eol2.created_at DESC LIMIT 1
  ) latest ON true
  WHERE pe.engagement_status::text <> latest.new_status;

  RETURN QUERY
  SELECT pe.id, 'ADMIN_UPDATE_NO_LOG'::text,
         format('admin_audit_logs row %s has no matching outreach log', aal.id)::text
  FROM poi_engagements pe
  JOIN admin_audit_logs aal
    ON aal.target_id::uuid = pe.id
    AND aal.action = 'engagement.updated'
    AND aal.created_at > now() - interval '30 days'
  LEFT JOIN engagement_outreach_logs eol
    ON eol.engagement_id = pe.id
    AND eol.admin_user_id = aal.admin_user_id
    AND eol.created_at BETWEEN aal.created_at - interval '10 seconds' AND aal.created_at + interval '10 seconds'
  WHERE eol.id IS NULL;

  RETURN QUERY
  SELECT pe.id, 'COUNTERPARTY_RESP_NO_LOG'::text,
         format('audit_logs row %s has no matching counterparty outreach log', al.id)::text
  FROM poi_engagements pe
  JOIN audit_logs al
    ON al.entity_id::uuid = pe.id
    AND al.action = 'engagement.counterparty_responded'
    AND al.created_at > now() - interval '30 days'
  LEFT JOIN engagement_outreach_logs eol
    ON eol.engagement_id = pe.id
    AND eol.actor_type = 'counterparty'
    AND eol.created_at BETWEEN al.created_at - interval '10 seconds' AND al.created_at + interval '10 seconds'
  WHERE eol.id IS NULL;

  RETURN QUERY
  SELECT pe.id, 'EXPIRED_NO_SYSTEM_LOG'::text,
         'engagement is expired but no system_action log row exists'::text
  FROM poi_engagements pe
  WHERE pe.engagement_status = 'expired'
    AND NOT EXISTS (
      SELECT 1 FROM engagement_outreach_logs eol
      WHERE eol.engagement_id = pe.id AND eol.actor_type = 'system'
    );

  RETURN QUERY
  SELECT pe.id, 'NAME_EMAIL_CONTAMINATION'::text,
         format('match %s carries email-shaped value in buyer_name or seller_name', m.id)::text
  FROM poi_engagements pe
  JOIN matches m ON m.id = pe.match_id
  WHERE pe.engagement_status = 'accepted'
    AND ((m.buyer_name LIKE '%@%' AND length(m.buyer_name) < 320)
      OR (m.seller_name LIKE '%@%' AND length(m.seller_name) < 320));

  -- CHAIN_GAP: skip rows where the prior row is an explicit reconciliation marker.
  -- Reconciliation markers (admin_name starting with 'Chain Reconciler' or
  -- 'Lifecycle Scheduler (legacy backfill)') are documented chain boundaries —
  -- the row immediately following such a marker is allowed to reset previous_status.
  RETURN QUERY
  WITH ranked AS (
    SELECT eol.engagement_id AS eid, eol.previous_status AS ps, eol.new_status AS ns,
           eol.created_at AS ca, eol.admin_name AS name_cur,
      LAG(eol.new_status) OVER (PARTITION BY eol.engagement_id ORDER BY eol.created_at) AS prev_log,
      LAG(eol.admin_name) OVER (PARTITION BY eol.engagement_id ORDER BY eol.created_at) AS prev_name,
      ROW_NUMBER() OVER (PARTITION BY eol.engagement_id ORDER BY eol.created_at) AS rn
    FROM engagement_outreach_logs eol
  )
  SELECT r.eid, 'CHAIN_GAP'::text,
         format('row at %s expects previous_status=%s but actual prior new_status=%s', r.ca, r.ps, r.prev_log)::text
  FROM ranked r
  WHERE r.rn > 1
    AND r.prev_log IS DISTINCT FROM r.ps
    AND COALESCE(r.prev_name, '') NOT LIKE 'Chain Reconciler%'
    AND COALESCE(r.prev_name, '') NOT LIKE 'Lifecycle Scheduler (legacy backfill)%'
    AND COALESCE(r.name_cur, '') NOT LIKE 'Chain Reconciler%';
END;
$$;