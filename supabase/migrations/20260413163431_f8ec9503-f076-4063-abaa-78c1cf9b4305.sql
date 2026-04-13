
-- 1. Drop and recreate atomic_generate_poi WITHOUT the bad updated_at column
DROP FUNCTION IF EXISTS public.atomic_generate_poi(uuid, uuid, timestamptz);

CREATE FUNCTION public.atomic_generate_poi(
  p_match_id UUID,
  p_org_id UUID,
  p_settled_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match RECORD;
  v_burn_result JSONB;
  v_token_cost INT := 1;
BEGIN
  -- 1. Lock the match row to prevent concurrent transitions
  SELECT id, state, status, org_id
    INTO v_match
    FROM matches
   WHERE id = p_match_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Match not found');
  END IF;

  IF v_match.org_id <> p_org_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Not your match');
  END IF;

  -- Idempotent: if already past discovery, return success without re-burning
  IF v_match.state IN ('intent_declared', 'counterparty_sighted', 'committed', 'completed') OR v_match.status = 'settled' THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'message', 'POI already generated');
  END IF;

  IF v_match.state IS DISTINCT FROM 'discovery' THEN
    RETURN jsonb_build_object('success', false, 'error', 'STATE_CONFLICT', 'message', 'Match is not in discovery state');
  END IF;

  -- 2. Burn tokens INSIDE the same transaction
  SELECT public.atomic_token_burn(p_org_id, v_token_cost, 'action:declare_intent', p_match_id::text) INTO v_burn_result;

  IF NOT (v_burn_result ->> 'success')::boolean THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INSUFFICIENT_TOKEN_BALANCE',
      'message', format('Insufficient tokens. Required: %s, Available: %s', v_token_cost, v_burn_result ->> 'current_balance')
    );
  END IF;

  -- 3. Transition state: discovery -> committed (collapsed chain)
  --    NOTE: removed "updated_at = now()" which caused the crash (column does not exist)
  UPDATE matches
     SET state = 'committed',
         status = 'settled',
         settled_at = p_settled_at,
         buyer_committed_at = COALESCE(buyer_committed_at, p_settled_at),
         seller_committed_at = COALESCE(seller_committed_at, p_settled_at),
         counterparty_sighted_at = COALESCE(counterparty_sighted_at, p_settled_at)
   WHERE id = p_match_id;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'message', 'POI generated successfully',
    'tokens_burned', v_token_cost,
    'balance_after', (v_burn_result ->> 'balance_after')::int
  );
END;
$$;

-- 2. Drop the legacy uuid overload of atomic_token_burn to prevent ambiguous resolution
DROP FUNCTION IF EXISTS public.atomic_token_burn(uuid, integer, text, uuid);
