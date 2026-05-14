-- POI-012 Stage A: edge fast-path engagement self-heal helper.
-- Mirrors the self-heal block inside atomic_generate_poi_v2 but is callable
-- on its own from the match edge function's already-minted fast-path,
-- WITHOUT re-running burn / ledger / state / audit logic.
--
-- Concurrency-safe: relies on the partial unique index
-- uq_poi_engagements_one_current_per_match to prevent duplicate active rows.
-- Returns flags so the edge function can include them in audit/log metadata.

CREATE OR REPLACE FUNCTION public.ensure_poi_engagement_for_minted_match(
  p_match_id uuid,
  p_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_match RECORD;
  v_counterparty_org_id uuid;
  v_engagement_created boolean := false;
  v_engagement_existed boolean := false;
BEGIN
  SELECT id, state, status, org_id, buyer_org_id, seller_org_id
    INTO v_match
    FROM matches
   WHERE id = p_match_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Match not found');
  END IF;

  IF v_match.org_id <> p_org_id
     AND v_match.buyer_org_id IS DISTINCT FROM p_org_id
     AND v_match.seller_org_id IS DISTINCT FROM p_org_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Not a party to this deal');
  END IF;

  -- Only act on matches that are actually in a minted/past-discovery state.
  IF NOT (
    v_match.state IN ('intent_declared','counterparty_sighted','committed','completed')
    OR v_match.status = 'settled'
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'engagement_created', false,
      'engagement_existed', false,
      'message', 'Match is not in a minted state; nothing to repair'
    );
  END IF;

  v_counterparty_org_id := CASE
    WHEN v_match.buyer_org_id = p_org_id THEN v_match.seller_org_id
    ELSE v_match.buyer_org_id
  END;

  IF NOT EXISTS (
    SELECT 1 FROM poi_engagements
    WHERE match_id = p_match_id
      AND engagement_status NOT IN (
        'expired'::engagement_status,
        'declined'::engagement_status,
        'cancelled_email_change'::engagement_status
      )
  ) THEN
    BEGIN
      INSERT INTO poi_engagements (
        match_id, org_id, counterparty_org_id, counterparty_type, engagement_status, source
      ) VALUES (
        p_match_id, v_match.org_id, v_counterparty_org_id,
        CASE WHEN v_counterparty_org_id IS NOT NULL THEN 'known'::counterparty_type ELSE 'unknown'::counterparty_type END,
        'notification_sent'::engagement_status,
        'poi_existing_repair'
      );
      v_engagement_created := true;
    EXCEPTION WHEN unique_violation THEN
      -- Concurrent insert beat us; treat as already-present.
      v_engagement_existed := true;
    END;
  ELSE
    v_engagement_existed := true;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'engagement_created', v_engagement_created,
    'engagement_existed', v_engagement_existed
  );
END;
$function$;

-- SECDEF Stage D1 lockdown: service_role only.
REVOKE EXECUTE ON FUNCTION public.ensure_poi_engagement_for_minted_match(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_poi_engagement_for_minted_match(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ensure_poi_engagement_for_minted_match(uuid, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.ensure_poi_engagement_for_minted_match(uuid, uuid) TO   service_role;

COMMENT ON FUNCTION public.ensure_poi_engagement_for_minted_match(uuid, uuid) IS
  'POI-012: edge fast-path engagement self-heal. Creates a current poi_engagements row '
  'for a minted match if one is missing. Never burns credits, never writes ledger/audit, '
  'never duplicates an active engagement row (protected by uq_poi_engagements_one_current_per_match). '
  'Source = ''poi_existing_repair''.';
