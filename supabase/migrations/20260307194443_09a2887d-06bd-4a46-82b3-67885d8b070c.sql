
-- Atomic match state transition with row-level locking.
-- Prevents two concurrent requests from both reading the same state
-- and double-burning tokens.
CREATE OR REPLACE FUNCTION public.safe_transition_match_state(
  p_match_id uuid,
  p_org_id uuid,
  p_expected_state text,
  p_new_state text,
  p_update_fields jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_match RECORD;
  v_result jsonb;
BEGIN
  -- Acquire an exclusive row lock; any concurrent caller blocks here
  SELECT * INTO v_match
  FROM matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'NOT_FOUND',
      'message', 'Match not found'
    );
  END IF;

  -- Ownership check
  IF v_match.org_id != p_org_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'FORBIDDEN',
      'message', 'You do not have permission to modify this match'
    );
  END IF;

  -- State guard: reject if the row has already moved past expected state
  IF COALESCE(v_match.state, 'discovery') != p_expected_state THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'STATE_CONFLICT',
      'message', format(
        'Expected state ''%s'' but found ''%s''. Another request may have already processed this transition.',
        p_expected_state,
        COALESCE(v_match.state, 'discovery')
      ),
      'current_state', COALESCE(v_match.state, 'discovery')
    );
  END IF;

  -- Apply the transition + any extra fields (settled_at, buyer_committed_at, etc.)
  UPDATE matches
  SET state = p_new_state
  WHERE id = p_match_id;

  -- Apply dynamic fields from p_update_fields
  IF p_update_fields ? 'status' THEN
    UPDATE matches SET status = (p_update_fields->>'status') WHERE id = p_match_id;
  END IF;
  IF p_update_fields ? 'settled_at' THEN
    UPDATE matches SET settled_at = (p_update_fields->>'settled_at')::timestamptz WHERE id = p_match_id;
  END IF;
  IF p_update_fields ? 'counterparty_sighted_at' THEN
    UPDATE matches SET counterparty_sighted_at = (p_update_fields->>'counterparty_sighted_at')::timestamptz WHERE id = p_match_id;
  END IF;
  IF p_update_fields ? 'buyer_committed_at' THEN
    UPDATE matches SET buyer_committed_at = (p_update_fields->>'buyer_committed_at')::timestamptz WHERE id = p_match_id;
  END IF;
  IF p_update_fields ? 'seller_committed_at' THEN
    UPDATE matches SET seller_committed_at = (p_update_fields->>'seller_committed_at')::timestamptz WHERE id = p_match_id;
  END IF;
  IF p_update_fields ? 'sighting_tokens_burned' THEN
    UPDATE matches SET sighting_tokens_burned = (p_update_fields->>'sighting_tokens_burned')::integer WHERE id = p_match_id;
  END IF;
  IF p_update_fields ? 'finality_tokens_burned' THEN
    UPDATE matches SET finality_tokens_burned = (p_update_fields->>'finality_tokens_burned')::integer WHERE id = p_match_id;
  END IF;
  IF p_update_fields ? 'declared_value_usd' THEN
    UPDATE matches SET declared_value_usd = (p_update_fields->>'declared_value_usd')::numeric WHERE id = p_match_id;
  END IF;
  IF p_update_fields ? 'poi_state' THEN
    UPDATE matches SET poi_state = (p_update_fields->>'poi_state') WHERE id = p_match_id;
  END IF;
  IF p_update_fields ? 'event_chain_hash' THEN
    UPDATE matches SET event_chain_hash = (p_update_fields->>'event_chain_hash') WHERE id = p_match_id;
  END IF;

  -- Re-read the row after all updates
  SELECT row_to_json(m.*) INTO v_result
  FROM matches m
  WHERE m.id = p_match_id;

  RETURN jsonb_build_object(
    'success', true,
    'previous_state', p_expected_state,
    'new_state', p_new_state,
    'match', v_result
  );
END;
$$;

-- Also create an optimistic-concurrency variant for deal_terms
-- using version checking (no FOR UPDATE needed — lighter weight)
CREATE OR REPLACE FUNCTION public.safe_update_deal_terms(
  p_deal_term_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_updates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current_version integer;
  v_result RECORD;
BEGIN
  -- Lock the row
  SELECT version INTO v_current_version
  FROM deal_terms
  WHERE id = p_deal_term_id AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'NOT_FOUND',
      'message', 'Deal terms not found or access denied'
    );
  END IF;

  IF v_current_version != p_expected_version THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'VERSION_CONFLICT',
      'message', format(
        'Expected version %s but found %s. Someone else modified these terms.',
        p_expected_version,
        v_current_version
      ),
      'current_version', v_current_version
    );
  END IF;

  -- Apply updates
  UPDATE deal_terms
  SET
    payment_terms    = COALESCE(p_updates->>'payment_terms', payment_terms),
    delivery_terms   = COALESCE(p_updates->>'delivery_terms', delivery_terms),
    inspection_terms = COALESCE(p_updates->>'inspection_terms', inspection_terms),
    penalty_terms    = COALESCE(p_updates->>'penalty_terms', penalty_terms),
    amendment_notes  = COALESCE(p_updates->>'amendment_notes', amendment_notes),
    version          = v_current_version + 1,
    status           = COALESCE(p_updates->>'status', status)
  WHERE id = p_deal_term_id;

  SELECT * INTO v_result FROM deal_terms WHERE id = p_deal_term_id;

  RETURN jsonb_build_object(
    'success', true,
    'previous_version', p_expected_version,
    'new_version', v_current_version + 1,
    'deal_terms', row_to_json(v_result)
  );
END;
$$;
