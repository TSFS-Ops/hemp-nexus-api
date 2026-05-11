-- D4c-3c closeout: production fixes for late-acceptance lifecycle.
-- (1) Extend outreach-log entry_type CHECK to allow late_acceptance_declined and reconfirmed.
-- (2) Fix atomic_reconfirm_late_acceptance ordering so parent is moved out of the
--     uq_poi_engagements_one_current_per_match set BEFORE the renewed child is inserted.

ALTER TABLE public.engagement_outreach_logs
  DROP CONSTRAINT engagement_outreach_logs_entry_type_check;

ALTER TABLE public.engagement_outreach_logs
  ADD CONSTRAINT engagement_outreach_logs_entry_type_check
  CHECK (entry_type = ANY (ARRAY[
    'contact_attempt'::text,
    'status_change'::text,
    'notes_edit'::text,
    'email_update'::text,
    'system_action'::text,
    'binding_review_resolved'::text,
    'dispute_raised'::text,
    'dispute_resolved'::text,
    'cancelled'::text,
    'replaced'::text,
    'late_acceptance'::text,
    'late_acceptance_declined'::text,
    'reconfirmed'::text
  ]));

CREATE OR REPLACE FUNCTION public.atomic_reconfirm_late_acceptance(
  p_parent_engagement_id uuid,
  p_actor_user_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_audit_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
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

  -- ORDERING FIX: move parent OUT of the partial-unique "current" set first.
  -- uq_poi_engagements_one_current_per_match excludes (expired, declined,
  -- cancelled_email_change). Flipping the parent to 'expired' here releases the
  -- slot so the renewed child can be inserted in 'notification_sent' (current)
  -- without violating the unique index.
  UPDATE poi_engagements
     SET engagement_status            = 'expired'::engagement_status,
         late_acceptance_resolution   = 'renewed_engagement_created',
         late_acceptance_resolved_at  = now(),
         reconfirmed_at               = now(),
         reconfirmed_by_user_id       = p_actor_user_id,
         updated_at                   = now()
   WHERE id = p_parent_engagement_id;

  -- Insert renewed child. expires_at explicit at now() + 14 days
  -- (client-confirmed rule 2026-05-09; do NOT rely on column default of 30d).
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

  -- Backfill the parent's renewed_engagement_id pointer now that the child exists.
  UPDATE poi_engagements
     SET renewed_engagement_id = v_child_id,
         updated_at            = now()
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