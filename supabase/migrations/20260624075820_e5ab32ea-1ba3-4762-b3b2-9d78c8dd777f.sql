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
  v_b3_send_unverifiable_count integer := 0;
  v_b3_email_log_count integer := 0;
  v_b3_no_recipient_count integer := 0;
  v_b3_total_count integer := 0;
  v_existing_alarm_id uuid;
  v_dedup_key text;
  v_resolved_ids uuid[];
  v_pre_resolved_ids uuid[];
  v_b3_send_unverifiable_ids uuid[];
  v_b3_email_log_ids uuid[];
  v_b3_no_recipient_ids uuid[];
  v_dispatch_backfill_cutoff timestamptz := '2026-04-23 09:46:24+00'::timestamptz;
  v_inclusive_backfill_cutoff timestamptz := '2026-04-23 09:46:24.999999+00'::timestamptz;
BEGIN
  -- Detection pass.
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

  -- B1
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

  -- B2
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

  -- B3 Branch 1
  PERFORM set_config('app.allow_risk_item_update', 'on', true);

  WITH to_resolve_b3a AS (
    SELECT ari.id
    FROM admin_risk_items ari
    JOIN acceptance_receipts ar
      ON ari.title = format('Acceptance receipt %s not notified', ar.id)
    WHERE ari.status = 'open'
      AND (
            ari.kind = 'acceptance_receipt_not_notified'
         OR ari.title LIKE 'Acceptance receipt % not notified'
          )
      AND ar.created_at <= v_inclusive_backfill_cutoff
      AND EXISTS (
        SELECT 1 FROM notification_dispatches nd
        WHERE nd.reference_type = 'acceptance_receipt'
          AND nd.reference_id   = ar.id
          AND nd.channel        = 'in_app'
          AND nd.status IN ('delivered', 'opened')
      )
      AND EXISTS (
        SELECT 1 FROM notification_dispatches nd
        WHERE nd.reference_type = 'acceptance_receipt'
          AND nd.reference_id   = ar.id
          AND nd.channel        = 'email'
          AND nd.status         = 'failed'
          AND COALESCE(nd.error_message, '') ILIKE '%send_unverifiable%'
      )
  ), updated_b3a AS (
    UPDATE admin_risk_items ari
       SET status = 'resolved',
           resolved_at = now(),
           updated_at = now(),
           metadata = COALESCE(ari.metadata, '{}'::jsonb)
                      || jsonb_build_object(
                           'auto_resolved_reason', 'acceptance_receipt_pre_backfill_email_send_unverifiable_terminal',
                           'auto_resolved_by',     'reconcile_acceptance_notifications',
                           'auto_resolved_at',     to_jsonb(now()),
                           'inclusive_backfill_cutoff', to_jsonb(v_inclusive_backfill_cutoff)
                         )
      FROM to_resolve_b3a t
     WHERE ari.id = t.id
    RETURNING ari.id
  )
  SELECT array_agg(id), count(*) INTO v_b3_send_unverifiable_ids, v_b3_send_unverifiable_count FROM updated_b3a;

  IF v_b3_send_unverifiable_count > 0 THEN
    INSERT INTO admin_audit_logs(
      admin_user_id, action, target_type, target_id, details
    )
    SELECT NULL,
           'admin_risk_item.auto_resolved',
           'admin_risk_item',
           rid,
           jsonb_build_object(
             'reason', 'acceptance_receipt_pre_backfill_email_send_unverifiable_terminal',
             'source', 'reconcile_acceptance_notifications',
             'inclusive_backfill_cutoff', to_jsonb(v_inclusive_backfill_cutoff)
           )
    FROM unnest(v_b3_send_unverifiable_ids) AS rid;
  END IF;

  -- B3 Branch 2
  PERFORM set_config('app.allow_risk_item_update', 'on', true);

  WITH to_resolve_b3b AS (
    SELECT ari.id
    FROM admin_risk_items ari
    JOIN acceptance_receipts ar
      ON ari.title = format('Acceptance receipt %s not notified', ar.id)
    WHERE ari.status = 'open'
      AND (
            ari.kind = 'acceptance_receipt_not_notified'
         OR ari.title LIKE 'Acceptance receipt % not notified'
          )
      AND ar.created_at <= v_inclusive_backfill_cutoff
      AND (v_b3_send_unverifiable_ids IS NULL OR NOT (ari.id = ANY(v_b3_send_unverifiable_ids)))
      AND EXISTS (
        SELECT 1 FROM email_send_log esl
        WHERE esl.template_name = 'acceptance-receipt'
          AND esl.created_at BETWEEN ar.created_at - interval '1 day'
                                 AND ar.created_at + interval '7 days'
          AND (
                (ar.counterparty_email   IS NOT NULL AND esl.recipient_email = ar.counterparty_email)
             OR (ar.accepting_user_email IS NOT NULL AND esl.recipient_email = ar.accepting_user_email)
             OR EXISTS (
                  SELECT 1 FROM notification_dispatches nd2
                  WHERE nd2.reference_type = 'acceptance_receipt'
                    AND nd2.reference_id   = ar.id
                    AND nd2.channel        = 'email'
                    AND nd2.recipient_address IS NOT NULL
                    AND esl.recipient_email = nd2.recipient_address
                )
              )
      )
  ), updated_b3b AS (
    UPDATE admin_risk_items ari
       SET status = 'resolved',
           resolved_at = now(),
           updated_at = now(),
           metadata = COALESCE(ari.metadata, '{}'::jsonb)
                      || jsonb_build_object(
                           'auto_resolved_reason', 'acceptance_receipt_pre_backfill_email_send_log_evidence',
                           'auto_resolved_by',     'reconcile_acceptance_notifications',
                           'auto_resolved_at',     to_jsonb(now()),
                           'inclusive_backfill_cutoff', to_jsonb(v_inclusive_backfill_cutoff)
                         )
      FROM to_resolve_b3b t
     WHERE ari.id = t.id
    RETURNING ari.id
  )
  SELECT array_agg(id), count(*) INTO v_b3_email_log_ids, v_b3_email_log_count FROM updated_b3b;

  IF v_b3_email_log_count > 0 THEN
    INSERT INTO admin_audit_logs(
      admin_user_id, action, target_type, target_id, details
    )
    SELECT NULL,
           'admin_risk_item.auto_resolved',
           'admin_risk_item',
           rid,
           jsonb_build_object(
             'reason', 'acceptance_receipt_pre_backfill_email_send_log_evidence',
             'source', 'reconcile_acceptance_notifications',
             'inclusive_backfill_cutoff', to_jsonb(v_inclusive_backfill_cutoff)
           )
    FROM unnest(v_b3_email_log_ids) AS rid;
  END IF;

  -- B3 Branch 3 (B3.1 micro-repair)
  -- Same base criteria as before: open, within inclusive cutoff,
  -- NULL recipient fields, no notification_dispatches row at all.
  -- Email-log suppression is now recipient-correlated only: an
  -- email_send_log row blocks Branch 3 ONLY if its recipient_email
  -- matches a recipient signal that can be tied to this receipt
  -- (counterparty_email, accepting_user_email, or any email dispatch
  -- recipient_address). When Branch 3's base criteria hold, those
  -- recipient signals are NULL/absent, so the suppression is
  -- vacuously false and the branch resolves correctly. The shape is
  -- written generally so the predicate stays correct under any data
  -- shape (defence in depth).
  PERFORM set_config('app.allow_risk_item_update', 'on', true);

  WITH to_resolve_b3c AS (
    SELECT ari.id
    FROM admin_risk_items ari
    JOIN acceptance_receipts ar
      ON ari.title = format('Acceptance receipt %s not notified', ar.id)
    WHERE ari.status = 'open'
      AND (
            ari.kind = 'acceptance_receipt_not_notified'
         OR ari.title LIKE 'Acceptance receipt % not notified'
          )
      AND ar.created_at <= v_inclusive_backfill_cutoff
      AND ar.counterparty_email   IS NULL
      AND ar.accepting_user_email IS NULL
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
             OR EXISTS (
                  SELECT 1 FROM notification_dispatches nd2
                  WHERE nd2.reference_type = 'acceptance_receipt'
                    AND nd2.reference_id   = ar.id
                    AND nd2.channel        = 'email'
                    AND nd2.recipient_address IS NOT NULL
                    AND esl.recipient_email = nd2.recipient_address
                )
              )
      )
  ), updated_b3c AS (
    UPDATE admin_risk_items ari
       SET status = 'resolved',
           resolved_at = now(),
           updated_at = now(),
           metadata = COALESCE(ari.metadata, '{}'::jsonb)
                      || jsonb_build_object(
                           'auto_resolved_reason', 'acceptance_receipt_pre_backfill_cutoff_boundary_no_recipient',
                           'auto_resolved_by',     'reconcile_acceptance_notifications',
                           'auto_resolved_at',     to_jsonb(now()),
                           'inclusive_backfill_cutoff', to_jsonb(v_inclusive_backfill_cutoff)
                         )
      FROM to_resolve_b3c t
     WHERE ari.id = t.id
    RETURNING ari.id
  )
  SELECT array_agg(id), count(*) INTO v_b3_no_recipient_ids, v_b3_no_recipient_count FROM updated_b3c;

  IF v_b3_no_recipient_count > 0 THEN
    INSERT INTO admin_audit_logs(
      admin_user_id, action, target_type, target_id, details
    )
    SELECT NULL,
           'admin_risk_item.auto_resolved',
           'admin_risk_item',
           rid,
           jsonb_build_object(
             'reason', 'acceptance_receipt_pre_backfill_cutoff_boundary_no_recipient',
             'source', 'reconcile_acceptance_notifications',
             'inclusive_backfill_cutoff', to_jsonb(v_inclusive_backfill_cutoff)
           )
    FROM unnest(v_b3_no_recipient_ids) AS rid;
  END IF;

  v_b3_total_count := v_b3_send_unverifiable_count
                    + v_b3_email_log_count
                    + v_b3_no_recipient_count;

  RETURN jsonb_build_object(
    'checked_at',                                  now(),
    'alarms_raised',                               v_alarm_count,
    'auto_resolved',                               v_resolved_count,
    'pre_backfill_auto_resolved',                  v_pre_backfill_resolved_count,
    'cutoff_boundary_auto_resolved',               v_b3_total_count,
    'pre_backfill_send_unverifiable_auto_resolved', v_b3_send_unverifiable_count,
    'pre_backfill_email_log_auto_resolved',        v_b3_email_log_count,
    'pre_backfill_no_recipient_auto_resolved',     v_b3_no_recipient_count
  );
END;
$function$;