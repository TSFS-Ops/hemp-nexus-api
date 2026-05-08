-- ─────────────────────────────────────────────────────────────────────────
-- Batch B Phase 3: Atomic late-acceptance + renewal RPCs.
--
-- Adds three new SECURITY DEFINER functions and patches the existing
-- atomic_engagement_transition to refuse the impossible direct paths.
-- All three new functions are service_role-only per SECDEF Stage D1.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. atomic_record_late_acceptance ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_record_late_acceptance(
  p_engagement_id  uuid,
  p_actor_user_id  uuid,
  p_actor_email    text,
  p_actor_name     text,
  p_audit_org_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_engagement    RECORD;
  v_lock_key      bigint;
  v_log_id        uuid;
  v_window_end    timestamptz;
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

  -- Idempotency: if already in the late-acceptance state, return success.
  IF v_engagement.engagement_status::text = 'late_acceptance_pending_initiator_reconfirmation' THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'engagement_id', v_engagement.id,
      'state', 'late_acceptance_pending_initiator_reconfirmation',
      'reconfirmation_window_expires_at', v_engagement.reconfirmation_window_expires_at
    );
  END IF;

  -- Hard precondition: the engagement must currently be expired.
  IF v_engagement.engagement_status::text <> 'expired' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('engagement_not_expired:%s', v_engagement.engagement_status::text)
    );
  END IF;

  IF v_engagement.expires_at IS NULL OR now() <= v_engagement.expires_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'expiry_precondition_failed');
  END IF;

  v_window_end := now() + interval '7 days';

  UPDATE poi_engagements
     SET engagement_status               = 'late_acceptance_pending_initiator_reconfirmation'::engagement_status,
         counterparty_response           = 'accepted_after_expiry',
         original_expired_at             = COALESCE(original_expired_at, expires_at),
         late_acceptance_recorded_at     = now(),
         reconfirmation_window_expires_at = v_window_end,
         responded_at                    = now(),
         updated_at                      = now()
   WHERE id = p_engagement_id;

  INSERT INTO engagement_outreach_logs (
    engagement_id, actor_type, admin_user_id, admin_email, admin_name,
    entry_type, contact_method, contact_detail,
    previous_status, new_status, notes
  ) VALUES (
    p_engagement_id, 'counterparty', p_actor_user_id, p_actor_email, p_actor_name,
    'late_acceptance', NULL, NULL,
    'expired', 'late_acceptance_pending_initiator_reconfirmation',
    'Counterparty accepted after expiry; awaiting initiator reconfirmation.'
  )
  RETURNING id INTO v_log_id;

  IF p_audit_org_id IS NOT NULL THEN
    INSERT INTO audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (
      p_audit_org_id, p_actor_user_id,
      'pending_engagement.accepted_after_expiry',
      'poi_engagement', p_engagement_id,
      jsonb_build_object(
        'previous_status', 'expired',
        'new_status', 'late_acceptance_pending_initiator_reconfirmation',
        'counterparty_response', 'accepted_after_expiry',
        'original_expired_at', v_engagement.expires_at,
        'late_acceptance_recorded_at', now(),
        'reconfirmation_window_expires_at', v_window_end,
        'log_id', v_log_id
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'engagement_id', p_engagement_id,
    'state', 'late_acceptance_pending_initiator_reconfirmation',
    'reconfirmation_window_expires_at', v_window_end,
    'log_id', v_log_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_record_late_acceptance(uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_record_late_acceptance(uuid, uuid, text, text, uuid) TO service_role;

-- ── 2. atomic_reconfirm_late_acceptance ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_reconfirm_late_acceptance(
  p_parent_engagement_id uuid,
  p_actor_user_id        uuid,
  p_actor_email          text,
  p_actor_name           text,
  p_audit_org_id         uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_parent   RECORD;
  v_lock_key bigint;
  v_child_id uuid;
  v_log_id   uuid;
BEGIN
  v_lock_key := ('x' || substr(md5(p_parent_engagement_id::text), 1, 15))::bit(60)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_parent
  FROM poi_engagements
  WHERE id = p_parent_engagement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'engagement_not_found');
  END IF;

  -- Idempotency: a renewed child already exists for this parent → return it.
  IF v_parent.renewed_engagement_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'parent_engagement_id', p_parent_engagement_id,
      'renewed_engagement_id', v_parent.renewed_engagement_id
    );
  END IF;

  IF v_parent.engagement_status::text <> 'late_acceptance_pending_initiator_reconfirmation' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('parent_not_in_reconfirmation_state:%s', v_parent.engagement_status::text)
    );
  END IF;

  IF v_parent.reconfirmation_window_expires_at IS NULL
     OR now() > v_parent.reconfirmation_window_expires_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'reconfirmation_window_closed');
  END IF;

  -- Create the renewed child. Fresh expires_at via column default.
  -- The unique partial index uq_poi_engagements_renewed_from_once guarantees
  -- at most one child per parent even under concurrent calls.
  INSERT INTO poi_engagements (
    match_id,
    org_id,
    counterparty_email,
    counterparty_org_id,
    counterparty_type,
    contact_type,
    contact_name,
    contact_method,
    source,
    engagement_status,
    renewed_from_engagement_id
  ) VALUES (
    v_parent.match_id,
    v_parent.org_id,
    v_parent.counterparty_email,
    v_parent.counterparty_org_id,
    v_parent.counterparty_type,
    v_parent.contact_type,
    v_parent.contact_name,
    v_parent.contact_method,
    v_parent.source,
    'notification_sent'::engagement_status,
    v_parent.id
  )
  RETURNING id INTO v_child_id;

  -- Resolve the parent: return to expired, preserve late-acceptance evidence.
  UPDATE poi_engagements
     SET engagement_status            = 'expired'::engagement_status,
         late_acceptance_resolution   = 'renewed_engagement_created',
         late_acceptance_resolved_at  = now(),
         reconfirmed_at               = now(),
         reconfirmed_by_user_id       = p_actor_user_id,
         renewed_engagement_id        = v_child_id,
         updated_at                   = now()
   WHERE id = p_parent_engagement_id;

  INSERT INTO engagement_outreach_logs (
    engagement_id, actor_type, admin_user_id, admin_email, admin_name,
    entry_type, contact_method, contact_detail,
    previous_status, new_status, notes
  ) VALUES (
    p_parent_engagement_id, 'initiator', p_actor_user_id, p_actor_email, p_actor_name,
    'reconfirmed', NULL, NULL,
    'late_acceptance_pending_initiator_reconfirmation', 'expired',
    format('Initiator reconfirmed late acceptance; renewed engagement %s created.', v_child_id)
  )
  RETURNING id INTO v_log_id;

  IF p_audit_org_id IS NOT NULL THEN
    INSERT INTO audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (
      p_audit_org_id, p_actor_user_id,
      'pending_engagement.reconfirmed',
      'poi_engagement', p_parent_engagement_id,
      jsonb_build_object(
        'previous_status', 'late_acceptance_pending_initiator_reconfirmation',
        'new_status', 'expired',
        'late_acceptance_resolution', 'renewed_engagement_created',
        'renewed_engagement_id', v_child_id,
        'renewed_from_engagement_id', p_parent_engagement_id,
        'log_id', v_log_id
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'parent_engagement_id', p_parent_engagement_id,
    'renewed_engagement_id', v_child_id,
    'log_id', v_log_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_reconfirm_late_acceptance(uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_reconfirm_late_acceptance(uuid, uuid, text, text, uuid) TO service_role;

-- ── 3. atomic_decline_late_acceptance ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_decline_late_acceptance(
  p_parent_engagement_id uuid,
  p_actor_user_id        uuid,
  p_actor_email          text,
  p_actor_name           text,
  p_audit_org_id         uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_parent   RECORD;
  v_lock_key bigint;
  v_log_id   uuid;
BEGIN
  v_lock_key := ('x' || substr(md5(p_parent_engagement_id::text), 1, 15))::bit(60)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_parent
  FROM poi_engagements
  WHERE id = p_parent_engagement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'engagement_not_found');
  END IF;

  -- Idempotency: already declined.
  IF v_parent.late_acceptance_resolution = 'initiator_declined_renewal' THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'parent_engagement_id', p_parent_engagement_id,
      'late_acceptance_resolution', 'initiator_declined_renewal'
    );
  END IF;

  IF v_parent.engagement_status::text <> 'late_acceptance_pending_initiator_reconfirmation' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('parent_not_in_reconfirmation_state:%s', v_parent.engagement_status::text)
    );
  END IF;

  UPDATE poi_engagements
     SET engagement_status           = 'expired'::engagement_status,
         late_acceptance_resolution  = 'initiator_declined_renewal',
         late_acceptance_resolved_at = now(),
         updated_at                  = now()
   WHERE id = p_parent_engagement_id;

  INSERT INTO engagement_outreach_logs (
    engagement_id, actor_type, admin_user_id, admin_email, admin_name,
    entry_type, contact_method, contact_detail,
    previous_status, new_status, notes
  ) VALUES (
    p_parent_engagement_id, 'initiator', p_actor_user_id, p_actor_email, p_actor_name,
    'late_acceptance_declined', NULL, NULL,
    'late_acceptance_pending_initiator_reconfirmation', 'expired',
    'Initiator declined the late acceptance; engagement remains expired.'
  )
  RETURNING id INTO v_log_id;

  IF p_audit_org_id IS NOT NULL THEN
    INSERT INTO audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (
      p_audit_org_id, p_actor_user_id,
      'pending_engagement.initiator_declined_after_late_acceptance',
      'poi_engagement', p_parent_engagement_id,
      jsonb_build_object(
        'previous_status', 'late_acceptance_pending_initiator_reconfirmation',
        'new_status', 'expired',
        'late_acceptance_resolution', 'initiator_declined_renewal',
        'log_id', v_log_id
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'parent_engagement_id', p_parent_engagement_id,
    'late_acceptance_resolution', 'initiator_declined_renewal',
    'log_id', v_log_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_decline_late_acceptance(uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_decline_late_acceptance(uuid, uuid, text, text, uuid) TO service_role;

-- ── 4. Patch atomic_engagement_transition ────────────────────────────────
-- Adds two impossible-path rejections:
--   • `expired → accepted`: a counterparty cannot revive an expired
--     engagement through the standard path. They must go through
--     atomic_record_late_acceptance, which records the late acceptance
--     without progressing the POI.
--   • Any direct write into or out of
--     `late_acceptance_pending_initiator_reconfirmation`. That state may
--     only be entered/exited via the three dedicated late-acceptance RPCs.
CREATE OR REPLACE FUNCTION public.atomic_engagement_transition(
  p_engagement_id uuid,
  p_actor_type text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_new_status text,
  p_entry_type text,
  p_contact_method text DEFAULT NULL,
  p_contact_detail text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_audit_action text DEFAULT NULL,
  p_audit_org_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

  IF p_new_status IS NULL
     OR p_new_status NOT IN ('pending','notification_sent','contacted','accepted','declined','expired') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('invalid_target_status:%s', COALESCE(p_new_status, 'NULL'))
    );
  END IF;

  -- Batch B Phase 3: hard rejection of the impossible direct paths.
  IF v_prev_status = 'expired' AND p_new_status = 'accepted' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'expired_engagement_use_late_acceptance_rpc'
    );
  END IF;

  IF v_prev_status = 'late_acceptance_pending_initiator_reconfirmation'
     OR p_new_status = 'late_acceptance_pending_initiator_reconfirmation' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'late_acceptance_state_requires_dedicated_rpc'
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