
-- ============================================================================
-- Governance Record Atomicity — Batch 2 (WaD + finality/collapse)
-- ============================================================================
-- Pure additive change. Wraps WaD pass/fail and collapse/finality business
-- mutations together with their canonical governance events in one
-- SECURITY DEFINER transaction via gov_emit_event. If gov_emit_event throws,
-- the business mutation rolls back.
-- ============================================================================

-- ── atomic_wad_issue ────────────────────────────────────────────────────────
-- Inserts the WaD row (state=ISSUED) and emits wad.passed in one tx.
CREATE OR REPLACE FUNCTION public.atomic_wad_issue(
  p_org_id uuid,
  p_poi_id uuid,
  p_governance jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_wad_id uuid;
  v_issued_at timestamptz := now();
  v_gov_input jsonb;
  v_governance_event_id uuid;
BEGIN
  IF p_org_id IS NULL OR p_poi_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT',
      'message', 'org_id and poi_id are required');
  END IF;

  -- Idempotent insert keyed by (org_id, poi_id). If a WaD already exists
  -- for this POI, return it without re-issuing.
  SELECT id INTO v_wad_id
    FROM public.p3_wads
   WHERE org_id = p_org_id AND poi_id = p_poi_id
   FOR UPDATE;

  IF v_wad_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'wad_id', v_wad_id,
      'governance_event_id', NULL
    );
  END IF;

  INSERT INTO public.p3_wads (org_id, poi_id, state, issued_at)
  VALUES (p_org_id, p_poi_id, 'ISSUED', v_issued_at)
  RETURNING id INTO v_wad_id;

  IF p_governance IS NOT NULL THEN
    v_gov_input := p_governance
      || jsonb_build_object(
        'org_id',         p_org_id::text,
        'aggregate_type', COALESCE(p_governance->>'aggregate_type','wad'),
        'aggregate_id',   COALESCE(p_governance->>'aggregate_id', v_wad_id::text),
        'event_type',     COALESCE(p_governance->>'event_type','wad.passed'),
        'poi_id',         p_poi_id::text,
        'wad_id',         v_wad_id::text,
        'new_state',      COALESCE(p_governance->>'new_state','ISSUED')
      );
    v_governance_event_id := public.gov_emit_event(v_gov_input);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'wad_id', v_wad_id,
    'issued_at', v_issued_at,
    'governance_event_id', v_governance_event_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_wad_issue(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_wad_issue(uuid, uuid, jsonb) TO service_role;


-- ── atomic_wad_deny ─────────────────────────────────────────────────────────
-- Inserts the WaD row (state=DENIED) with denial_reasons and emits wad.failed
-- in one tx.
CREATE OR REPLACE FUNCTION public.atomic_wad_deny(
  p_org_id uuid,
  p_poi_id uuid,
  p_denial_reasons jsonb,
  p_governance jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_wad_id uuid;
  v_gov_input jsonb;
  v_governance_event_id uuid;
BEGIN
  IF p_org_id IS NULL OR p_poi_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT',
      'message', 'org_id and poi_id are required');
  END IF;

  SELECT id INTO v_wad_id
    FROM public.p3_wads
   WHERE org_id = p_org_id AND poi_id = p_poi_id
   FOR UPDATE;

  IF v_wad_id IS NOT NULL THEN
    -- Already exists: do not duplicate. Return existing row but still emit
    -- the governance event so denial reasons are recorded (idempotency
    -- inside gov_emit_event dedupes within 5 minutes).
    IF p_governance IS NOT NULL THEN
      v_gov_input := p_governance
        || jsonb_build_object(
          'org_id',         p_org_id::text,
          'aggregate_type', COALESCE(p_governance->>'aggregate_type','wad'),
          'aggregate_id',   COALESCE(p_governance->>'aggregate_id', v_wad_id::text),
          'event_type',     COALESCE(p_governance->>'event_type','wad.failed'),
          'poi_id',         p_poi_id::text,
          'wad_id',         v_wad_id::text
        );
      v_governance_event_id := public.gov_emit_event(v_gov_input);
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'wad_id', v_wad_id,
      'governance_event_id', v_governance_event_id
    );
  END IF;

  INSERT INTO public.p3_wads (org_id, poi_id, state, denial_reasons)
  VALUES (p_org_id, p_poi_id, 'DENIED', COALESCE(p_denial_reasons, '[]'::jsonb))
  RETURNING id INTO v_wad_id;

  IF p_governance IS NOT NULL THEN
    v_gov_input := p_governance
      || jsonb_build_object(
        'org_id',         p_org_id::text,
        'aggregate_type', COALESCE(p_governance->>'aggregate_type','wad'),
        'aggregate_id',   COALESCE(p_governance->>'aggregate_id', p_poi_id::text),
        'event_type',     COALESCE(p_governance->>'event_type','wad.failed'),
        'poi_id',         p_poi_id::text,
        'wad_id',         v_wad_id::text
      );
    v_governance_event_id := public.gov_emit_event(v_gov_input);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'wad_id', v_wad_id,
    'governance_event_id', v_governance_event_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_wad_deny(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_wad_deny(uuid, uuid, jsonb, jsonb) TO service_role;


-- ── atomic_collapse_record ──────────────────────────────────────────────────
-- Inserts collapse_ledger row, optionally updates the linked match + poi_events,
-- writes audit_logs, and emits BOTH execution.permitted AND finality.recorded
-- in one transaction. If either governance write fails, everything rolls back.
--
-- p_collapse jsonb keys:
--   org_id, counterparty_org_id, match_id (nullable), asset_id, quantity,
--   price, currency, client_timestamp, idempotency_key, signed_payload,
--   signature_key_id, signature_valid, payload_hash, poi_state, metadata,
--   actor_user_id, actor_api_key_id, payload_ciphertext, ntp_source,
--   ntp_drift_ms, timestamp_source_metadata, annulment_reference, request_id
CREATE OR REPLACE FUNCTION public.atomic_collapse_record(
  p_collapse jsonb,
  p_governance_execution jsonb,
  p_governance_finality jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_org_id uuid := NULLIF(p_collapse->>'org_id','')::uuid;
  v_counterparty_org_id uuid := NULLIF(p_collapse->>'counterparty_org_id','')::uuid;
  v_match_id uuid := NULLIF(p_collapse->>'match_id','')::uuid;
  v_idempotency_key text := p_collapse->>'idempotency_key';
  v_actor_user_id uuid := NULLIF(p_collapse->>'actor_user_id','')::uuid;
  v_actor_api_key_id uuid := NULLIF(p_collapse->>'actor_api_key_id','')::uuid;
  v_signature_valid boolean := COALESCE((p_collapse->>'signature_valid')::boolean, false);
  v_payload_hash text := p_collapse->>'payload_hash';
  v_request_id text := p_collapse->>'request_id';
  v_collapse_id uuid;
  v_created_at timestamptz;
  v_existing_id uuid;
  v_existing_hash text;
  v_existing_created_at timestamptz;
  v_execution_event_id uuid;
  v_finality_event_id uuid;
  v_exec_input jsonb;
  v_final_input jsonb;
BEGIN
  IF v_org_id IS NULL OR v_counterparty_org_id IS NULL OR v_idempotency_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT',
      'message', 'org_id, counterparty_org_id and idempotency_key are required');
  END IF;

  -- Idempotent: if a ledger row with the same (org_id, idempotency_key)
  -- exists, return it without re-running governance writes.
  SELECT id, payload_hash, created_at INTO v_existing_id, v_existing_hash, v_existing_created_at
    FROM public.collapse_ledger
   WHERE org_id = v_org_id AND idempotency_key = v_idempotency_key
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'collapse_id', v_existing_id,
      'payload_hash', v_existing_hash,
      'created_at', v_existing_created_at,
      'execution_event_id', NULL,
      'finality_event_id', NULL
    );
  END IF;

  INSERT INTO public.collapse_ledger (
    org_id, counterparty_org_id, match_id, asset_id, quantity, price, currency,
    client_timestamp, idempotency_key, signed_payload, signature_key_id,
    signature_valid, payload_hash, poi_state, metadata, actor_user_id,
    payload_ciphertext, ntp_source, ntp_drift_ms, timestamp_source_metadata,
    annulment_reference
  ) VALUES (
    v_org_id,
    v_counterparty_org_id,
    v_match_id,
    p_collapse->>'asset_id',
    (p_collapse->>'quantity')::numeric,
    (p_collapse->>'price')::numeric,
    p_collapse->>'currency',
    (p_collapse->>'client_timestamp')::timestamptz,
    v_idempotency_key,
    p_collapse->>'signed_payload',
    NULLIF(p_collapse->>'signature_key_id',''),
    v_signature_valid,
    v_payload_hash,
    COALESCE(p_collapse->>'poi_state','COMPLETED'),
    COALESCE(p_collapse->'metadata','{}'::jsonb),
    v_actor_user_id,
    NULLIF(p_collapse->>'payload_ciphertext',''),
    COALESCE(p_collapse->>'ntp_source','edge-server-utc'),
    NULLIF(p_collapse->>'ntp_drift_ms','')::int,
    COALESCE(p_collapse->'timestamp_source_metadata','{}'::jsonb),
    NULLIF(p_collapse->>'annulment_reference','')::uuid
  )
  RETURNING id, created_at INTO v_collapse_id, v_created_at;

  -- Update linked match + poi_events
  IF v_match_id IS NOT NULL THEN
    UPDATE public.matches SET poi_state = 'COMPLETED' WHERE id = v_match_id;

    INSERT INTO public.poi_events (
      match_id, org_id, from_state, to_state, actor_user_id, actor_api_key_id,
      reason, metadata
    ) VALUES (
      v_match_id, v_org_id, 'COMPLETION_REQUESTED', 'COMPLETED',
      v_actor_user_id, v_actor_api_key_id,
      'Deterministic collapse via collapse engine',
      jsonb_build_object(
        'collapse_id', v_collapse_id,
        'payload_hash', v_payload_hash,
        'signature_valid', v_signature_valid,
        'idempotency_key', v_idempotency_key
      )
    );
  END IF;

  -- Audit log row (mirrors edge fn legacy audit)
  INSERT INTO public.audit_logs (
    org_id, actor_user_id, actor_api_key_id, action, entity_type, entity_id, metadata
  ) VALUES (
    v_org_id, v_actor_user_id, v_actor_api_key_id, 'poi.completed',
    'collapse_ledger', v_collapse_id,
    jsonb_build_object(
      'payload_hash', v_payload_hash,
      'signature_valid', v_signature_valid,
      'idempotency_key', v_idempotency_key,
      'counterparty_org_id', v_counterparty_org_id,
      'asset_id', p_collapse->>'asset_id',
      'quantity', p_collapse->>'quantity',
      'price', p_collapse->>'price',
      'currency', p_collapse->>'currency',
      'request_id', v_request_id
    )
  );

  -- ── Governance: execution.permitted (fail-closed) ──
  IF p_governance_execution IS NULL THEN
    RAISE EXCEPTION 'GOV_AUDIT_INVALID: p_governance_execution required';
  END IF;
  v_exec_input := p_governance_execution
    || jsonb_build_object(
      'org_id',           v_org_id::text,
      'aggregate_type',   COALESCE(p_governance_execution->>'aggregate_type','match'),
      'aggregate_id',     COALESCE(p_governance_execution->>'aggregate_id', COALESCE(v_match_id::text, v_collapse_id::text)),
      'event_type',       COALESCE(p_governance_execution->>'event_type','execution.permitted'),
      'match_id',         v_match_id::text,
      'credit_ledger_id', v_collapse_id::text
    );
  v_execution_event_id := public.gov_emit_event(v_exec_input);

  -- ── Governance: finality.recorded (fail-closed) ──
  IF p_governance_finality IS NULL THEN
    RAISE EXCEPTION 'GOV_AUDIT_INVALID: p_governance_finality required';
  END IF;
  v_final_input := p_governance_finality
    || jsonb_build_object(
      'org_id',           v_org_id::text,
      'aggregate_type',   COALESCE(p_governance_finality->>'aggregate_type','collapse_ledger'),
      'aggregate_id',     COALESCE(p_governance_finality->>'aggregate_id', v_collapse_id::text),
      'event_type',       COALESCE(p_governance_finality->>'event_type','finality.recorded'),
      'match_id',         v_match_id::text,
      'credit_ledger_id', v_collapse_id::text,
      'previous_state',   COALESCE(p_governance_finality->>'previous_state','COMPLETION_REQUESTED'),
      'new_state',        COALESCE(p_governance_finality->>'new_state','COMPLETED')
    );
  v_finality_event_id := public.gov_emit_event(v_final_input);

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'collapse_id', v_collapse_id,
    'payload_hash', v_payload_hash,
    'created_at', v_created_at,
    'execution_event_id', v_execution_event_id,
    'finality_event_id', v_finality_event_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_collapse_record(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_collapse_record(jsonb, jsonb, jsonb) TO service_role;
