-- Reconciliation alarms function for admin risk dashboard
-- Returns operational mismatches between engagements, dispatches, receipts and attestations.

CREATE OR REPLACE FUNCTION public.admin_get_reconciliation_alarms(
  p_severity TEXT DEFAULT NULL,
  p_alarm_type TEXT DEFAULT NULL,
  p_since TIMESTAMPTZ DEFAULT (now() - interval '7 days'),
  p_limit INT DEFAULT 200
)
RETURNS TABLE (
  alarm_id TEXT,
  alarm_type TEXT,
  severity TEXT,
  engagement_id UUID,
  match_id UUID,
  org_id UUID,
  counterparty_email TEXT,
  detected_at TIMESTAMPTZ,
  summary TEXT,
  detail JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only platform admins or auditors
  IF NOT (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  -- 1. Accepted but no notification dispatch within 5 minutes of acceptance
  SELECT
    ('A1:' || e.id::text)::text AS alarm_id,
    'accepted_without_notification'::text AS alarm_type,
    'critical'::text AS severity,
    e.id AS engagement_id,
    e.match_id,
    e.org_id,
    e.counterparty_email,
    e.responded_at AS detected_at,
    ('Engagement accepted at ' || to_char(e.responded_at, 'YYYY-MM-DD HH24:MI') || ' but no notification dispatch recorded within 5 minutes')::text AS summary,
    jsonb_build_object(
      'engagement_status', e.engagement_status,
      'responded_at', e.responded_at,
      'window_minutes', 5
    ) AS detail
  FROM public.poi_engagements e
  WHERE e.engagement_status = 'accepted'
    AND e.responded_at IS NOT NULL
    AND e.responded_at >= p_since
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_dispatches nd
      WHERE nd.reference_type = 'engagement'
        AND nd.reference_id = e.id
        AND nd.created_at <= e.responded_at + interval '5 minutes'
        AND nd.created_at >= e.responded_at - interval '1 minute'
    )

  UNION ALL

  -- 2. Acceptance receipts with no signed attestation linked
  SELECT
    ('A2:' || r.id::text)::text,
    'receipt_missing_attestation'::text,
    'high'::text,
    r.engagement_id,
    r.match_id,
    r.initiator_org_id AS org_id,
    r.counterparty_email,
    r.created_at AS detected_at,
    ('Acceptance receipt ' || substring(r.id::text, 1, 8) || ' has no linked signed attestation')::text,
    jsonb_build_object(
      'receipt_id', r.id,
      'signature_hash_prefix', substring(r.signature_hash, 1, 12)
    )
  FROM public.acceptance_receipts r
  WHERE r.created_at >= p_since
    AND r.attestation_id IS NULL

  UNION ALL

  -- 3. Notification dispatches stuck in pending > 10 minutes
  SELECT
    ('A3:' || nd.id::text)::text,
    'dispatch_stuck_pending'::text,
    'high'::text,
    CASE WHEN nd.reference_type = 'engagement' THEN nd.reference_id ELSE NULL END,
    NULL::uuid,
    nd.recipient_org_id,
    nd.recipient_address,
    nd.created_at,
    ('Dispatch ' || nd.template_name || ' to ' || coalesce(nd.recipient_address, 'unknown') || ' stuck pending for ' || extract(epoch from (now() - nd.created_at))::int / 60 || ' minutes')::text,
    jsonb_build_object(
      'dispatch_id', nd.id,
      'template_name', nd.template_name,
      'event_type', nd.event_type,
      'minutes_pending', extract(epoch from (now() - nd.created_at))::int / 60
    )
  FROM public.notification_dispatches nd
  WHERE nd.status = 'pending'
    AND nd.created_at < now() - interval '10 minutes'
    AND nd.created_at >= p_since

  UNION ALL

  -- 4. Dispatches marked delivered but missing provider message_id (parity break)
  SELECT
    ('A4:' || nd.id::text)::text,
    'delivered_without_message_id'::text,
    'medium'::text,
    CASE WHEN nd.reference_type = 'engagement' THEN nd.reference_id ELSE NULL END,
    NULL::uuid,
    nd.recipient_org_id,
    nd.recipient_address,
    coalesce(nd.delivered_at, nd.updated_at),
    ('Dispatch ' || nd.template_name || ' marked delivered without provider message_id')::text,
    jsonb_build_object(
      'dispatch_id', nd.id,
      'template_name', nd.template_name,
      'delivered_at', nd.delivered_at
    )
  FROM public.notification_dispatches nd
  WHERE nd.status = 'delivered'
    AND (nd.message_id IS NULL OR nd.message_id = '')
    AND coalesce(nd.delivered_at, nd.updated_at) >= p_since

  ORDER BY 4 DESC NULLS LAST, 7 DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_reconciliation_alarms(TEXT, TEXT, TIMESTAMPTZ, INT) TO authenticated;