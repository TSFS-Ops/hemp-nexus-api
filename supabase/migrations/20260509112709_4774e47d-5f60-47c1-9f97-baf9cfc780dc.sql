-- ─────────────────────────────────────────────────────────────────────
-- Batch B post-walkthrough correction (Daniel, 2026-05-09)
--
-- F-B2 fail: renewed engagement was giving the counterparty 30 days
-- (column default on poi_engagements.expires_at) when the agreed rule
-- is 14 calendar days from creation of the renewed child.
--
-- Fix: set expires_at explicitly to now() + interval '14 days' in the
-- INSERT inside atomic_reconfirm_late_acceptance. The column default
-- on the table is intentionally LEFT UNCHANGED so this remains a
-- narrow, renewed-engagement-only correction (other engagement
-- creation paths are out of scope).
--
-- F-B1 is NOT addressed here: the displayed reconfirmation deadline
-- (May 13) matches the client-confirmed Option A rule (7 calendar
-- days from late_acceptance_recorded_at), so no code or fixture
-- patch is being shipped for F-B1 in this migration.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.atomic_reconfirm_late_acceptance(
  p_parent_engagement_id uuid,
  p_actor_user_id        uuid,
  p_actor_email          text,
  p_actor_name           text,
  p_audit_org_id         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_parent  poi_engagements%ROWTYPE;
  v_child_id uuid;
  v_log_id   uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_parent_engagement_id::text));

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

  -- Create the renewed child. expires_at is set EXPLICITLY to
  -- now() + 14 days per client-confirmed rule (2026-05-09). Do NOT
  -- rely on the table column default (which is 30 days and serves
  -- other engagement creation paths).
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
    expires_at,
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
    now() + interval '14 days',
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
    format('Initiator reconfirmed late acceptance; renewed engagement %s created (14-day response window).', v_child_id)
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
        'renewed_child_response_window_days', 14,
        'log_id', v_log_id
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'parent_engagement_id', p_parent_engagement_id,
    'renewed_engagement_id', v_child_id,
    'log_id', v_log_id,
    'renewed_child_expires_at', (now() + interval '14 days')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_reconfirm_late_acceptance(uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_reconfirm_late_acceptance(uuid, uuid, text, text, uuid) TO service_role;

-- ── Fixture backfill: re-anchor existing renewed children to a 14-day
-- window from their original created_at, but only if they are still in
-- a non-terminal state (don't disturb already-accepted/declined rows).
UPDATE poi_engagements
   SET expires_at = created_at + interval '14 days',
       updated_at = now()
 WHERE renewed_from_engagement_id IS NOT NULL
   AND engagement_status::text NOT IN ('accepted', 'declined')
   AND expires_at = created_at + interval '30 days';
