-- POI hardening (final 17-element scope agreed 2026-04-30):
--   1. Always-on Declaration acknowledgement (sentence ack)
--   2. Always-on Authority-to-Bind (ATB) acknowledgement
--   3. Minimum-bundle gate: at least one document per side (bilateral only;
--      unilateral POIs remain document-optional)
--   4. Remove the evidence-waiver gate entirely (no waiver path, no waiver row)
--   5. Persist declaration_ack, atb_ack, actor_roles, per-side evidence counts
--      and acknowledgement timestamp into the ledger payload + audit_logs
--
-- Backwards compatibility:
--   * Old function signature (with p_waiver) is dropped; the only caller
--     (supabase/functions/match) is updated in the same release to send p_acks.
--   * existing un-minted DRAFTs/PENDING_APPROVAL POIs MUST satisfy the new
--     gate (no grandfathering — per product directive 2026-04-30).

DROP FUNCTION IF EXISTS public.atomic_generate_poi_v2(uuid, uuid, timestamptz, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.atomic_generate_poi_v2(
  p_match_id uuid,
  p_org_id uuid,
  p_settled_at timestamptz,
  p_actor_user_id uuid DEFAULT NULL,
  p_acks jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_match RECORD;
  v_burn_result jsonb;
  v_token_cost int := 1;
  v_prev_hash text;
  v_payload_hash text;
  v_event_id uuid;
  v_counterparty_org_id uuid;
  v_price numeric;
  v_quantity numeric;
  v_currency text;
  v_buyer_docs_count int := 0;
  v_seller_docs_count int := 0;
  v_total_docs_count int := 0;
  v_gov_docs_count int := 0;
  v_notes_count int := 0;
  v_is_unilateral boolean;
  v_declaration_ack boolean;
  v_atb_ack boolean;
  v_actor_roles jsonb;
  v_ack_timestamp text;
BEGIN
  SELECT id, state, status, org_id, buyer_org_id, seller_org_id, commodity,
         price_amount, quantity_amount, price_currency, match_type
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

  IF v_match.state IN ('intent_declared', 'counterparty_sighted', 'committed', 'completed')
     OR v_match.status = 'settled' THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'message', 'POI already generated');
  END IF;

  IF v_match.state IS DISTINCT FROM 'discovery' THEN
    RETURN jsonb_build_object('success', false, 'error', 'STATE_CONFLICT', 'message', 'Match is not in discovery state');
  END IF;

  -- ── ALWAYS-ON ACKNOWLEDGEMENTS (declaration + authority-to-bind) ──
  IF p_acks IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ACKNOWLEDGEMENTS_REQUIRED',
      'message', 'POI mint requires both the truthfulness declaration and the authority-to-bind acknowledgement.');
  END IF;

  v_declaration_ack := COALESCE((p_acks->>'declaration_ack')::boolean, false);
  v_atb_ack := COALESCE((p_acks->>'atb_ack')::boolean, false);

  IF NOT v_declaration_ack THEN
    RETURN jsonb_build_object('success', false, 'error', 'DECLARATION_ACK_REQUIRED',
      'message', 'You must confirm the truthfulness declaration before sealing this Proof of Intent.');
  END IF;

  IF NOT v_atb_ack THEN
    RETURN jsonb_build_object('success', false, 'error', 'ATB_ACK_REQUIRED',
      'message', 'You must confirm you are authorised to bind your organisation before sealing this Proof of Intent.');
  END IF;

  IF p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ACTOR_REQUIRED',
      'message', 'POI mint requires an authenticated actor.');
  END IF;

  v_actor_roles := COALESCE(p_acks->'actor_roles', '[]'::jsonb);
  v_ack_timestamp := COALESCE(p_acks->>'ack_timestamp', now()::text);

  -- ── PER-SIDE MINIMUM EVIDENCE GATE (bilateral only) ──
  v_is_unilateral := (v_match.match_type = 'unilateral');

  SELECT count(*) FILTER (WHERE org_id = v_match.buyer_org_id),
         count(*) FILTER (WHERE org_id = v_match.seller_org_id),
         count(*)
    INTO v_buyer_docs_count, v_seller_docs_count, v_total_docs_count
    FROM match_documents
   WHERE match_id = p_match_id;

  SELECT count(*) INTO v_gov_docs_count FROM governance_documents WHERE deal_reference_id = p_match_id;
  SELECT count(*) INTO v_notes_count FROM match_notes WHERE match_id = p_match_id;

  IF NOT v_is_unilateral THEN
    -- Bilateral POI: each side must have at least one document of any type.
    IF v_match.buyer_org_id IS NOT NULL AND v_buyer_docs_count = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'MIN_EVIDENCE_PER_SIDE',
        'message', 'Buyer has no supporting documents attached. At least one document per side is required to seal a Proof of Intent.',
        'side', 'buyer',
        'buyer_documents_count', v_buyer_docs_count,
        'seller_documents_count', v_seller_docs_count);
    END IF;

    IF v_match.seller_org_id IS NOT NULL AND v_seller_docs_count = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'MIN_EVIDENCE_PER_SIDE',
        'message', 'Seller has no supporting documents attached. At least one document per side is required to seal a Proof of Intent.',
        'side', 'seller',
        'buyer_documents_count', v_buyer_docs_count,
        'seller_documents_count', v_seller_docs_count);
    END IF;
  END IF;

  -- ── TOKEN BURN ──
  SELECT public.atomic_token_burn(p_org_id, v_token_cost, 'action:declare_intent', p_match_id::text) INTO v_burn_result;

  IF NOT (v_burn_result ->> 'success')::boolean THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INSUFFICIENT_TOKEN_BALANCE',
      'message', format('Insufficient tokens. Required: %s, Available: %s', v_token_cost, v_burn_result ->> 'current_balance')
    );
  END IF;

  -- ── LEDGER + COMMIT ──
  v_counterparty_org_id := CASE
    WHEN v_match.buyer_org_id = p_org_id THEN v_match.seller_org_id
    ELSE v_match.buyer_org_id
  END;
  v_price := v_match.price_amount;
  v_quantity := v_match.quantity_amount;
  v_currency := v_match.price_currency;

  SELECT payload_hash INTO v_prev_hash
    FROM ledger_events
   ORDER BY sequence_number DESC
   LIMIT 1;

  v_payload_hash := encode(extensions.digest((
    coalesce(v_prev_hash, '') ||
    p_match_id::text ||
    p_org_id::text ||
    coalesce(v_counterparty_org_id::text, '') ||
    coalesce(v_price::text, '') ||
    coalesce(v_quantity::text, '') ||
    coalesce(v_currency, '') ||
    p_settled_at::text ||
    'declaration_ack=true|atb_ack=true|ack_ts=' || v_ack_timestamp
  )::bytea, 'sha256'), 'hex');

  INSERT INTO ledger_events (
    event_type, org_id, match_id, prev_hash, payload_hash, payload, occurred_at
  ) VALUES (
    'poi.minted', p_org_id, p_match_id, v_prev_hash, v_payload_hash,
    jsonb_build_object(
      'match_id', p_match_id,
      'org_id', p_org_id,
      'counterparty_org_id', v_counterparty_org_id,
      'price', v_price,
      'quantity', v_quantity,
      'currency', v_currency,
      'settled_at', p_settled_at,
      'declaration_ack', true,
      'atb_ack', true,
      'actor_user_id', p_actor_user_id,
      'actor_roles', v_actor_roles,
      'ack_timestamp', v_ack_timestamp,
      'evidence_counts', jsonb_build_object(
        'buyer_documents_count', v_buyer_docs_count,
        'seller_documents_count', v_seller_docs_count,
        'total_match_documents', v_total_docs_count,
        'governance_documents', v_gov_docs_count,
        'notes', v_notes_count
      )
    ),
    p_settled_at
  ) RETURNING id INTO v_event_id;

  -- Audit row capturing the acknowledgements + per-side counts.
  INSERT INTO audit_logs (
    org_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    p_org_id,
    p_actor_user_id,
    'poi.acknowledgements_recorded',
    'match',
    p_match_id,
    jsonb_build_object(
      'declaration_ack', true,
      'atb_ack', true,
      'actor_roles', v_actor_roles,
      'ack_timestamp', v_ack_timestamp,
      'buyer_documents_count', v_buyer_docs_count,
      'seller_documents_count', v_seller_docs_count,
      'total_match_documents', v_total_docs_count,
      'governance_documents', v_gov_docs_count,
      'notes', v_notes_count,
      'event_id', v_event_id,
      'is_unilateral', v_is_unilateral
    )
  );

  UPDATE matches
     SET state = 'committed',
         status = 'settled',
         poi_state = 'COMPLETED',
         settled_at = p_settled_at
   WHERE id = p_match_id;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'payload_hash', v_payload_hash,
    'tokens_burned', v_token_cost,
    'balance_after', (v_burn_result ->> 'balance_after')::int,
    'remaining_balance', (v_burn_result ->> 'balance_after')::int,
    'evidence_counts', jsonb_build_object(
      'buyer_documents_count', v_buyer_docs_count,
      'seller_documents_count', v_seller_docs_count
    )
  );
END;
$function$;