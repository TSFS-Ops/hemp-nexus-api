-- =====================================================================
-- Item 1+2: Capture identity + write signed attestation on accept
-- =====================================================================
CREATE OR REPLACE FUNCTION public.atomic_engagement_transition(
  p_engagement_id uuid,
  p_actor_type text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_new_status text,
  p_entry_type text,
  p_contact_method text DEFAULT NULL::text,
  p_contact_detail text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_audit_action text DEFAULT NULL::text,
  p_audit_org_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_engagement RECORD;
  v_lock_key bigint;
  v_log_id uuid;
  v_prev_status text;
  v_receipt_id uuid;
  v_attestation_id uuid;
  v_signed_payload text;
  v_signature_hash text;
  v_initiator_user_id uuid;
  v_initiator_email text;
  v_initiator_name text;
  v_dispatch_email_id uuid;
  v_dispatch_inapp_id uuid;
  v_match RECORD;
BEGIN
  v_lock_key := ('x' || substr(md5(p_engagement_id::text), 1, 15))::bit(60)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_engagement
  FROM poi_engagements
  WHERE id = p_engagement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'engagement_not_found');
  END IF;

  v_prev_status := v_engagement.engagement_status;

  UPDATE poi_engagements
  SET engagement_status = p_new_status,
      contact_method = COALESCE(p_contact_method, contact_method),
      contacted_at = CASE WHEN p_new_status = 'contacted' THEN now() ELSE contacted_at END,
      responded_at = CASE WHEN p_new_status IN ('accepted','declined') THEN now() ELSE responded_at END,
      admin_notes = COALESCE(p_notes, admin_notes),
      updated_at = now()
  WHERE id = p_engagement_id;

  INSERT INTO engagement_outreach_logs (
    engagement_id, actor_type, admin_user_id, admin_email, admin_name,
    entry_type, contact_method, contact_detail,
    previous_status, new_status, notes
  ) VALUES (
    p_engagement_id, p_actor_type, p_actor_user_id, p_actor_email, p_actor_name,
    p_entry_type, p_contact_method, p_contact_detail,
    v_prev_status, p_new_status, p_notes
  )
  RETURNING id INTO v_log_id;

  IF p_audit_action IS NOT NULL AND p_audit_org_id IS NOT NULL THEN
    INSERT INTO audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (
      p_audit_org_id, p_actor_user_id, p_audit_action,
      'poi_engagement', p_engagement_id,
      jsonb_build_object('previous_status', v_prev_status, 'new_status', p_new_status, 'log_id', v_log_id)
    );
  END IF;

  -- ── On acceptance: signed attestation + receipt + notification dispatches ──
  IF p_new_status = 'accepted' AND v_prev_status <> 'accepted' THEN

    SELECT id, commodity, org_id INTO v_match
    FROM matches
    WHERE id = v_engagement.match_id;

    -- Resolve initiator user from match's org
    SELECT id, email, full_name
      INTO v_initiator_user_id, v_initiator_email, v_initiator_name
    FROM profiles
    WHERE org_id = v_engagement.org_id
    ORDER BY created_at ASC
    LIMIT 1;

    -- 1. Write signed attestation (Item 2)
    v_signed_payload := jsonb_build_object(
      'engagement_id', p_engagement_id,
      'match_id', v_engagement.match_id,
      'initiator_org_id', v_engagement.org_id,
      'counterparty_org_id', v_engagement.counterparty_org_id,
      'counterparty_email', v_engagement.counterparty_email,
      'accepted_at', now(),
      'accepting_user_id', p_actor_user_id,
      'accepting_user_email', p_actor_email,
      'accepting_user_name', p_actor_name
    )::text;
    v_signature_hash := encode(digest(v_signed_payload, 'sha256'), 'hex');

    IF p_actor_user_id IS NOT NULL AND v_match.org_id IS NOT NULL THEN
      INSERT INTO attestations (
        org_id, match_id,
        attester_user_id, attester_role, attester_name,
        attestation_type, attestation_text,
        signature_payload, signature_hash, signed_at,
        metadata
      ) VALUES (
        COALESCE(v_engagement.counterparty_org_id, v_match.org_id),
        v_engagement.match_id,
        p_actor_user_id,
        COALESCE(p_actor_type, 'counterparty'),
        COALESCE(p_actor_name, p_actor_email, 'Counterparty'),
        'engagement_acceptance',
        format(
          'I, %s, on behalf of the counterparty, formally accept the trade engagement for match %s at %s.',
          COALESCE(p_actor_name, p_actor_email, 'the accepting user'),
          v_engagement.match_id,
          now()
        ),
        v_signed_payload,
        v_signature_hash,
        now(),
        jsonb_build_object('engagement_id', p_engagement_id, 'source', 'atomic_engagement_transition')
      )
      RETURNING id INTO v_attestation_id;
    END IF;

    -- 2. Write the receipt with full identity (Item 1)
    INSERT INTO acceptance_receipts (
      engagement_id, match_id,
      initiator_org_id, counterparty_org_id, counterparty_email,
      accepting_user_id, accepting_user_name, accepting_user_email,
      accepted_at, attestation_id,
      signed_payload, signature_hash, receipt_version, metadata
    ) VALUES (
      p_engagement_id, v_engagement.match_id,
      v_engagement.org_id, v_engagement.counterparty_org_id, v_engagement.counterparty_email,
      p_actor_user_id, p_actor_name, p_actor_email,
      now(), v_attestation_id,
      v_signed_payload, v_signature_hash, 1,
      jsonb_build_object('source', 'atomic_engagement_transition', 'log_id', v_log_id)
    )
    ON CONFLICT (engagement_id) DO UPDATE
      SET accepting_user_id = EXCLUDED.accepting_user_id,
          accepting_user_name = EXCLUDED.accepting_user_name,
          accepting_user_email = EXCLUDED.accepting_user_email,
          attestation_id = EXCLUDED.attestation_id,
          signed_payload = EXCLUDED.signed_payload,
          signature_hash = EXCLUDED.signature_hash
    RETURNING id INTO v_receipt_id;

    -- 3. Dispatch rows for the initiator (email + in-app)
    IF v_initiator_email IS NOT NULL THEN
      INSERT INTO notification_dispatches (
        event_type, reference_type, reference_id,
        recipient_org_id, recipient_user_id, recipient_address,
        channel, status, template_name, metadata
      ) VALUES (
        'engagement.accepted', 'acceptance_receipt', v_receipt_id,
        v_engagement.org_id, v_initiator_user_id, v_initiator_email,
        'email', 'pending', 'acceptance-receipt',
        jsonb_build_object('engagement_id', p_engagement_id, 'match_id', v_engagement.match_id)
      )
      RETURNING id INTO v_dispatch_email_id;
    END IF;

    INSERT INTO notification_dispatches (
      event_type, reference_type, reference_id,
      recipient_org_id, recipient_user_id,
      channel, status, dispatched_at, delivered_at, metadata
    ) VALUES (
      'engagement.accepted', 'acceptance_receipt', v_receipt_id,
      v_engagement.org_id, v_initiator_user_id,
      'in_app', 'delivered', now(), now(),
      jsonb_build_object('engagement_id', p_engagement_id, 'match_id', v_engagement.match_id)
    )
    RETURNING id INTO v_dispatch_inapp_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_log_id,
    'receipt_id', v_receipt_id,
    'attestation_id', v_attestation_id,
    'dispatch_email_id', v_dispatch_email_id,
    'dispatch_inapp_id', v_dispatch_inapp_id
  );
END;
$function$;

-- =====================================================================
-- Item 3: Reconciler now alarms on stuck-pending dispatches too
-- =====================================================================
CREATE OR REPLACE FUNCTION public.reconcile_acceptance_notifications()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_alarm_count integer := 0;
  v_existing_alarm_id uuid;
BEGIN
  -- (a) Receipts older than 5 minutes with NO delivered/opened email dispatch
  -- (b) OR an email dispatch that has been stuck in `pending`/`failed` > 5 min
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
          'Engagement %s was accepted at %s but the initiator org %s has no delivered email notification (latest dispatch status: %s). Match: %s. Counterparty: %s.',
          r.engagement_id, r.accepted_at, r.initiator_org_id,
          COALESCE(r.latest_email_status, 'none'),
          r.match_id, COALESCE(r.counterparty_email, 'unknown')
        ),
        'high',
        'open'
      );
      v_alarm_count := v_alarm_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('checked_at', now(), 'alarms_raised', v_alarm_count);
END;
$function$;

-- =====================================================================
-- Item 3 bootstrap: backfill missing pending email dispatches
-- so the dispatcher will actually attempt delivery for historical rows.
-- =====================================================================
INSERT INTO notification_dispatches (
  event_type, reference_type, reference_id,
  recipient_org_id, recipient_user_id, recipient_address,
  channel, status, template_name, metadata
)
SELECT
  'engagement.accepted',
  'acceptance_receipt',
  ar.id,
  ar.initiator_org_id,
  p.id,
  p.email,
  'email',
  'pending',
  'acceptance-receipt',
  jsonb_build_object('engagement_id', ar.engagement_id, 'match_id', ar.match_id, 'source', 'reconciler_bootstrap')
FROM acceptance_receipts ar
JOIN LATERAL (
  SELECT id, email FROM profiles
  WHERE org_id = ar.initiator_org_id AND email IS NOT NULL
  ORDER BY created_at ASC LIMIT 1
) p ON true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_dispatches nd
  WHERE nd.reference_id = ar.id
    AND nd.reference_type = 'acceptance_receipt'
    AND nd.channel = 'email'
);