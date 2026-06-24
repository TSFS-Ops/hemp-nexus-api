CREATE OR REPLACE FUNCTION public.reconcile_acceptance_notifications()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_alarm_count integer := 0;
  v_resolved_count integer := 0;
  v_pre_backfill_resolved_count integer := 0;
  v_existing_alarm_id uuid;
  v_dedup_key text;
  v_resolved_ids uuid[];
  v_pre_resolved_ids uuid[];
  -- Earliest observed notification_dispatches.created_at for
  -- reference_type='acceptance_receipt' (dispatch-tracking backfill point).
  v_dispatch_backfill_cutoff timestamptz := '2026-04-23 09:46:24+00'::timestamptz;
BEGIN
  -- Detection pass: raise alarm for receipts older than 5 minutes that have
  -- no delivered/opened email notification dispatch.
  FOR r IN
    SELECT
      ar.id AS receipt_id,
      ar.engagement_id,
      ar.match_id,
      ar.initiator_org_id,
      ar.accepted_at,
      ar.counterparty_email,
      (
        SELECT nd.status FROM notification_dispatches nd
        WHERE nd.reference_id = ar.id AND nd.channel = 'email'
        ORDER BY nd.created_at DESC LIMIT 1
      ) AS latest_email_status
    FROM acceptance_receipts ar
    WHERE ar.accepted_at < now() - interval '5 minutes'
      AND ar.accepted_at > now() - interval '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM notification_dispatches nd
        WHERE nd.reference_id = ar.id
          AND nd.channel = 'email'
          AND nd.status IN ('delivered', 'opened')
      )
  LOOP
    v_dedup_key := 'acceptance_receipt_not_notified:' || r.receipt_id::text;

    SELECT id INTO v_existing_alarm_id
    FROM admin_risk_items
    WHERE (dedup_key = v_dedup_key
           OR title = format('Acceptance receipt %s not notified', r.receipt_id))
      AND status <> 'resolved'
    LIMIT 1;

    IF v_existing_alarm_id IS NULL THEN
      INSERT INTO admin_risk_items (title, description, severity, status, kind, dedup_key)
      VALUES (
        format('Acceptance receipt %s not notified', r.receipt_id),
        format(
          'Engagement %s was accepted at %s but the initiator org %s has no delivered email notification (latest dispatch status: %s). Match: %s. Counterparty: %s.',
          r.engagement_id, r.accepted_at, r.initiator_org_id,
          COALESCE(r.latest_email_status, 'none'),
          r.match_id, COALESCE(r.counterparty_email, 'unknown')
        ),
        'high',
        'open',
        'acceptance_receipt_not_notified',
        v_dedup_key
      );
      v_alarm_count := v_alarm_count + 1;
    END IF;
  END LOOP;

  -- B1 auto-resolve pass: close stale false-positive open risk items whose
  -- referenced acceptance receipt now has a delivered/opened dispatch.
  -- Transaction-local bypass of admin_risk_items_update_guard_trg (same
  -- mechanism used by public.resolve_admin_risk_item and
  -- public.system_resolve_cron_risk_items). GUC is txn-scoped; never leaks.
  PERFORM set_config('app.allow_risk_item_update', 'on', true);

  WITH to_resolve AS (
    SELECT ari.id
    FROM admin_risk_items ari
    JOIN acceptance_receipts ar
      ON ari.title = format('Acceptance receipt %s not notified', ar.id)
    WHERE ari.status <> 'resolved'
      AND ari.title LIKE 'Acceptance receipt % not notified'
      AND EXISTS (
        SELECT 1 FROM notification_dispatches nd
        WHERE nd.reference_id = ar.id
          AND nd.channel = 'email'
          AND nd.status IN ('delivered', 'opened')
      )
  ), updated AS (
    UPDATE admin_risk_items ari
       SET status = 'resolved',
           resolved_at = now(),
           updated_at = now(),
           metadata = COALESCE(ari.metadata, '{}'::jsonb)
                      || jsonb_build_object(
                           'auto_resolved_reason', 'acceptance_receipt_delivered',
                           'auto_resolved_by',     'reconcile_acceptance_notifications',
                           'auto_resolved_at',     to_jsonb(now())
                         )
      FROM to_resolve t
     WHERE ari.id = t.id
    RETURNING ari.id
  )
  SELECT array_agg(id), count(*) INTO v_resolved_ids, v_resolved_count FROM updated;

  IF v_resolved_count > 0 THEN
    INSERT INTO admin_audit_logs(
      admin_user_id, action, target_type, target_id, details
    )
    SELECT NULL,
           'admin_risk_item.auto_resolved',
           'admin_risk_item',
           rid,
           jsonb_build_object(
             'reason', 'acceptance_receipt_delivered',
             'source', 'reconcile_acceptance_notifications'
           )
    FROM unnest(v_resolved_ids) AS rid;
  END IF;

  -- B2 pre-backfill auto-resolve pass: close stale historical false-positive
  -- risk items whose referenced receipt pre-dates the dispatch-tracking
  -- backfill, has no notification_dispatches row at all, and has no
  -- corresponding acceptance-receipt email_send_log entry near the receipt
  -- date. These are not retryable: they are not evidence of a real send
  -- failure, only evidence that dispatch tracking did not yet exist.
  PERFORM set_config('app.allow_risk_item_update', 'on', true);

  WITH to_resolve_pre AS (
    SELECT ari.id
    FROM admin_risk_items ari
    JOIN acceptance_receipts ar
      ON ari.title = format('Acceptance receipt %s not notified', ar.id)
    WHERE ari.status = 'open'
      AND (
            ari.kind = 'acceptance_receipt_not_notified'
         OR ari.title LIKE 'Acceptance receipt % not notified'
          )
      AND ar.created_at < v_dispatch_backfill_cutoff
      AND NOT EXISTS (
        SELECT 1 FROM notification_dispatches nd
        WHERE nd.reference_type = 'acceptance_receipt'
          AND nd.reference_id   = ar.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM email_send_log esl
        WHERE esl.template_name = 'acceptance-receipt'
          AND esl.created_at BETWEEN ar.created_at - interval '1 day'
                                 AND ar.created_at + interval '7 days'
          AND (
                (ar.counterparty_email   IS NOT NULL AND esl.recipient_email = ar.counterparty_email)
             OR (ar.accepting_user_email IS NOT NULL AND esl.recipient_email = ar.accepting_user_email)
              )
      )
  ), updated_pre AS (
    UPDATE admin_risk_items ari
       SET status = 'resolved',
           resolved_at = now(),
           updated_at = now(),
           metadata = COALESCE(ari.metadata, '{}'::jsonb)
                      || jsonb_build_object(
                           'auto_resolved_reason', 'acceptance_receipt_pre_backfill_no_dispatch',
                           'auto_resolved_by',     'reconcile_acceptance_notifications',
                           'auto_resolved_at',     to_jsonb(now()),
                           'pre_backfill_cutoff',  to_jsonb(v_dispatch_backfill_cutoff)
                         )
      FROM to_resolve_pre t
     WHERE ari.id = t.id
    RETURNING ari.id
  )
  SELECT array_agg(id), count(*) INTO v_pre_resolved_ids, v_pre_backfill_resolved_count FROM updated_pre;

  IF v_pre_backfill_resolved_count > 0 THEN
    INSERT INTO admin_audit_logs(
      admin_user_id, action, target_type, target_id, details
    )
    SELECT NULL,
           'admin_risk_item.auto_resolved',
           'admin_risk_item',
           rid,
           jsonb_build_object(
             'reason', 'acceptance_receipt_pre_backfill_no_dispatch',
             'source', 'reconcile_acceptance_notifications',
             'pre_backfill_cutoff', to_jsonb(v_dispatch_backfill_cutoff)
           )
    FROM unnest(v_pre_resolved_ids) AS rid;
  END IF;

  RETURN jsonb_build_object(
    'checked_at',                 now(),
    'alarms_raised',              v_alarm_count,
    'auto_resolved',              v_resolved_count,
    'pre_backfill_auto_resolved', v_pre_backfill_resolved_count
  );
END;
$function$;