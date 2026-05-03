-- ═══════════════════════════════════════════════════════════════════════════
-- D-02: POI terms drift protection
-- ═══════════════════════════════════════════════════════════════════════════
-- Problem: atomic_generate_poi_v2 minted POIs without binding the user's
-- acknowledgement to the live commercial terms. A user could ack, navigate
-- back, change price/quantity/currency/etc., and mint on stale ack.
--
-- Fix:
--   1. compute_match_terms_hash(match_id) returns a deterministic SHA-256
--      fingerprint of canonical commercial terms (sorted key=value pairs).
--   2. atomic_generate_poi_v2 gains p_terms_hash text. If non-null and !=
--      server-computed hash → reject with TERMS_DRIFT.
--   3. The final hash is embedded in the ledger event payload AND the
--      poi.acknowledgements_recorded audit row.
--
-- Backwards compatibility: the new parameter is OPTIONAL with DEFAULT NULL.
-- Sole production caller (supabase/functions/match) is updated in this
-- changeset to always pass the hash. Hash mismatch is the only rejection
-- path; a NULL hash continues to work for legacy / test callers (logged in
-- audit metadata as terms_hash_supplied=false). Stage D2 hardening can
-- later flip this to required.
-- ═══════════════════════════════════════════════════════════════════════════

-- Canonical hash helper. MUST mirror src/lib/poi-terms-hash.ts exactly.
-- Algorithm: stable alphabetical key order, "key=value" pairs joined by "|",
-- empty/null values rendered as the literal string "" (after key=).
-- Numbers are formatted via numeric→text (no trailing zeros: 100.00 == 100).
CREATE OR REPLACE FUNCTION public.compute_match_terms_hash(p_match_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m RECORD;
  v_canonical text;
BEGIN
  SELECT
    commodity,
    quantity_amount,
    quantity_unit,
    price_amount,
    price_currency,
    terms,
    buyer_name,
    buyer_id,
    buyer_org_id,
    seller_name,
    seller_id,
    seller_org_id,
    origin_country,
    destination_country,
    match_type
  INTO m
  FROM public.matches
  WHERE id = p_match_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Build the canonical string. Keys MUST be in this exact alphabetical
  -- order to match the client. Numeric values use text-cast (which strips
  -- trailing zeros via numeric, e.g. 100.00 → '100'). NULLs render as ''.
  v_canonical :=
       'buyer_id='            || COALESCE(btrim(m.buyer_id::text), '') || '|'
    || 'buyer_name='          || COALESCE(btrim(m.buyer_name), '') || '|'
    || 'buyer_org_id='        || COALESCE(m.buyer_org_id::text, '') || '|'
    || 'commodity='           || COALESCE(btrim(m.commodity), '') || '|'
    || 'destination_country=' || COALESCE(btrim(m.destination_country), '') || '|'
    || 'match_type='          || COALESCE(btrim(m.match_type), '') || '|'
    || 'origin_country='      || COALESCE(btrim(m.origin_country), '') || '|'
    || 'price_amount='        || COALESCE(m.price_amount::text, '') || '|'
    || 'price_currency='      || COALESCE(btrim(m.price_currency), '') || '|'
    || 'quantity_amount='     || COALESCE(m.quantity_amount::text, '') || '|'
    || 'quantity_unit='       || COALESCE(btrim(m.quantity_unit), '') || '|'
    || 'seller_id='           || COALESCE(btrim(m.seller_id::text), '') || '|'
    || 'seller_name='         || COALESCE(btrim(m.seller_name), '') || '|'
    || 'seller_org_id='       || COALESCE(m.seller_org_id::text, '') || '|'
    || 'terms='               || COALESCE(btrim(m.terms), '');

  RETURN encode(extensions.digest(v_canonical::bytea, 'sha256'), 'hex');
END;
$$;

REVOKE ALL ON FUNCTION public.compute_match_terms_hash(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_match_terms_hash(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.compute_match_terms_hash(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.compute_match_terms_hash(uuid) TO service_role;

-- ─── Updated atomic_generate_poi_v2 with p_terms_hash ─────────────────────
-- Drop and recreate so we can append the new parameter with DEFAULT NULL.
DROP FUNCTION IF EXISTS public.atomic_generate_poi_v2(uuid, uuid, timestamptz, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.atomic_generate_poi_v2(
  p_match_id uuid,
  p_org_id uuid,
  p_settled_at timestamptz,
  p_actor_user_id uuid DEFAULT NULL,
  p_acks jsonb DEFAULT NULL,
  p_terms_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_server_terms_hash text;
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

  -- ── D-02: TERMS DRIFT GUARD ──
  -- Recompute the canonical terms fingerprint from the live row under the
  -- SAME row lock taken above (FOR UPDATE). Compare to the hash the user
  -- saw and acknowledged. If non-null and different → reject. NULL hash is
  -- accepted for backwards compatibility (caller is expected to send it).
  v_server_terms_hash := public.compute_match_terms_hash(p_match_id);

  IF p_terms_hash IS NOT NULL AND p_terms_hash <> v_server_terms_hash THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'TERMS_DRIFT',
      'message', 'The trade terms changed after you acknowledged them. Please review and confirm the updated terms before generating POI.',
      'expected_terms_hash', v_server_terms_hash,
      'submitted_terms_hash', p_terms_hash
    );
  END IF;

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
    'declaration_ack=true|atb_ack=true|ack_ts=' || v_ack_timestamp ||
    '|terms_hash=' || coalesce(v_server_terms_hash, '')
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
      'terms_hash', v_server_terms_hash,
      'terms_hash_supplied', (p_terms_hash IS NOT NULL),
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
      'terms_hash', v_server_terms_hash,
      'terms_hash_supplied', (p_terms_hash IS NOT NULL),
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
    'terms_hash', v_server_terms_hash,
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

-- Re-apply SECDEF Stage D1 lockdown for the recreated function.
REVOKE EXECUTE ON FUNCTION public.atomic_generate_poi_v2(uuid, uuid, timestamptz, uuid, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_generate_poi_v2(uuid, uuid, timestamptz, uuid, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atomic_generate_poi_v2(uuid, uuid, timestamptz, uuid, jsonb, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_generate_poi_v2(uuid, uuid, timestamptz, uuid, jsonb, text) TO   service_role;