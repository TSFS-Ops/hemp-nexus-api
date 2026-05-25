-- ============================================================================
-- Governance Record Atomicity — Batch 3A (Disputes + Legal Hold)
-- Pure additive change. Wraps dispute open/transition and legal-hold
-- apply/release business mutations together with their canonical
-- governance events in one SECURITY DEFINER transaction via gov_emit_event.
-- If gov_emit_event throws, the business mutation rolls back.
-- ============================================================================

-- ── atomic_dispute_open ─────────────────────────────────────────────────────
-- Inserts a match_challenges row and emits dispute.opened in one tx.
-- p_input jsonb keys:
--   match_id, org_id, raised_by_org_id (nullable), raised_by_user_id,
--   raised_by_role, subject_code, summary
CREATE OR REPLACE FUNCTION public.atomic_dispute_open(
  p_input jsonb,
  p_governance jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_match_id uuid := NULLIF(p_input->>'match_id','')::uuid;
  v_org_id uuid := NULLIF(p_input->>'org_id','')::uuid;
  v_raised_by_org_id uuid := NULLIF(p_input->>'raised_by_org_id','')::uuid;
  v_raised_by_user_id uuid := NULLIF(p_input->>'raised_by_user_id','')::uuid;
  v_raised_by_role text := p_input->>'raised_by_role';
  v_subject_code text := p_input->>'subject_code';
  v_summary text := p_input->>'summary';
  v_challenge_id uuid;
  v_created_at timestamptz;
  v_status text;
  v_gov_input jsonb;
  v_governance_event_id uuid;
BEGIN
  IF v_match_id IS NULL OR v_org_id IS NULL OR v_raised_by_user_id IS NULL
     OR v_raised_by_role IS NULL OR v_subject_code IS NULL OR v_summary IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT',
      'message', 'match_id, org_id, raised_by_user_id, raised_by_role, subject_code, summary required');
  END IF;

  BEGIN
    INSERT INTO public.match_challenges (
      match_id, org_id, raised_by_org_id, raised_by_user_id,
      raised_by_role, subject_code, summary, status
    ) VALUES (
      v_match_id, v_org_id, v_raised_by_org_id, v_raised_by_user_id,
      v_raised_by_role, v_subject_code, v_summary, 'open'
    )
    RETURNING id, created_at, status INTO v_challenge_id, v_created_at, v_status;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'CHALLENGE_ALREADY_OPEN',
      'message', 'An open challenge already exists for this match');
  END;

  IF p_governance IS NOT NULL THEN
    v_gov_input := p_governance
      || jsonb_build_object(
        'org_id',         v_org_id::text,
        'aggregate_type', COALESCE(p_governance->>'aggregate_type','match_challenge'),
        'aggregate_id',   COALESCE(p_governance->>'aggregate_id', v_challenge_id::text),
        'event_type',     COALESCE(p_governance->>'event_type','dispute.opened'),
        'match_id',       v_match_id::text,
        'new_state',      COALESCE(p_governance->>'new_state','open')
      );
    v_governance_event_id := public.gov_emit_event(v_gov_input);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'challenge_id', v_challenge_id,
    'created_at', v_created_at,
    'status', v_status,
    'governance_event_id', v_governance_event_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_dispute_open(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_dispute_open(jsonb, jsonb) TO service_role;


-- ── atomic_dispute_transition ──────────────────────────────────────────────
-- Updates match_challenges status (and outcome fields) under optimistic
-- concurrency. On TERMINAL transitions (withdrawn/outcome_recorded/closed_no_action)
-- emits dispute.released (withdrawn) or dispute.closed in the same tx.
--
-- p_input jsonb keys:
--   challenge_id, expected_from_status, to_status, outcome_code (nullable),
--   outcome_summary (nullable), closed_by_user_id (nullable)
CREATE OR REPLACE FUNCTION public.atomic_dispute_transition(
  p_input jsonb,
  p_governance jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_challenge_id uuid := NULLIF(p_input->>'challenge_id','')::uuid;
  v_expected_from text := p_input->>'expected_from_status';
  v_to_status text := p_input->>'to_status';
  v_outcome_code text := p_input->>'outcome_code';
  v_outcome_summary text := p_input->>'outcome_summary';
  v_closed_by uuid := NULLIF(p_input->>'closed_by_user_id','')::uuid;
  v_match_id uuid;
  v_org_id uuid;
  v_from_status text;
  v_terminal boolean;
  v_event_type text;
  v_gov_input jsonb;
  v_governance_event_id uuid;
BEGIN
  IF v_challenge_id IS NULL OR v_to_status IS NULL OR v_expected_from IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT',
      'message', 'challenge_id, expected_from_status, to_status required');
  END IF;

  v_terminal := v_to_status IN ('withdrawn','outcome_recorded','closed_no_action');

  -- Lock + verify current state for optimistic concurrency.
  SELECT match_id, org_id, status
    INTO v_match_id, v_org_id, v_from_status
    FROM public.match_challenges
   WHERE id = v_challenge_id
   FOR UPDATE;

  IF v_from_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND',
      'message', 'Challenge not found');
  END IF;
  IF v_from_status <> v_expected_from THEN
    RETURN jsonb_build_object('success', false, 'error', 'CONFLICT',
      'message', 'Challenge state changed concurrently', 'current_status', v_from_status);
  END IF;

  UPDATE public.match_challenges
     SET status            = v_to_status,
         outcome_code      = COALESCE(v_outcome_code, outcome_code),
         outcome_summary   = COALESCE(v_outcome_summary, outcome_summary),
         closed_by_user_id = COALESCE(v_closed_by, closed_by_user_id)
   WHERE id = v_challenge_id
     AND status = v_expected_from;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'CONFLICT',
      'message', 'Challenge update lost race');
  END IF;

  IF v_terminal AND p_governance IS NOT NULL THEN
    v_event_type := CASE WHEN v_to_status = 'withdrawn' THEN 'dispute.released' ELSE 'dispute.closed' END;
    v_gov_input := p_governance
      || jsonb_build_object(
        'org_id',         v_org_id::text,
        'aggregate_type', COALESCE(p_governance->>'aggregate_type','match_challenge'),
        'aggregate_id',   COALESCE(p_governance->>'aggregate_id', v_challenge_id::text),
        'event_type',     COALESCE(p_governance->>'event_type', v_event_type),
        'match_id',       v_match_id::text,
        'previous_state', COALESCE(p_governance->>'previous_state', v_from_status),
        'new_state',      COALESCE(p_governance->>'new_state', v_to_status)
      );
    v_governance_event_id := public.gov_emit_event(v_gov_input);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'challenge_id', v_challenge_id,
    'match_id', v_match_id,
    'previous_state', v_from_status,
    'new_state', v_to_status,
    'terminal', v_terminal,
    'governance_event_id', v_governance_event_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_dispute_transition(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_dispute_transition(jsonb, jsonb) TO service_role;


-- ── atomic_legal_hold_apply ────────────────────────────────────────────────
-- Inserts a legal_holds row (idempotent on active scope) and emits
-- legal_hold.applied in the same transaction.
--
-- p_input jsonb keys:
--   scope_type, scope_id, reason, applied_by, metadata (object),
--   gov_org_id (uuid; used for event_store org_id since legal_holds has none).
CREATE OR REPLACE FUNCTION public.atomic_legal_hold_apply(
  p_input jsonb,
  p_governance jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_scope_type text := p_input->>'scope_type';
  v_scope_id uuid := NULLIF(p_input->>'scope_id','')::uuid;
  v_reason text := p_input->>'reason';
  v_applied_by uuid := NULLIF(p_input->>'applied_by','')::uuid;
  v_metadata jsonb := COALESCE(p_input->'metadata','{}'::jsonb);
  v_gov_org_id uuid := NULLIF(p_input->>'gov_org_id','')::uuid;
  v_existing_id uuid;
  v_existing_applied_at timestamptz;
  v_legal_hold_id uuid;
  v_applied_at timestamptz;
  v_gov_input jsonb;
  v_governance_event_id uuid;
BEGIN
  IF v_scope_type IS NULL OR v_scope_id IS NULL OR v_reason IS NULL OR v_applied_by IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT',
      'message', 'scope_type, scope_id, reason, applied_by required');
  END IF;

  -- Idempotent: an active hold for this scope wins.
  SELECT id, applied_at INTO v_existing_id, v_existing_applied_at
    FROM public.legal_holds
   WHERE scope_type = v_scope_type AND scope_id = v_scope_id AND status = 'active'
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'LEGAL_HOLD_ALREADY_ACTIVE',
      'existing_hold_id', v_existing_id,
      'applied_at', v_existing_applied_at
    );
  END IF;

  INSERT INTO public.legal_holds (scope_type, scope_id, reason, status, applied_by, metadata)
  VALUES (v_scope_type, v_scope_id, v_reason, 'active', v_applied_by, v_metadata)
  RETURNING id, applied_at INTO v_legal_hold_id, v_applied_at;

  IF p_governance IS NOT NULL THEN
    v_gov_input := p_governance
      || jsonb_build_object(
        'org_id',         COALESCE(v_gov_org_id, v_scope_id)::text,
        'aggregate_type', COALESCE(p_governance->>'aggregate_type','legal_hold'),
        'aggregate_id',   COALESCE(p_governance->>'aggregate_id', v_legal_hold_id::text),
        'event_type',     COALESCE(p_governance->>'event_type','legal_hold.applied'),
        'new_state',      COALESCE(p_governance->>'new_state','active')
      );
    v_governance_event_id := public.gov_emit_event(v_gov_input);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'legal_hold_id', v_legal_hold_id,
    'applied_at', v_applied_at,
    'governance_event_id', v_governance_event_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_legal_hold_apply(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_legal_hold_apply(jsonb, jsonb) TO service_role;


-- ── atomic_legal_hold_release ──────────────────────────────────────────────
-- Releases a legal hold (status: active -> released) under optimistic
-- concurrency and emits legal_hold.released in the same transaction.
--
-- p_input jsonb keys:
--   legal_hold_id, released_by, released_reason, gov_org_id (nullable)
CREATE OR REPLACE FUNCTION public.atomic_legal_hold_release(
  p_input jsonb,
  p_governance jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_legal_hold_id uuid := NULLIF(p_input->>'legal_hold_id','')::uuid;
  v_released_by uuid := NULLIF(p_input->>'released_by','')::uuid;
  v_released_reason text := p_input->>'released_reason';
  v_gov_org_id uuid := NULLIF(p_input->>'gov_org_id','')::uuid;
  v_scope_type text;
  v_scope_id uuid;
  v_current_status text;
  v_released_at timestamptz := now();
  v_gov_input jsonb;
  v_governance_event_id uuid;
BEGIN
  IF v_legal_hold_id IS NULL OR v_released_by IS NULL OR v_released_reason IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT',
      'message', 'legal_hold_id, released_by, released_reason required');
  END IF;

  SELECT status, scope_type, scope_id
    INTO v_current_status, v_scope_type, v_scope_id
    FROM public.legal_holds
   WHERE id = v_legal_hold_id
   FOR UPDATE;

  IF v_current_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_current_status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'LEGAL_HOLD_NOT_ACTIVE',
      'current_status', v_current_status);
  END IF;

  UPDATE public.legal_holds
     SET status = 'released',
         released_by = v_released_by,
         released_at = v_released_at,
         released_reason = v_released_reason
   WHERE id = v_legal_hold_id AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'CONFLICT',
      'message', 'Legal hold release lost race');
  END IF;

  IF p_governance IS NOT NULL THEN
    v_gov_input := p_governance
      || jsonb_build_object(
        'org_id',         COALESCE(v_gov_org_id, v_scope_id)::text,
        'aggregate_type', COALESCE(p_governance->>'aggregate_type','legal_hold'),
        'aggregate_id',   COALESCE(p_governance->>'aggregate_id', v_legal_hold_id::text),
        'event_type',     COALESCE(p_governance->>'event_type','legal_hold.released'),
        'previous_state', COALESCE(p_governance->>'previous_state','active'),
        'new_state',      COALESCE(p_governance->>'new_state','released')
      );
    v_governance_event_id := public.gov_emit_event(v_gov_input);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'legal_hold_id', v_legal_hold_id,
    'released_at', v_released_at,
    'scope_type', v_scope_type,
    'scope_id', v_scope_id,
    'governance_event_id', v_governance_event_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_legal_hold_release(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_legal_hold_release(jsonb, jsonb) TO service_role;