
CREATE OR REPLACE FUNCTION public.atomic_generate_poi(
  p_match_id uuid,
  p_org_id uuid,
  p_settled_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_match RECORD;
  v_current_state text;
BEGIN
  -- 1. Acquire exclusive row lock
  SELECT * INTO v_match
  FROM matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Match not found');
  END IF;

  -- 2. Ownership check
  IF v_match.org_id != p_org_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'You do not have permission to modify this match');
  END IF;

  v_current_state := COALESCE(v_match.state, 'discovery');

  -- 3. Idempotent: already past discovery means POI was already generated
  IF v_current_state IN ('intent_declared', 'counterparty_sighted', 'committed', 'completed') THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'current_state', v_current_state,
      'message', 'POI already generated'
    );
  END IF;

  -- 4. Must be in discovery
  IF v_current_state != 'discovery' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_STATE',
      'message', format('Cannot generate POI from state ''%s''. Must be in ''discovery''.', v_current_state),
      'current_state', v_current_state
    );
  END IF;

  -- 5. Atomic transition: discovery → committed (skipping intermediate states)
  UPDATE matches
  SET state = 'committed',
      status = 'settled',
      settled_at = p_settled_at,
      counterparty_sighted_at = p_settled_at,
      buyer_committed_at = p_settled_at
  WHERE id = p_match_id;

  -- 6. Return updated match
  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'previous_state', v_current_state,
    'new_state', 'committed'
  );
END;
$fn$;
