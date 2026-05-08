-- Batch B Phase 6 — Reconfirmation-window expiry sweeper RPC.
--
-- Purpose: when a counterparty accepted after expiry and the initiator does
-- not reconfirm within the 7-day reconfirmation window, the lifecycle
-- scheduler invokes this RPC per-row to atomically:
--   * flip engagement_status back to 'expired'
--   * set late_acceptance_resolution = 'reconfirmation_window_expired'
--   * set late_acceptance_resolved_at = now()
--   * preserve counterparty_response = 'accepted_after_expiry'
--   * preserve original_expired_at and late_acceptance_recorded_at
--   * emit exactly one audit row: late_acceptance.reconfirmation_window_expired
--
-- Idempotent: any second invocation against the same row returns
-- {success:true, idempotent:true} without further mutation or audit noise.
-- No POI/WaD/credit/payment side effects are produced.

CREATE OR REPLACE FUNCTION public.atomic_expire_late_acceptance_reconfirmation_window(
  p_engagement_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_engagement RECORD;
  v_lock_key   bigint;
  v_prev_status text;
BEGIN
  IF p_engagement_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'engagement_id_required');
  END IF;

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

  -- Idempotency #1: already resolved (any resolution string).
  IF v_engagement.late_acceptance_resolution IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'reason', 'already_resolved',
      'engagement_id', v_engagement.id,
      'late_acceptance_resolution', v_engagement.late_acceptance_resolution
    );
  END IF;

  -- Idempotency #2: row is no longer in the late-acceptance hold state.
  -- This also covers rows the initiator reconfirmed (renewed child created
  -- with a different resolution path) or declined manually.
  IF v_prev_status <> 'late_acceptance_pending_initiator_reconfirmation' THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'reason', 'status_not_late_acceptance',
      'engagement_id', v_engagement.id,
      'engagement_status', v_prev_status
    );
  END IF;

  -- Time guard: only sweep rows whose reconfirmation window has actually passed.
  IF v_engagement.reconfirmation_window_expires_at IS NULL
     OR now() <= v_engagement.reconfirmation_window_expires_at THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'window_not_expired',
      'reconfirmation_window_expires_at', v_engagement.reconfirmation_window_expires_at
    );
  END IF;

  -- Mutate: revert to expired, record resolution. Preserve all forensic
  -- timestamps and counterparty_response so the legal narrative is intact.
  UPDATE poi_engagements
     SET engagement_status            = 'expired'::engagement_status,
         late_acceptance_resolution   = 'reconfirmation_window_expired',
         late_acceptance_resolved_at  = now(),
         updated_at                   = now()
   WHERE id = p_engagement_id;

  -- Single audit row. org_id falls back to the zero UUID for system-driven
  -- sweeps on rows missing org_id (defensive — production rows always have one).
  INSERT INTO audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    COALESCE(v_engagement.org_id, '00000000-0000-0000-0000-000000000000'::uuid),
    NULL,
    'late_acceptance.reconfirmation_window_expired',
    'poi_engagement',
    p_engagement_id,
    jsonb_build_object(
      'match_id', v_engagement.match_id,
      'counterparty_response', v_engagement.counterparty_response,
      'late_acceptance_recorded_at', v_engagement.late_acceptance_recorded_at,
      'reconfirmation_window_expires_at', v_engagement.reconfirmation_window_expires_at,
      'original_expired_at', v_engagement.original_expired_at,
      'late_acceptance_resolution', 'reconfirmation_window_expired',
      'previous_status', v_prev_status,
      'new_status', 'expired',
      'swept_by', 'lifecycle-scheduler'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'engagement_id', p_engagement_id,
    'previous_status', v_prev_status,
    'new_status', 'expired',
    'late_acceptance_resolution', 'reconfirmation_window_expired'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_expire_late_acceptance_reconfirmation_window(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_expire_late_acceptance_reconfirmation_window(uuid)
  TO service_role;

COMMENT ON FUNCTION public.atomic_expire_late_acceptance_reconfirmation_window(uuid) IS
  'Batch B Phase 6: idempotent per-row sweeper for late-acceptance reconfirmation-window expiry. Reverts engagement to expired, sets late_acceptance_resolution=reconfirmation_window_expired, preserves forensic timestamps, and emits exactly one late_acceptance.reconfirmation_window_expired audit row. Service-role only.';
