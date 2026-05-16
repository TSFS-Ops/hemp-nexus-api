
-- Batch L: doc_type taxonomy, dedup guard, expiry-aware POI evidence count

-- 1) Doc type taxonomy
-- Backfill anything outside the conservative initial taxonomy to 'other'
UPDATE public.match_documents
   SET doc_type = 'other'
 WHERE doc_type IS NULL
    OR doc_type NOT IN ('bill_of_lading','invoice','letter_of_credit','kyc','licence','other');

ALTER TABLE public.match_documents
  DROP CONSTRAINT IF EXISTS match_documents_doc_type_check;

ALTER TABLE public.match_documents
  ADD CONSTRAINT match_documents_doc_type_check
  CHECK (doc_type IN ('bill_of_lading','invoice','letter_of_credit','kyc','licence','other'));

ALTER TABLE public.match_documents
  ALTER COLUMN doc_type SET DEFAULT 'other';

COMMENT ON CONSTRAINT match_documents_doc_type_check ON public.match_documents IS
  'Batch L: conservative initial taxonomy. Final Izenzo-specific taxonomy is policy-pending; until then, unknown labels are not accepted.';

-- 2) Duplicate document DB guard (defence-in-depth)
-- Partial unique index: same match + same uploading org + same SHA = duplicate,
-- unless the prior row is deleted/archived.
CREATE UNIQUE INDEX IF NOT EXISTS idx_match_documents_dedup_active
  ON public.match_documents (match_id, uploader_org_id, sha256_hash)
  WHERE status NOT IN ('deleted','archived');

COMMENT ON INDEX public.idx_match_documents_dedup_active IS
  'Batch L DOC-005: structural backstop preventing duplicate active evidence rows for the same file from the same org on the same match.';

-- 3) Replace atomic_generate_poi_v2 with expiry-aware evidence count
CREATE OR REPLACE FUNCTION public.atomic_generate_poi_v2(
  p_match_id uuid,
  p_org_id uuid,
  p_settled_at timestamp with time zone,
  p_actor_user_id uuid DEFAULT NULL::uuid,
  p_acks jsonb DEFAULT NULL::jsonb,
  p_terms_hash text DEFAULT NULL::text
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
  v_server_terms_hash text;
  v_normalized_hash text;
  v_engagement_created boolean := false;
  v_engagement_existed boolean := false;
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

  v_counterparty_org_id := CASE
    WHEN v_match.buyer_org_id = p_org_id THEN v_match.seller_org_id
    ELSE v_match.buyer_org_id
  END;

  IF v_match.state IN ('intent_declared', 'counterparty_sighted', 'committed', 'completed')
     OR v_match.status = 'settled' THEN
    IF NOT EXISTS (
      SELECT 1 FROM poi_engagements
      WHERE match_id = p_match_id
        AND engagement_status NOT IN ('expired'::engagement_status, 'declined'::engagement_status, 'cancelled_email_change'::engagement_status)
    ) THEN
      BEGIN
        INSERT INTO poi_engagements (
          match_id, org_id, counterparty_org_id, counterparty_type, engagement_status, source
        ) VALUES (
          p_match_id, v_match.org_id, v_counterparty_org_id,
          CASE WHEN v_counterparty_org_id IS NOT NULL THEN 'known'::counterparty_type ELSE 'unknown'::counterparty_type END,
          'notification_sent'::engagement_status,
          'poi_mint_repair'
        );
        v_engagement_created := true;
      EXCEPTION WHEN unique_violation THEN
        v_engagement_existed := true;
      END;
    ELSE
      v_engagement_existed := true;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'engagement_created', v_engagement_created,
      'engagement_existed', v_engagement_existed,
      'message', 'POI already generated'
    );
  END IF;

  IF v_match.state IS DISTINCT FROM 'discovery' THEN
    RETURN jsonb_build_object('success', false, 'error', 'STATE_CONFLICT', 'message', 'Match is not in discovery state');
  END IF;

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

  IF p_terms_hash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TERMS_HASH_REQUIRED',
      'message', 'POI mint requires a terms hash. Please review and acknowledge the trade terms before generating POI.');
  END IF;

  v_normalized_hash := lower(btrim(p_terms_hash));

  IF v_normalized_hash = '' OR v_normalized_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'TERMS_HASH_REQUIRED',
      'message', 'POI mint requires a terms hash. Please review and acknowledge the trade terms before generating POI.');
  END IF;

  v_server_terms_hash := public.compute_match_terms_hash(p_match_id);

  IF v_normalized_hash <> v_server_terms_hash THEN
    RETURN jsonb_build_object('success', false, 'error', 'TERMS_DRIFT',
      'message', 'The trade terms changed after you acknowledged them. Please review and confirm the updated terms before generating POI.',
      'expected_terms_hash', v_server_terms_hash,
      'submitted_terms_hash', v_normalized_hash);
  END IF;

  -- ── Per-side minimum evidence (bilateral only) ──
  -- Batch L DOC-003: expired and deleted/archived docs DO NOT count toward
  -- the floor. expiry_date IS NULL is preserved (legacy/non-expiring docs).
  v_is_unilateral := (v_match.match_type = 'unilateral');

  SELECT count(*) FILTER (WHERE org_id = v_match.buyer_org_id),
         count(*) FILTER (WHERE org_id = v_match.seller_org_id),
         count(*)
    INTO v_buyer_docs_count, v_seller_docs_count, v_total_docs_count
    FROM match_documents
   WHERE match_id = p_match_id
     AND status NOT IN ('deleted','archived','expired')
     AND (expiry_date IS NULL OR expiry_date > now());

  SELECT count(*) INTO v_gov_docs_count FROM governance_documents WHERE deal_reference_id = p_match_id;
  SELECT count(*) INTO v_notes_count FROM match_notes WHERE match_id = p_match_id;

  IF NOT v_is_unilateral THEN
    IF v_match.buyer_org_id IS NOT NULL AND v_buyer_docs_count = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'MIN_EVIDENCE_PER_SIDE',
        'message', 'Buyer has no current supporting documents attached. At least one non-expired document per side is required to seal a Proof of Intent.',
        'side', 'buyer',
        'buyer_documents_count', v_buyer_docs_count,
        'seller_documents_count', v_seller_docs_count);
    END IF;

    IF v_match.seller_org_id IS NOT NULL AND v_seller_docs_count = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'MIN_EVIDENCE_PER_SIDE',
        'message', 'Seller has no current supporting documents attached. At least one non-expired document per side is required to seal a Proof of Intent.',
        'side', 'seller',
        'buyer_documents_count', v_buyer_docs_count,
        'seller_documents_count', v_seller_docs_count);
    END IF;
  END IF;

  SELECT public.atomic_token_burn(p_org_id, v_token_cost, 'action:declare_intent', p_match_id::text) INTO v_burn_result;

  IF NOT (v_burn_result ->> 'success')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_TOKEN_BALANCE',
      'message', format('Insufficient tokens. Required: %s, Available: %s', v_token_cost, v_burn_result ->> 'current_balance'));
  END IF;

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
    '|terms_hash=' || v_server_terms_hash
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
      'ack_timestamp', v_ack_timestamp,
      'actor_user_id', p_actor_user_id,
      'actor_roles', v_actor_roles,
      'terms_hash', v_server_terms_hash,
      'terms_hash_supplied', true
    ),
    p_settled_at
  ) RETURNING id INTO v_event_id;

  UPDATE matches
     SET state = 'intent_declared',
         status = 'pending'
   WHERE id = p_match_id;

  INSERT INTO audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_org_id, p_actor_user_id, 'poi.minted', 'match', p_match_id,
    jsonb_build_object(
      'declaration_ack', true,
      'atb_ack', true,
      'ack_timestamp', v_ack_timestamp,
      'actor_roles', v_actor_roles,
      'terms_hash', v_server_terms_hash,
      'terms_hash_supplied', true,
      'ledger_event_id', v_event_id,
      'buyer_documents_count_at_mint', v_buyer_docs_count,
      'seller_documents_count_at_mint', v_seller_docs_count,
      'evidence_expiry_filter_applied', true
    )
  );

  BEGIN
    INSERT INTO poi_engagements (
      match_id, org_id, counterparty_org_id, counterparty_type, engagement_status, source
    ) VALUES (
      p_match_id, v_match.org_id, v_counterparty_org_id,
      CASE WHEN v_counterparty_org_id IS NOT NULL THEN 'known'::counterparty_type ELSE 'unknown'::counterparty_type END,
      'notification_sent'::engagement_status,
      'poi_mint'
    );
    v_engagement_created := true;
  EXCEPTION WHEN unique_violation THEN
    v_engagement_existed := true;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'terms_hash', v_server_terms_hash,
    'engagement_created', v_engagement_created,
    'engagement_existed', v_engagement_existed,
    'buyer_documents_count', v_buyer_docs_count,
    'seller_documents_count', v_seller_docs_count,
    'message', 'POI generated successfully'
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atomic_generate_poi_v2(uuid, uuid, timestamptz, uuid, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_generate_poi_v2(uuid, uuid, timestamptz, uuid, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atomic_generate_poi_v2(uuid, uuid, timestamptz, uuid, jsonb, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_generate_poi_v2(uuid, uuid, timestamptz, uuid, jsonb, text) TO   service_role;

COMMENT ON FUNCTION public.atomic_generate_poi_v2(uuid, uuid, timestamptz, uuid, jsonb, text) IS
  'POI mint: token burn + ledger + state + audit + engagement row, all in one transaction. '
  'Batch L DOC-003: per-side evidence count now excludes expired (expiry_date < now()) '
  'and deleted/archived/expired-status docs. expiry_date IS NULL is preserved as valid '
  '(legacy/non-expiring evidence). Final per-doc-type expiry policy pending client input.';
