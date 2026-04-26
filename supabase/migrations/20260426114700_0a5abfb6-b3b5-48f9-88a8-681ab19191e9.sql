CREATE OR REPLACE FUNCTION public.atomic_generate_poi_v2(
  p_match_id uuid,
  p_org_id uuid,
  p_settled_at timestamp with time zone,
  p_actor_user_id uuid DEFAULT NULL,
  p_waiver jsonb DEFAULT NULL
)
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
  v_price numeric;
  v_quantity numeric;
  v_currency text;
  v_docs_count int;
  v_notes_count int;
  v_existing_waiver uuid;
  v_waiver_required boolean;
  v_waiver_supplied boolean;
  v_waiver_audit_id uuid;
BEGIN
  SELECT id, state, status, org_id, buyer_org_id, seller_org_id, commodity,
         price_amount, quantity_amount, price_currency
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

  IF v_match.state IN ('intent_declared', 'counterparty_sighted', 'committed', 'completed') OR v_match.status = 'settled' THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'message', 'POI already generated');
  END IF;

  IF v_match.state IS DISTINCT FROM 'discovery' THEN
    RETURN jsonb_build_object('success', false, 'error', 'STATE_CONFLICT', 'message', 'Match is not in discovery state');
  END IF;

  SELECT count(*) INTO v_docs_count FROM match_documents WHERE match_id = p_match_id;
  SELECT count(*) INTO v_notes_count FROM match_notes WHERE match_id = p_match_id;

  v_waiver_required := (v_docs_count = 0 AND v_notes_count = 0);
  v_waiver_supplied := p_waiver IS NOT NULL;

  IF v_waiver_required THEN
    SELECT id INTO v_existing_waiver
      FROM audit_logs
     WHERE entity_id = p_match_id
       AND action = 'poi.evidence_waiver_acknowledged'
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_existing_waiver IS NULL AND NOT v_waiver_supplied THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'EVIDENCE_WAIVER_REQUIRED',
        'message', 'Cannot generate POI: this match has no supporting documents or notes. An acknowledged evidence waiver is required.'
      );
    END IF;

    IF v_waiver_supplied THEN
      IF coalesce(p_waiver->>'category', '') = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'WAIVER_INVALID', 'message', 'Waiver category is required.');
      END IF;
      IF length(trim(coalesce(p_waiver->>'reason', ''))) < 1 THEN
        RETURN jsonb_build_object('success', false, 'error', 'WAIVER_INVALID', 'message', 'Waiver reason is required.');
      END IF;
      IF p_actor_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'WAIVER_INVALID', 'message', 'Waiver requires an authenticated actor.');
      END IF;
    END IF;
  ELSE
    IF v_waiver_supplied THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'WAIVER_NOT_APPLICABLE',
        'message', 'Supporting documents or notes were added before mint; a waiver is no longer applicable.'
      );
    END IF;
  END IF;

  SELECT public.atomic_token_burn(p_org_id, v_token_cost, 'action:declare_intent', p_match_id::text) INTO v_burn_result;

  IF NOT (v_burn_result ->> 'success')::boolean THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INSUFFICIENT_TOKEN_BALANCE',
      'message', format('Insufficient tokens. Required: %s, Available: %s', v_token_cost, v_burn_result ->> 'current_balance')
    );
  END IF;

  IF v_waiver_required AND v_waiver_supplied THEN
    INSERT INTO audit_logs (
      org_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      p_org_id,
      p_actor_user_id,
      'poi.evidence_waiver_acknowledged',
      'match',
      p_match_id,
      jsonb_build_object(
        'document_count', v_docs_count,
        'notes_count', v_notes_count,
        'waiver_category', p_waiver->>'category',
        'waiver_reason', trim(p_waiver->>'reason'),
        'waived_at', now(),
        'match_state', v_match.state,
        'commodity', v_match.commodity,
        'actor_roles', coalesce(p_waiver->'actor_roles', '[]'::jsonb),
        'atomic', true
      )
    )
    RETURNING id INTO v_waiver_audit_id;
  END IF;

  UPDATE matches
     SET state = 'committed',
         status = 'settled',
         poi_state = 'COMPLETED',
         settled_at = p_settled_at,
         buyer_committed_at = COALESCE(buyer_committed_at, p_settled_at),
         seller_committed_at = COALESCE(seller_committed_at, p_settled_at),
         counterparty_sighted_at = COALESCE(counterparty_sighted_at, p_settled_at)
   WHERE id = p_match_id;

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
    jsonb_build_object(
      'settled_at', p_settled_at,
      'tokens_burned', v_token_cost,
      'evidence_waiver_id', v_waiver_audit_id,
      'document_count_at_mint', v_docs_count,
      'notes_count_at_mint', v_notes_count
    ),
    p_actor_user_id, v_payload_hash, v_prev_hash
  )
  RETURNING id INTO v_event_id;

  UPDATE matches SET event_chain_hash = v_payload_hash WHERE id = p_match_id;

  v_counterparty_org_id := CASE
    WHEN v_match.buyer_org_id = p_org_id THEN v_match.seller_org_id
    WHEN v_match.seller_org_id = p_org_id THEN v_match.buyer_org_id
    ELSE NULL
  END;

  IF v_counterparty_org_id IS NOT NULL AND v_counterparty_org_id <> p_org_id THEN
    v_price := COALESCE(NULLIF(v_match.price_amount, 0), 1);
    v_quantity := COALESCE(NULLIF(v_match.quantity_amount, 0), 1);
    v_currency := COALESCE(NULLIF(v_match.price_currency, ''), 'USD');

    INSERT INTO collapse_ledger (
      match_id, org_id, counterparty_org_id,
      asset_id, currency, price, quantity,
      poi_state, payload_hash, signed_payload,
      idempotency_key, client_timestamp, signature_valid
    ) VALUES (
      p_match_id,
      p_org_id,
      v_counterparty_org_id,
      COALESCE(v_match.commodity, 'unknown'),
      v_currency,
      v_price,
      v_quantity,
      'committed',
      v_payload_hash,
      v_payload_hash,
      'poi_gen_' || p_match_id::text || '_' || extract(epoch from now())::text,
      now(),
      true
    )
    RETURNING id INTO v_collapse_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'message', 'POI generated successfully',
    'tokens_burned', v_token_cost,
    'balance_after', (v_burn_result ->> 'balance_after')::int,
    'event_id', v_event_id,
    'collapse_id', v_collapse_id,
    'event_chain_hash', v_payload_hash,
    'evidence_waiver_id', v_waiver_audit_id,
    'waiver_required', v_waiver_required,
    'waiver_written_atomically', (v_waiver_audit_id IS NOT NULL)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.atomic_generate_poi_v2(uuid, uuid, timestamp with time zone, uuid, jsonb) TO authenticated, service_role;