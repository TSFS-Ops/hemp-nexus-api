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
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
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

  -- Allow `pending` as a same-status pass-through so admin no-op updates
  -- (counterparty_email / admin_notes only, no state change) succeed on
  -- engagements that have not yet been contacted. Forward state changes
  -- are still gated by the application-layer transition table.
  IF p_new_status IS NULL
     OR p_new_status NOT IN ('pending','notification_sent','contacted','accepted','declined','expired') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('invalid_target_status:%s', COALESCE(p_new_status, 'NULL'))
    );
  END IF;

  UPDATE poi_engagements
  SET engagement_status = p_new_status::engagement_status,
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
    v_signature_hash := encode(extensions.digest(v_signed_payload, 'sha256'), 'hex');

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
          'Counterparty %s accepted engagement %s for match %s at %s.',
          COALESCE(p_actor_name, p_actor_email, 'Counterparty'),
          p_engagement_id,
          v_engagement.match_id,
          now()
        ),
        v_signed_payload,
        v_signature_hash,
        now(),
        jsonb_build_object(
          'engagement_id', p_engagement_id,
          'log_id', v_log_id,
          'flow', 'engagement_response'
        )
      )
      RETURNING id INTO v_attestation_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_log_id,
    'attestation_id', v_attestation_id,
    'previous_status', v_prev_status,
    'new_status', p_new_status
  );
END;
$function$;