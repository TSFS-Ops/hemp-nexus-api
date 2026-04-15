CREATE OR REPLACE FUNCTION public.atomic_generate_poi(p_match_id uuid, p_org_id uuid, p_settled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_match RECORD;
  v_burn_result JSONB;
  v_token_cost INT := 1;
  v_prev_hash text;
  v_payload_hash text;
  v_event_id uuid;
  v_collapse_id uuid;
  v_counterparty_org_id uuid;
BEGIN
  -- 1. Lock the match row to prevent concurrent transitions
  SELECT id, state, status, org_id, buyer_org_id, seller_org_id, commodity
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

  -- 3. Transition state: discovery -> committed
  UPDATE matches
     SET state = 'committed',
         status = 'settled',
         settled_at = p_settled_at,
         buyer_committed_at = COALESCE(buyer_committed_at, p_settled_at),
         seller_committed_at = COALESCE(seller_committed_at, p_settled_at),
         counterparty_sighted_at = COALESCE(counterparty_sighted_at, p_settled_at)
   WHERE id = p_match_id;

  -- 4. Write event and update event_chain_hash (FIX I6)
  SELECT payload_hash INTO v_prev_hash
  FROM match_events
  WHERE match_id = p_match_id
  ORDER BY created_at DESC
  LIMIT 1;

  v_payload_hash := public.generate_event_hash('poi.generated', jsonb_build_object('settled_at', p_settled_at), v_prev_hash);

  INSERT INTO match_events (
    match_id, org_id, event_type, event_data,
    actor_user_id, payload_hash, previous_event_hash
  ) VALUES (
    p_match_id, p_org_id, 'poi.generated',
    jsonb_build_object('settled_at', p_settled_at, 'tokens_burned', v_token_cost),
    NULL, v_payload_hash, v_prev_hash
  )
  RETURNING id INTO v_event_id;

  UPDATE matches SET event_chain_hash = v_payload_hash WHERE id = p_match_id;

  -- 5. Write collapse_ledger entry (FIX I7)
  v_counterparty_org_id := CASE
    WHEN v_match.buyer_org_id = p_org_id THEN v_match.seller_org_id
    WHEN v_match.seller_org_id = p_org_id THEN v_match.buyer_org_id
    ELSE COALESCE(v_match.buyer_org_id, v_match.seller_org_id)
  END;

  INSERT INTO collapse_ledger (
    match_id, org_id, counterparty_org_id,
    asset_id, currency, price, quantity,
    poi_state, payload_hash, signed_payload,
    idempotency_key, client_timestamp, signature_valid
  ) VALUES (
    p_match_id,
    p_org_id,
    COALESCE(v_counterparty_org_id, p_org_id),
    COALESCE(v_match.commodity, 'unknown'),
    'USD',
    0,
    0,
    'committed',
    v_payload_hash,
    v_payload_hash,
    'poi_gen_' || p_match_id::text || '_' || extract(epoch from now())::text,
    now(),
    true
  )
  RETURNING id INTO v_collapse_id;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'message', 'POI generated successfully',
    'tokens_burned', v_token_cost,
    'balance_after', (v_burn_result ->> 'balance_after')::int,
    'event_id', v_event_id,
    'collapse_id', v_collapse_id,
    'event_chain_hash', v_payload_hash
  );
END;
$function$;