-- Batch B Phase 3 patch — broaden atomic_record_late_acceptance preconditions.
--
-- Issue 1 fix: the previous version required engagement_status = 'expired',
-- which created a contradiction with the route's clock-based detection.
-- The route routes to this RPC whenever expires_at < now(), even if the
-- scheduler has not yet flipped the row to 'expired'. The RPC now accepts
-- any non-terminal status whose expires_at has passed, and records the
-- previous status in audit metadata so the legal narrative is preserved.
--
-- Allowed prior statuses: pending, notification_sent, contacted, expired.
-- Hard rejections: accepted, declined, and any status whose expires_at
-- is still in the future. Idempotent for
-- late_acceptance_pending_initiator_reconfirmation.

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
  v_prev_status   text;
  v_allowed_prior CONSTANT text[] :=
    ARRAY['pending','notification_sent','contacted','expired'];
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

  -- Idempotency: if already in the late-acceptance state, return success.
  IF v_prev_status = 'late_acceptance_pending_initiator_reconfirmation' THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'engagement_id', v_engagement.id,
      'state', 'late_acceptance_pending_initiator_reconfirmation',
      'reconfirmation_window_expires_at', v_engagement.reconfirmation_window_expires_at
    );
  END IF;

  -- Hard rejections: terminal positive/negative responses already exist.
  IF v_prev_status IN ('accepted','declined') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('engagement_already_resolved:%s', v_prev_status)
    );
  END IF;

  -- Anything else outside the allowed prior set is unexpected.
  IF NOT (v_prev_status = ANY (v_allowed_prior)) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('engagement_status_not_eligible:%s', v_prev_status)
    );
  END IF;

  -- Time validity: only allow late acceptance when expires_at has actually
  -- passed. The legal meaning is "the original engagement expired by time",
  -- regardless of whether the scheduler had already swept the row.
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
    v_prev_status, 'late_acceptance_pending_initiator_reconfirmation',
    format('Counterparty accepted after expiry (was %s); awaiting initiator reconfirmation.', v_prev_status)
  )
  RETURNING id INTO v_log_id;

  IF p_audit_org_id IS NOT NULL THEN
    INSERT INTO audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (
      p_audit_org_id, p_actor_user_id,
      'pending_engagement.accepted_after_expiry',
      'poi_engagement', p_engagement_id,
      jsonb_build_object(
        'previous_status', v_prev_status,
        'new_status', 'late_acceptance_pending_initiator_reconfirmation',
        'counterparty_response', 'accepted_after_expiry',
        'original_expired_at', v_engagement.expires_at,
        'late_acceptance_recorded_at', now(),
        'reconfirmation_window_expires_at', v_window_end,
        'scheduler_had_swept_to_expired', (v_prev_status = 'expired'),
        'log_id', v_log_id
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'engagement_id', p_engagement_id,
    'state', 'late_acceptance_pending_initiator_reconfirmation',
    'previous_status', v_prev_status,
    'reconfirmation_window_expires_at', v_window_end,
    'log_id', v_log_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_record_late_acceptance(uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_record_late_acceptance(uuid, uuid, text, text, uuid) TO service_role;

-- Note on Issue 2 (renewed child expires_at):
-- Verified live: poi_engagements.expires_at column default is
-- (now() + '30 days'::interval) and the column is NOT NULL. The
-- atomic_reconfirm_late_acceptance INSERT deliberately omits expires_at
-- so the renewed child receives a fresh 30-day validity window. No
-- change required to that RPC.