-- =====================================================================
-- 1. FIX: atomic_engagement_transition — text → engagement_status cast
-- =====================================================================
-- Root cause: line `SET engagement_status = p_new_status` assigned a TEXT
-- value to a USER-DEFINED enum column (`engagement_status`). Postgres rejected
-- with SQLSTATE 42804 ("expression is of type text"). Earlier revisions had
-- the explicit cast; the v3 revision dropped it. Restoring it now.
--
-- Same defensive cast applied to v_prev_status assignment so the value is
-- guaranteed text when written into the (text-typed) outreach log.
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

  v_prev_status := v_engagement.engagement_status::text;

  -- Validate p_new_status is a real enum label BEFORE the cast so we get a
  -- clean error rather than a low-level Postgres exception leaking out.
  IF p_new_status IS NULL
     OR p_new_status NOT IN ('notification_sent','contacted','accepted','declined','expired') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('invalid_target_status:%s', COALESCE(p_new_status, 'NULL'))
    );
  END IF;

  UPDATE poi_engagements
  SET engagement_status = p_new_status::engagement_status,   -- ← restored cast
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

    SELECT id, email, full_name
      INTO v_initiator_user_id, v_initiator_email, v_initiator_name
    FROM profiles
    WHERE org_id = v_engagement.org_id
    ORDER BY created_at ASC
    LIMIT 1;

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

    IF v_initiator_user_id IS NOT NULL THEN
      INSERT INTO notification_dispatches (
        recipient_user_id, recipient_email, channel, template_name,
        related_entity_type, related_entity_id,
        status, metadata
      ) VALUES
      (v_initiator_user_id, v_initiator_email, 'email', 'engagement-accepted',
       'poi_engagement', p_engagement_id, 'queued',
       jsonb_build_object('match_id', v_engagement.match_id, 'attestation_id', v_attestation_id))
      RETURNING id INTO v_dispatch_email_id;

      INSERT INTO notification_dispatches (
        recipient_user_id, recipient_email, channel, template_name,
        related_entity_type, related_entity_id,
        status, metadata
      ) VALUES
      (v_initiator_user_id, v_initiator_email, 'in_app', 'engagement-accepted',
       'poi_engagement', p_engagement_id, 'queued',
       jsonb_build_object('match_id', v_engagement.match_id))
      RETURNING id INTO v_dispatch_inapp_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_log_id,
    'previous_status', v_prev_status,
    'new_status', p_new_status,
    'attestation_id', v_attestation_id,
    'receipt_id', v_receipt_id
  );
END;
$function$;

-- =====================================================================
-- 2. BACKFILL: the one engagement orphaned by the bug
--    (email was sent via Resend but state never updated)
-- =====================================================================
DO $$
DECLARE
  v_eng RECORD;
  v_actor_id uuid := '582fc403-e866-4835-ac9e-06e9e4fb1f40'::uuid;  -- platform admin from logs
  v_actor_email text;
  v_actor_name text;
BEGIN
  SELECT * INTO v_eng FROM poi_engagements
  WHERE id = '846aa1d9-bd12-4cdd-9b4a-63ff2fe133ea';

  IF NOT FOUND THEN
    RAISE NOTICE 'Engagement 846aa1d9 not found, skipping backfill.';
    RETURN;
  END IF;

  IF v_eng.engagement_status::text <> 'notification_sent' THEN
    RAISE NOTICE 'Engagement 846aa1d9 already at status %, skipping backfill.',
      v_eng.engagement_status::text;
    RETURN;
  END IF;

  SELECT email, full_name INTO v_actor_email, v_actor_name
  FROM profiles WHERE id = v_actor_id;

  UPDATE poi_engagements
  SET engagement_status = 'contacted'::engagement_status,
      contact_method   = 'email',
      contacted_at     = '2026-04-24 15:02:24+00'::timestamptz,
      contact_date     = '2026-04-24 15:02:24+00'::timestamptz,
      admin_notes      = COALESCE(admin_notes, '') ||
        E'\n[BACKFILL 2026-04-24] Email was sent at 15:02 UTC but state-transition failed (SQLSTATE 42804). Restored by maintenance migration.',
      updated_at       = now()
  WHERE id = '846aa1d9-bd12-4cdd-9b4a-63ff2fe133ea';

  INSERT INTO engagement_outreach_logs (
    engagement_id, actor_type, admin_user_id, admin_email, admin_name,
    entry_type, contact_method, contact_detail,
    previous_status, new_status, notes
  ) VALUES (
    '846aa1d9-bd12-4cdd-9b4a-63ff2fe133ea',
    'admin', v_actor_id, v_actor_email, v_actor_name,
    'contact_attempt', 'email', 'auto-link-tst-39d79cd5@izenzo-test.invalid',
    'notification_sent', 'contacted',
    'BACKFILL: original send (requestId ea9b19bc-56eb-40cc-8a57-ebf0e5442b1f) at 2026-04-24T15:02:24Z. Email delivered via Resend; DB state transition failed (SQLSTATE 42804) and is now restored.'
  );

  INSERT INTO audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_eng.org_id, v_actor_id, 'engagement.outreach_email_sent.backfill',
    'poi_engagement', '846aa1d9-bd12-4cdd-9b4a-63ff2fe133ea',
    jsonb_build_object(
      'request_id', 'ea9b19bc-56eb-40cc-8a57-ebf0e5442b1f',
      'recipient', 'auto-link-tst-39d79cd5@izenzo-test.invalid',
      'reason', 'enum_cast_bug_recovery',
      'sent_at', '2026-04-24T15:02:24Z'
    )
  );
END $$;

-- =====================================================================
-- 3. SENTINEL VIEW: engagements with email_sent log but stuck status
-- =====================================================================
-- Direct invariant check from the QA plan (item 2.1.6). Support can run:
--   select * from engagement_email_sent_but_status_stuck;
-- A non-empty result indicates the cast bug (or a similar partial-success
-- failure mode) has reoccurred.
CREATE OR REPLACE VIEW public.engagement_email_sent_but_status_stuck AS
SELECT
  e.id            AS engagement_id,
  e.match_id,
  e.engagement_status::text AS current_status,
  l.id            AS outreach_log_id,
  l.entry_type,
  l.created_at    AS log_created_at,
  l.contact_detail AS recipient
FROM public.poi_engagements e
JOIN public.engagement_outreach_logs l ON l.engagement_id = e.id
WHERE l.entry_type IN ('contact_attempt','email_sent')
  AND l.new_status IN ('contacted')
  AND e.engagement_status::text = 'notification_sent';

GRANT SELECT ON public.engagement_email_sent_but_status_stuck TO authenticated;