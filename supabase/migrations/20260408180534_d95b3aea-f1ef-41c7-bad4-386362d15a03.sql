
CREATE OR REPLACE FUNCTION public.atomic_accept_bind(
  p_match_id uuid,
  p_counterparty_org_id uuid,
  p_counterparty_role text,
  p_counterparty_name text,
  p_caller_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_match RECORD;
  v_slot_field text;
  v_result jsonb;
BEGIN
  -- 1. Acquire exclusive row lock (blocks concurrent callers)
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

  -- 2. Must be unilateral
  IF v_match.match_type != 'unilateral' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_TYPE',
      'message', 'Only unilateral matches can be converted via accept-bind'
    );
  END IF;

  -- 3. Caller must NOT be the creator
  IF v_match.org_id = p_caller_org_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'SELF_BIND',
      'message', 'You cannot accept your own Trade Request'
    );
  END IF;

  -- 4. Validate role
  IF p_counterparty_role NOT IN ('buyer', 'seller') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_ROLE',
      'message', 'Role must be buyer or seller'
    );
  END IF;

  -- 5. Check the slot is vacant (the critical race-condition guard)
  IF p_counterparty_role = 'buyer' THEN
    IF v_match.buyer_org_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'SLOT_TAKEN',
        'message', 'The buyer slot has already been filled by another partner',
        'filled_by', v_match.buyer_org_id
      );
    END IF;

    UPDATE matches
    SET buyer_org_id = p_counterparty_org_id,
        buyer_name = p_counterparty_name,
        match_type = 'bilateral'
    WHERE id = p_match_id;

  ELSE
    IF v_match.seller_org_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'SLOT_TAKEN',
        'message', 'The seller slot has already been filled by another partner',
        'filled_by', v_match.seller_org_id
      );
    END IF;

    UPDATE matches
    SET seller_org_id = p_counterparty_org_id,
        seller_name = p_counterparty_name,
        match_type = 'bilateral'
    WHERE id = p_match_id;
  END IF;

  -- 6. Return the updated row
  SELECT row_to_json(m.*) INTO v_result
  FROM matches m
  WHERE m.id = p_match_id;

  RETURN jsonb_build_object(
    'success', true,
    'previous_type', 'unilateral',
    'new_type', 'bilateral',
    'bound_role', p_counterparty_role,
    'bound_org_id', p_counterparty_org_id,
    'match', v_result
  );
END;
$$;
