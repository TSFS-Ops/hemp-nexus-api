
-- ============================================================================
-- Governance Record Atomicity — Batch 1 (POI + credit burn)
-- ============================================================================
-- Adds shared SQL helpers and extends/creates atomic RPCs so the business
-- mutation and the canonical Governance Record event are written in the same
-- database transaction. Pure additive change. Old RPC behaviour is preserved
-- when p_governance is NULL (backward-compatible default).
-- ============================================================================

-- pgcrypto is already enabled (used by ledger_events) but assert to be safe.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── Helper 1: gov_domain_for ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gov_domain_for(p_event_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE split_part(coalesce(p_event_type, ''), '.', 1)
    WHEN 'poi'                THEN 'trust'
    WHEN 'wad'                THEN 'trust'
    WHEN 'evidence'           THEN 'trust'
    WHEN 'legal_hold'         THEN 'trust'
    WHEN 'trade_request'      THEN 'trade'
    WHEN 'match'              THEN 'trade'
    WHEN 'pending_engagement' THEN 'trade'
    WHEN 'outreach'           THEN 'trade'
    WHEN 'counterparty'       THEN 'trade'
    WHEN 'execution'          THEN 'trade'
    WHEN 'finality'           THEN 'trade'
    WHEN 'payment'            THEN 'trade'
    WHEN 'credit'             THEN 'trade'
    WHEN 'dispute'            THEN 'trade'
    ELSE 'core'
  END;
$$;

-- ── Helper 2: gov_redact_jsonb ──────────────────────────────────────────────
-- Walks a jsonb value and replaces any object key matching the redaction set
-- (case-insensitive, plus pattern match on token/secret/password/payload).
CREATE OR REPLACE FUNCTION public.gov_redact_jsonb(p_input jsonb, p_depth int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_out  jsonb := '{}'::jsonb;
  v_key  text;
  v_val  jsonb;
  v_lower text;
  v_redacted_keys constant text[] := ARRAY[
    'password','secret','api_key','apikey','auth_token','access_token',
    'refresh_token','bearer','card_number','pan','cvv','cvc',
    'raw_payload','provider_payload','raw_response','document_contents',
    'document_url','passport_number','id_number','national_id',
    'private_key','service_role'
  ];
BEGIN
  IF p_input IS NULL OR p_depth > 6 THEN
    RETURN '{}'::jsonb;
  END IF;

  IF jsonb_typeof(p_input) <> 'object' THEN
    RETURN '{}'::jsonb;
  END IF;

  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_input) LOOP
    v_lower := lower(v_key);
    IF v_lower = ANY(v_redacted_keys)
       OR v_lower ~ '(token|secret|password|payload)' THEN
      v_out := v_out || jsonb_build_object(v_key, '[redacted]'::text);
    ELSIF jsonb_typeof(v_val) = 'object' THEN
      v_out := v_out || jsonb_build_object(v_key, public.gov_redact_jsonb(v_val, p_depth + 1));
    ELSIF jsonb_typeof(v_val) = 'string' AND length(v_val #>> '{}') > 2000 THEN
      v_out := v_out || jsonb_build_object(v_key, left(v_val #>> '{}', 2000) || '…[truncated]');
    ELSE
      v_out := v_out || jsonb_build_object(v_key, v_val);
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

-- ── Helper 3: gov_emit_event ────────────────────────────────────────────────
-- Validates, deduplicates, hash-chains and inserts one event_store row.
-- Returns the event_store id (existing id on idempotent duplicate).
--
-- Expected p_input shape (JSON keys mirror TS writer):
--   event_type, org_id, aggregate_type, aggregate_id (required)
--   actor_user_id | system_actor (one required)
--   source_function (required), request_id, correlation_id, idempotency_key
--   match_id, poi_id, wad_id, engagement_id, payment_reference, credit_ledger_id
--   previous_state, new_state, allowed_or_blocked, reason_code
--   posture_snapshot (jsonb; required for critical events)
--   actor_role, actor_org_id
--   metadata (jsonb; will be redacted)
--
-- Idempotency: scoped on (aggregate_id, event_type, idempotency_key) within
-- a 5-minute window — same as the TS writer.
CREATE OR REPLACE FUNCTION public.gov_emit_event(p_input jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type     text := p_input->>'event_type';
  v_org_id         uuid := NULLIF(p_input->>'org_id','')::uuid;
  v_aggregate_type text := p_input->>'aggregate_type';
  v_aggregate_id   uuid := NULLIF(p_input->>'aggregate_id','')::uuid;
  v_actor_user_id  uuid := NULLIF(p_input->>'actor_user_id','')::uuid;
  v_system_actor   text := p_input->>'system_actor';
  v_source_fn      text := p_input->>'source_function';
  v_idempotency    text := p_input->>'idempotency_key';
  v_posture        jsonb := p_input->'posture_snapshot';
  v_posture_label  text;
  v_existing_id    uuid;
  v_prev_hash      text;
  v_event_id       uuid;
  v_payload        jsonb;
  v_safe_meta      jsonb;
  v_canonical_text text;
  v_event_hash     text;
  v_occurred_at    timestamptz := now();
  v_critical_families constant text[] := ARRAY[
    'poi','wad','execution','finality','memory','credit','payment','dispute','export'
  ];
  v_critical_names constant text[] := ARRAY['admin.hq_decision_recorded'];
  v_valid_posture constant text[] := ARRAY[
    'Standard','Pending Verification','Manual Review Required','Waiver Applied',
    'Bypass Applied','Demo/Test','Failed Verification','Expired/Stale Verification','Not recorded'
  ];
  v_is_critical    boolean;
BEGIN
  -- ── Validation ──
  IF v_event_type IS NULL OR length(v_event_type) = 0 THEN
    RAISE EXCEPTION 'GOV_AUDIT_INVALID: event_type required';
  END IF;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'GOV_AUDIT_INVALID: org_id required';
  END IF;
  IF v_aggregate_type IS NULL OR length(v_aggregate_type) = 0 THEN
    RAISE EXCEPTION 'GOV_AUDIT_INVALID: aggregate_type required';
  END IF;
  IF v_aggregate_id IS NULL THEN
    RAISE EXCEPTION 'GOV_AUDIT_INVALID: aggregate_id required';
  END IF;
  IF v_source_fn IS NULL OR length(v_source_fn) = 0 THEN
    RAISE EXCEPTION 'GOV_AUDIT_INVALID: source_function required';
  END IF;
  IF v_actor_user_id IS NULL AND (v_system_actor IS NULL OR length(v_system_actor) = 0) THEN
    RAISE EXCEPTION 'GOV_AUDIT_INVALID: actor_user_id or system_actor required';
  END IF;

  v_is_critical := split_part(v_event_type,'.',1) = ANY(v_critical_families)
                   OR v_event_type = ANY(v_critical_names);
  IF v_is_critical THEN
    IF v_posture IS NULL THEN
      RAISE EXCEPTION 'GOV_AUDIT_POSTURE_REQUIRED: % requires posture_snapshot', v_event_type;
    END IF;
    v_posture_label := v_posture->>'verification_posture';
    IF v_posture_label IS NULL OR NOT (v_posture_label = ANY(v_valid_posture)) THEN
      RAISE EXCEPTION 'GOV_AUDIT_POSTURE_INVALID: "%" not a controlled label', v_posture_label;
    END IF;
    IF v_posture_label = 'Not recorded'
       AND (v_posture->>'posture_reason' IS NULL OR length(v_posture->>'posture_reason') = 0) THEN
      RAISE EXCEPTION 'GOV_AUDIT_POSTURE_REASON_REQUIRED: posture "Not recorded" must include posture_reason';
    END IF;
  END IF;

  -- ── Idempotency dedupe (5-minute window) ──
  IF v_idempotency IS NOT NULL AND length(v_idempotency) > 0 THEN
    SELECT id INTO v_existing_id
      FROM public.event_store
     WHERE aggregate_id = v_aggregate_id
       AND event_type   = v_event_type
       AND occurred_at  >= (now() - interval '5 minutes')
       AND payload->>'idempotency_key' = v_idempotency
     ORDER BY occurred_at DESC
     LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  -- ── Build payload (mirrors TS buildPayload exactly so UI normalisers keep working) ──
  v_safe_meta := public.gov_redact_jsonb(COALESCE(p_input->'metadata', '{}'::jsonb));

  v_payload := jsonb_build_object(
    'source_function',    v_source_fn,
    'request_id',         p_input->>'request_id',
    'correlation_id',     p_input->>'correlation_id',
    'idempotency_key',    v_idempotency,
    'previous_state',     p_input->>'previous_state',
    'new_state',          p_input->>'new_state',
    'allowed_or_blocked', COALESCE(p_input->>'allowed_or_blocked','neutral'),
    'reason',             p_input->>'reason_code',
    'reason_code',        p_input->>'reason_code',
    'posture',            COALESCE(v_posture->>'verification_posture','Not recorded'),
    'posture_snapshot',   v_posture,
    'policy_version',     v_posture->>'policy_version',
    'actor_role',         p_input->>'actor_role',
    'actor_org_id',       p_input->>'actor_org_id',
    'system_actor',       v_system_actor,
    'links', jsonb_build_object(
      'match_id',          p_input->>'match_id',
      'poi_id',            p_input->>'poi_id',
      'wad_id',            p_input->>'wad_id',
      'engagement_id',     p_input->>'engagement_id',
      'payment_reference', p_input->>'payment_reference',
      'credit_ledger_id',  p_input->>'credit_ledger_id'
    ),
    'match_id', p_input->>'match_id',
    'poi_id',   p_input->>'poi_id',
    'metadata', v_safe_meta
  );

  -- ── Hash chain ──
  SELECT event_hash INTO v_prev_hash
    FROM public.event_store
   WHERE org_id = v_org_id
     AND aggregate_type = v_aggregate_type
     AND aggregate_id   = v_aggregate_id
   ORDER BY occurred_at DESC
   LIMIT 1;

  v_canonical_text := jsonb_build_object(
    'prev_hash',      v_prev_hash,
    'org_id',         v_org_id::text,
    'aggregate_type', v_aggregate_type,
    'aggregate_id',   v_aggregate_id::text,
    'event_type',     v_event_type,
    'occurred_at',    to_char(v_occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload',        v_payload
  )::text;

  v_event_hash := encode(extensions.digest(v_canonical_text::bytea, 'sha256'), 'hex');

  -- ── Insert ──
  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type, occurred_at,
    actor_id, actor_role, payload, prev_hash, event_hash
  ) VALUES (
    v_org_id,
    public.gov_domain_for(v_event_type),
    v_aggregate_type,
    v_aggregate_id,
    v_event_type,
    v_occurred_at,
    v_actor_user_id,
    COALESCE(p_input->>'actor_role', CASE WHEN v_system_actor IS NOT NULL THEN 'system' END),
    v_payload,
    v_prev_hash,
    v_event_hash
  ) RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

-- ── Lock down helpers to service_role only (SECDEF Stage D1 pattern) ────────
REVOKE ALL ON FUNCTION public.gov_redact_jsonb(jsonb, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gov_domain_for(text)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gov_emit_event(jsonb)       FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.gov_emit_event(jsonb)   TO service_role;
-- gov_redact_jsonb and gov_domain_for are immutable utilities; service_role only.
GRANT  EXECUTE ON FUNCTION public.gov_redact_jsonb(jsonb, int) TO service_role;
GRANT  EXECUTE ON FUNCTION public.gov_domain_for(text)         TO service_role;


-- ============================================================================
-- Extend atomic_token_burn with optional governance payload
-- ============================================================================
CREATE OR REPLACE FUNCTION public.atomic_token_burn(
  p_org_id uuid,
  p_amount integer,
  p_reason text DEFAULT 'governance_burn'::text,
  p_reference_id text DEFAULT NULL::text,
  p_governance jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_old_balance integer; v_new_balance integer;
  v_correlation_id text; v_match_id_meta jsonb := '{}'::jsonb;
  v_billing_hold boolean;
  v_ledger_id uuid;
  v_governance_event_id uuid;
  v_gov_input jsonb;
BEGIN
  SELECT billing_hold INTO v_billing_hold FROM public.organizations WHERE id = p_org_id;
  IF v_billing_hold IS TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'BILLING_HOLD_ACTIVE',
      'message', 'Organisation is on billing hold; credit burns are blocked until released.');
  END IF;

  UPDATE token_balances SET balance = balance - p_amount
   WHERE org_id = p_org_id AND balance >= p_amount
   RETURNING balance INTO v_new_balance;
  IF NOT FOUND THEN
    SELECT balance INTO v_old_balance FROM token_balances WHERE org_id = p_org_id;
    RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_TOKENS',
      'current_balance', COALESCE(v_old_balance, 0), 'requested_amount', p_amount);
  END IF;

  v_correlation_id := COALESCE(p_reference_id, gen_random_uuid()::text);
  IF p_reference_id IS NOT NULL AND public._is_uuid(p_reference_id) THEN
    v_match_id_meta := jsonb_build_object('match_id', p_reference_id);
  END IF;

  INSERT INTO token_ledger (org_id, endpoint, tokens_burned, outcome, remaining_balance, request_id, action_type, metadata)
  VALUES (p_org_id, COALESCE(p_reason, 'unknown'), p_amount, 'allowed', v_new_balance, v_correlation_id,
    CASE WHEN p_reason LIKE 'action:%' THEN substring(p_reason from 8)
         WHEN p_reason LIKE 'api:%' THEN 'api_call' ELSE p_reason END,
    jsonb_build_object('source', 'atomic_token_burn', 'correlation_id', v_correlation_id,
      'balance_before', v_new_balance + p_amount, 'balance_after', v_new_balance) || v_match_id_meta)
  RETURNING id INTO v_ledger_id;

  -- ── Governance Record (in-transaction, fail-closed) ──
  IF p_governance IS NOT NULL THEN
    v_gov_input := p_governance
      || jsonb_build_object(
        'org_id',           p_org_id::text,
        'aggregate_type',   COALESCE(p_governance->>'aggregate_type','credit_burn'),
        'aggregate_id',     COALESCE(p_governance->>'aggregate_id', p_org_id::text),
        'event_type',       COALESCE(p_governance->>'event_type','credit.burned'),
        'credit_ledger_id', v_ledger_id::text
      );
    -- Merge balance facts into metadata
    v_gov_input := jsonb_set(
      v_gov_input,
      '{metadata}',
      COALESCE(v_gov_input->'metadata','{}'::jsonb)
        || jsonb_build_object(
          'amount',         p_amount,
          'balance_before', v_new_balance + p_amount,
          'balance_after',  v_new_balance,
          'credit_ledger_id', v_ledger_id::text
        ),
      true
    );
    v_governance_event_id := public.gov_emit_event(v_gov_input);
  END IF;

  RETURN jsonb_build_object('success', true, 'balance_before', v_new_balance + p_amount,
    'balance_after', v_new_balance, 'burned', p_amount, 'reason', p_reason,
    'reference_id', p_reference_id, 'correlation_id', v_correlation_id,
    'credit_ledger_id', v_ledger_id,
    'governance_event_id', v_governance_event_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_token_burn(uuid, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_token_burn(uuid, integer, text, text, jsonb) TO service_role;


-- ============================================================================
-- Extend atomic_generate_poi_v2 with optional governance payload
-- ============================================================================
-- Adds p_governance jsonb DEFAULT NULL. When supplied, emits one
-- poi.created governance event INSIDE the same transaction as the mint.
-- If gov_emit_event throws, the whole RPC rolls back.
CREATE OR REPLACE FUNCTION public.atomic_generate_poi_v2(
  p_match_id uuid,
  p_org_id uuid,
  p_settled_at timestamp with time zone,
  p_actor_user_id uuid DEFAULT NULL::uuid,
  p_acks jsonb DEFAULT NULL::jsonb,
  p_terms_hash text DEFAULT NULL::text,
  p_governance jsonb DEFAULT NULL
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
  v_normalized_hash text;
  v_engagement_created boolean := false;
  v_engagement_existed boolean := false;
  v_gov_input jsonb;
  v_governance_event_id uuid;
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

  -- internal burn (no p_governance — caller controls top-level governance emit)
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

  -- ── Governance Record (in-transaction, fail-closed) ──
  IF p_governance IS NOT NULL THEN
    v_gov_input := p_governance
      || jsonb_build_object(
        'org_id',         p_org_id::text,
        'aggregate_type', COALESCE(p_governance->>'aggregate_type','match'),
        'aggregate_id',   COALESCE(p_governance->>'aggregate_id', p_match_id::text),
        'event_type',     COALESCE(p_governance->>'event_type','poi.created'),
        'match_id',       p_match_id::text,
        'previous_state', 'discovery',
        'new_state',      'intent_declared',
        'allowed_or_blocked', 'allowed'
      );
    v_governance_event_id := public.gov_emit_event(v_gov_input);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'terms_hash', v_server_terms_hash,
    'engagement_created', v_engagement_created,
    'engagement_existed', v_engagement_existed,
    'buyer_documents_count', v_buyer_docs_count,
    'seller_documents_count', v_seller_docs_count,
    'governance_event_id', v_governance_event_id,
    'message', 'POI generated successfully'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_generate_poi_v2(uuid, uuid, timestamptz, uuid, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_generate_poi_v2(uuid, uuid, timestamptz, uuid, jsonb, text, jsonb) TO service_role;


-- ============================================================================
-- NEW: atomic_poi_match_transition
-- Used by edge fn poi-transition (match.poi_state transitions).
-- Wraps: poi_events insert + matches.poi_state update + audit_logs insert
--        + canonical Governance Record event, all in one transaction.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.atomic_poi_match_transition(
  p_match_id uuid,
  p_org_id uuid,
  p_from_state text,
  p_to_state text,
  p_actor_user_id uuid,
  p_reason text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_governance jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_gov_input jsonb;
  v_governance_event_id uuid;
BEGIN
  -- 1. Append-only poi_events row
  INSERT INTO poi_events (
    match_id, org_id, from_state, to_state, actor_user_id, reason, metadata
  ) VALUES (
    p_match_id, p_org_id, p_from_state, p_to_state, p_actor_user_id, p_reason,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id, created_at INTO v_event;

  -- 2. Update match poi_state
  UPDATE matches SET poi_state = p_to_state WHERE id = p_match_id;

  -- 3. Legacy audit_logs (preserve existing lane)
  INSERT INTO audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_org_id, p_actor_user_id,
    'poi.transition.' || lower(p_from_state) || '_to_' || lower(p_to_state),
    'match', p_match_id,
    jsonb_build_object(
      'from_state', p_from_state,
      'to_state',   p_to_state,
      'reason',     p_reason,
      'poi_event_id', v_event.id
    )
  );

  -- 4. Canonical Governance Record event (fail-closed via exception)
  IF p_governance IS NOT NULL THEN
    v_gov_input := p_governance
      || jsonb_build_object(
        'org_id',           p_org_id::text,
        'aggregate_type',   COALESCE(p_governance->>'aggregate_type','match'),
        'aggregate_id',     COALESCE(p_governance->>'aggregate_id', p_match_id::text),
        'event_type',       COALESCE(p_governance->>'event_type','poi.state_changed'),
        'match_id',         p_match_id::text,
        'previous_state',   p_from_state,
        'new_state',        p_to_state,
        'allowed_or_blocked', 'allowed',
        'reason_code',      p_reason
      );
    v_gov_input := jsonb_set(v_gov_input, '{metadata}',
      COALESCE(v_gov_input->'metadata','{}'::jsonb) || jsonb_build_object('poi_event_id', v_event.id),
      true);
    v_governance_event_id := public.gov_emit_event(v_gov_input);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event.id,
    'created_at', v_event.created_at,
    'governance_event_id', v_governance_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atomic_poi_match_transition(uuid, uuid, text, text, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_poi_match_transition(uuid, uuid, text, text, uuid, text, jsonb, jsonb) TO service_role;


-- ============================================================================
-- NEW: atomic_pois_transition
-- Used by edge fn pois (POIs API: state transition).
-- Wraps: pois.update + legacy event_store row + canonical Governance Record.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.atomic_pois_transition(
  p_poi_id uuid,
  p_org_id uuid,
  p_to_state text,
  p_actor_user_id uuid DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_actor_api_key_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_legacy_event_hash text DEFAULT NULL,
  p_governance jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poi RECORD;
  v_updated RECORD;
  v_gov_input jsonb;
  v_governance_event_id uuid;
BEGIN
  SELECT * INTO v_poi FROM pois WHERE id = p_poi_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  UPDATE pois
     SET state = p_to_state,
         last_activity_at = now()
   WHERE id = p_poi_id
   RETURNING * INTO v_updated;

  -- Legacy event_store row (preserve Phase 1 timeline reads)
  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    actor_id, actor_role, payload, event_hash
  ) VALUES (
    p_org_id, 'trust', 'poi', p_poi_id, 'trust.poi.transitioned',
    p_actor_user_id, p_actor_role,
    jsonb_build_object(
      'from_state', v_poi.state,
      'to_state',   p_to_state,
      'reason',     p_reason,
      'poi_type',   v_poi.poi_type
    ),
    COALESCE(p_legacy_event_hash, encode(extensions.digest(
      (p_poi_id::text || v_poi.state || p_to_state || now()::text)::bytea, 'sha256'), 'hex'))
  );

  IF p_governance IS NOT NULL THEN
    v_gov_input := p_governance
      || jsonb_build_object(
        'org_id',         p_org_id::text,
        'aggregate_type', COALESCE(p_governance->>'aggregate_type','poi'),
        'aggregate_id',   p_poi_id::text,
        'event_type',     COALESCE(p_governance->>'event_type','poi.state_changed'),
        'poi_id',         p_poi_id::text,
        'previous_state', v_poi.state,
        'new_state',      p_to_state,
        'allowed_or_blocked', 'allowed',
        'reason_code',    p_reason
      );
    v_governance_event_id := public.gov_emit_event(v_gov_input);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'poi_id', v_updated.id,
    'poi_type', v_updated.poi_type,
    'previous_state', v_poi.state,
    'current_state', v_updated.state,
    'transitioned_at', v_updated.last_activity_at,
    'governance_event_id', v_governance_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atomic_pois_transition(uuid, uuid, text, uuid, text, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_pois_transition(uuid, uuid, text, uuid, text, uuid, text, text, jsonb) TO service_role;


-- ============================================================================
-- NEW: atomic_pois_create
-- Used by edge fn pois (POIs API: bilateral + unilateral creation).
-- Wraps: pois.insert + legacy event_store + idempotency_keys + Governance.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.atomic_pois_create(
  p_org_id uuid,
  p_poi_type text,
  p_buyer_entity_id uuid,
  p_seller_entity_id uuid,
  p_jurisdiction_code text,
  p_industry_code text,
  p_completion_probability numeric,
  p_terms jsonb,
  p_actor_user_id uuid,
  p_actor_role text,
  p_idempotency_key text,
  p_idempotency_request_hash text,
  p_idempotency_response jsonb,
  p_idempotency_status int,
  p_legacy_event_type text,
  p_legacy_event_hash text,
  p_legacy_event_payload jsonb,
  p_governance jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poi RECORD;
  v_gov_input jsonb;
  v_governance_event_id uuid;
BEGIN
  INSERT INTO pois (
    org_id, poi_type, buyer_entity_id, seller_entity_id,
    jurisdiction_code, industry_code, completion_probability, terms, state
  ) VALUES (
    p_org_id, p_poi_type, p_buyer_entity_id, p_seller_entity_id,
    p_jurisdiction_code, p_industry_code, p_completion_probability,
    COALESCE(p_terms, '{}'::jsonb), 'DRAFT'
  )
  RETURNING * INTO v_poi;

  -- Legacy event_store
  INSERT INTO public.event_store (
    org_id, domain, aggregate_type, aggregate_id, event_type,
    actor_id, actor_role, payload, event_hash
  ) VALUES (
    p_org_id, 'trust', 'poi', v_poi.id, p_legacy_event_type,
    p_actor_user_id, p_actor_role,
    COALESCE(p_legacy_event_payload, '{}'::jsonb),
    p_legacy_event_hash
  );

  -- Idempotency record
  INSERT INTO idempotency_keys (
    org_id, idempotency_key, endpoint, request_hash, response_data, response_status_code
  ) VALUES (
    p_org_id, p_idempotency_key, 'pois', p_idempotency_request_hash,
    p_idempotency_response, p_idempotency_status
  );

  IF p_governance IS NOT NULL THEN
    v_gov_input := p_governance
      || jsonb_build_object(
        'org_id',         p_org_id::text,
        'aggregate_type', 'poi',
        'aggregate_id',   v_poi.id::text,
        'event_type',     COALESCE(p_governance->>'event_type','poi.created'),
        'poi_id',         v_poi.id::text,
        'new_state',      v_poi.state,
        'allowed_or_blocked', 'allowed'
      );
    v_governance_event_id := public.gov_emit_event(v_gov_input);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'poi_id', v_poi.id,
    'poi_type', v_poi.poi_type,
    'state', v_poi.state,
    'buyer_entity_id', v_poi.buyer_entity_id,
    'seller_entity_id', v_poi.seller_entity_id,
    'completion_probability', v_poi.completion_probability,
    'jurisdiction_code', v_poi.jurisdiction_code,
    'industry_code', v_poi.industry_code,
    'created_at', v_poi.created_at,
    'governance_event_id', v_governance_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atomic_pois_create(uuid, text, uuid, uuid, text, text, numeric, jsonb, uuid, text, text, text, jsonb, int, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_pois_create(uuid, text, uuid, uuid, text, text, numeric, jsonb, uuid, text, text, text, jsonb, int, text, text, jsonb, jsonb) TO service_role;

-- ── Performance: idempotency lookup index ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_event_store_dedupe
  ON public.event_store (aggregate_id, event_type, occurred_at DESC);
