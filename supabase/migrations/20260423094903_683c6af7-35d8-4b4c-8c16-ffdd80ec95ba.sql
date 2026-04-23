
CREATE OR REPLACE FUNCTION public.reconcile_acceptance_notifications()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
  v_alarm_count integer := 0;
  v_existing_alarm_id uuid;
BEGIN
  FOR r IN
    SELECT
      ar.id AS receipt_id,
      ar.engagement_id,
      ar.match_id,
      ar.initiator_org_id,
      ar.accepted_at,
      ar.counterparty_email
    FROM acceptance_receipts ar
    WHERE ar.accepted_at < now() - interval '5 minutes'
      AND ar.accepted_at > now() - interval '7 days'
      AND NOT (ar.metadata->>'backfilled')::boolean IS TRUE
      AND NOT EXISTS (
        SELECT 1 FROM notification_dispatches nd
        WHERE nd.reference_id = ar.id
          AND nd.channel = 'email'
          AND nd.status IN ('delivered', 'opened')
      )
  LOOP
    SELECT id INTO v_existing_alarm_id
    FROM admin_risk_items
    WHERE title = format('Acceptance receipt %s not notified', r.receipt_id)
      AND status <> 'resolved'
    LIMIT 1;

    IF v_existing_alarm_id IS NULL THEN
      INSERT INTO admin_risk_items (title, description, severity, status)
      VALUES (
        format('Acceptance receipt %s not notified', r.receipt_id),
        format(
          'Engagement %s was accepted at %s but the initiator org %s has no delivered email notification. Match: %s. Counterparty: %s.',
          r.engagement_id, r.accepted_at, r.initiator_org_id, r.match_id, COALESCE(r.counterparty_email, 'unknown')
        ),
        'high',
        'open'
      );
      v_alarm_count := v_alarm_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('checked_at', now(), 'alarms_raised', v_alarm_count);
END;
$$;

COMMENT ON FUNCTION public.reconcile_acceptance_notifications() IS
'Reconciliation alarm: detects accepted engagements whose initiator was never successfully notified, raising a high-severity admin_risk_items entry. Run via pg_cron every 2 minutes.';
