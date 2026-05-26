-- Batch F8 atomicity proof — admin-legal-hold (atomic_legal_hold_apply / release).
--
-- Live-DB proof that the legal-hold business mutation and the canonical
-- Governance Record event live inside the same PostgreSQL transaction.
--
-- Sections:
--   F8-A  Apply happy path: insert + 1 canonical legal_hold.applied event.
--   F8-B  Apply idempotency: duplicate active scope returns LEGAL_HOLD_ALREADY_ACTIVE
--         and writes NO additional legal_holds row and NO additional event.
--   F8-C  Apply rollback: forced gov_emit_event failure leaves NO legal_holds row
--         and NO event_store row.
--   F8-D  Release happy path: status → released + 1 canonical legal_hold.released.
--   F8-E  Release rollback: forced gov_emit_event failure leaves hold ACTIVE and
--         emits NO legal_hold.released event.
--   F8-F  Mutation failure: releasing a missing/non-active hold emits NO event.
--
-- Everything runs inside BEGIN; ... ROLLBACK; so no residue remains.

BEGIN;

DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_scope_id uuid := gen_random_uuid();
  v_scope_id_b uuid := gen_random_uuid();
  v_request_id text := 'f8-req-' || gen_random_uuid()::text;
  v_apply_1 jsonb;
  v_apply_2 jsonb;
  v_release_1 jsonb;
  v_release_missing jsonb;
  v_legal_hold_id uuid;
  v_legal_hold_id_b uuid;
  v_holds_count int;
  v_event_count int;
  v_status text;
  v_caught boolean;
BEGIN
  -- Org row required because event_store.org_id FKs organizations(id).
  INSERT INTO public.organizations (id, name, is_demo)
  VALUES (v_org, 'F8 proof org', false)
  ON CONFLICT (id) DO NOTHING;

  ----------------------------------------------------------------
  -- F8-A — Apply happy path
  ----------------------------------------------------------------
  v_apply_1 := public.atomic_legal_hold_apply(
    p_input => jsonb_build_object(
      'scope_type', 'org',
      'scope_id', v_scope_id,
      'reason', 'batch f8 proof apply happy path',
      'applied_by', v_actor,
      'gov_org_id', v_org,
      'metadata', jsonb_build_object('source','f8-proof')
    ),
    p_governance => jsonb_build_object(
      'actor_user_id', v_actor,
      'actor_role', 'platform_admin',
      'source_function', 'admin-legal-hold',
      'request_id', v_request_id,
      'allowed_or_blocked', 'allowed',
      'posture_snapshot', jsonb_build_object('verification_posture','Standard'),
      'metadata', jsonb_build_object('proof','f8-A'),
      'idempotency_key', 'f8-A|' || v_request_id
    )
  );
  ASSERT (v_apply_1->>'success')::boolean IS TRUE,
    format('F8-A: apply must succeed, got %s', v_apply_1::text);
  ASSERT v_apply_1->>'governance_event_id' IS NOT NULL,
    'F8-A: governance_event_id must be present';
  v_legal_hold_id := (v_apply_1->>'legal_hold_id')::uuid;

  SELECT count(*) INTO v_holds_count
  FROM public.legal_holds
  WHERE id = v_legal_hold_id AND status = 'active';
  ASSERT v_holds_count = 1, 'F8-A: exactly one active legal_holds row expected';

  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE aggregate_id = v_legal_hold_id
    AND aggregate_type = 'legal_hold'
    AND event_type = 'legal_hold.applied';
  ASSERT v_event_count = 1,
    format('F8-A: expected 1 legal_hold.applied event, got %s', v_event_count);

  ----------------------------------------------------------------
  -- F8-B — Apply idempotency: second apply on same active scope
  ----------------------------------------------------------------
  v_apply_2 := public.atomic_legal_hold_apply(
    p_input => jsonb_build_object(
      'scope_type', 'org',
      'scope_id', v_scope_id,
      'reason', 'batch f8 proof apply duplicate',
      'applied_by', v_actor,
      'gov_org_id', v_org
    ),
    p_governance => jsonb_build_object(
      'actor_user_id', v_actor,
      'source_function', 'admin-legal-hold',
      'posture_snapshot', jsonb_build_object('verification_posture','Standard'),
      'idempotency_key', 'f8-B|' || v_request_id
    )
  );
  ASSERT (v_apply_2->>'success')::boolean IS FALSE,
    'F8-B: duplicate apply must not succeed';
  ASSERT v_apply_2->>'error' = 'LEGAL_HOLD_ALREADY_ACTIVE',
    format('F8-B: expected LEGAL_HOLD_ALREADY_ACTIVE, got %s', v_apply_2->>'error');

  SELECT count(*) INTO v_holds_count
  FROM public.legal_holds
  WHERE scope_type = 'org' AND scope_id = v_scope_id;
  ASSERT v_holds_count = 1,
    format('F8-B: only one legal_holds row expected for scope, got %s', v_holds_count);

  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE aggregate_id = v_legal_hold_id
    AND event_type = 'legal_hold.applied';
  ASSERT v_event_count = 1,
    format('F8-B: duplicate apply must not insert second event, got %s', v_event_count);

  ----------------------------------------------------------------
  -- F8-C — Apply rollback: forced gov_emit_event failure
  -- We omit source_function from p_governance so gov_emit_event RAISES
  -- 'GOV_AUDIT_INVALID: source_function required' AFTER the legal_holds INSERT.
  -- The RPC has no EXCEPTION handler, so the INSERT must be undone.
  ----------------------------------------------------------------
  v_caught := false;
  BEGIN
    PERFORM public.atomic_legal_hold_apply(
      p_input => jsonb_build_object(
        'scope_type', 'match',
        'scope_id', v_scope_id_b,
        'reason', 'batch f8 proof apply rollback path',
        'applied_by', v_actor,
        'gov_org_id', v_org
      ),
      p_governance => jsonb_build_object(
        'actor_user_id', v_actor,
        -- source_function intentionally omitted to force gov_emit_event to RAISE
        'posture_snapshot', jsonb_build_object('verification_posture','Standard'),
        'idempotency_key', 'f8-C|' || v_request_id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  ASSERT v_caught IS TRUE, 'F8-C: forced governance failure must raise';

  SELECT count(*) INTO v_holds_count
  FROM public.legal_holds
  WHERE scope_type = 'match' AND scope_id = v_scope_id_b;
  ASSERT v_holds_count = 0,
    format('F8-C: legal_holds row must NOT persist after rollback, got %s', v_holds_count);

  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE aggregate_type = 'legal_hold'
    AND event_type = 'legal_hold.applied'
    AND payload->>'idempotency_key' = 'f8-C|' || v_request_id;
  ASSERT v_event_count = 0,
    format('F8-C: no event_store row must persist after rollback, got %s', v_event_count);

  ----------------------------------------------------------------
  -- F8-D — Release happy path
  ----------------------------------------------------------------
  v_release_1 := public.atomic_legal_hold_release(
    p_input => jsonb_build_object(
      'legal_hold_id', v_legal_hold_id,
      'released_by', v_actor,
      'released_reason', 'batch f8 proof release happy path',
      'gov_org_id', v_org
    ),
    p_governance => jsonb_build_object(
      'actor_user_id', v_actor,
      'actor_role', 'platform_admin',
      'source_function', 'admin-legal-hold',
      'request_id', v_request_id,
      'allowed_or_blocked', 'allowed',
      'posture_snapshot', jsonb_build_object('verification_posture','Standard'),
      'metadata', jsonb_build_object('proof','f8-D'),
      'idempotency_key', 'f8-D|' || v_request_id
    )
  );
  ASSERT (v_release_1->>'success')::boolean IS TRUE,
    format('F8-D: release must succeed, got %s', v_release_1::text);
  ASSERT v_release_1->>'governance_event_id' IS NOT NULL,
    'F8-D: governance_event_id must be present';

  SELECT status INTO v_status FROM public.legal_holds WHERE id = v_legal_hold_id;
  ASSERT v_status = 'released',
    format('F8-D: hold must be released, got %s', v_status);

  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE aggregate_id = v_legal_hold_id
    AND event_type = 'legal_hold.released';
  ASSERT v_event_count = 1,
    format('F8-D: expected exactly 1 legal_hold.released event, got %s', v_event_count);

  ----------------------------------------------------------------
  -- F8-E — Release rollback: forced gov_emit_event failure on release.
  -- Seed a fresh hold then attempt release with malformed p_governance so
  -- gov_emit_event RAISES after the UPDATE. Status must remain 'active'
  -- and no legal_hold.released event must persist.
  ----------------------------------------------------------------
  INSERT INTO public.legal_holds (scope_type, scope_id, reason, status, applied_by, metadata)
  VALUES ('payment', gen_random_uuid(), 'batch f8 proof release rollback seed', 'active', v_actor, '{}'::jsonb)
  RETURNING id INTO v_legal_hold_id_b;

  v_caught := false;
  BEGIN
    PERFORM public.atomic_legal_hold_release(
      p_input => jsonb_build_object(
        'legal_hold_id', v_legal_hold_id_b,
        'released_by', v_actor,
        'released_reason', 'batch f8 proof release rollback path',
        'gov_org_id', v_org
      ),
      p_governance => jsonb_build_object(
        'actor_user_id', v_actor,
        -- source_function intentionally omitted to force gov_emit_event to RAISE
        'posture_snapshot', jsonb_build_object('verification_posture','Standard'),
        'idempotency_key', 'f8-E|' || v_request_id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  ASSERT v_caught IS TRUE, 'F8-E: forced governance failure on release must raise';

  SELECT status INTO v_status FROM public.legal_holds WHERE id = v_legal_hold_id_b;
  ASSERT v_status = 'active',
    format('F8-E: hold status must remain active after rollback, got %s', v_status);

  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE aggregate_id = v_legal_hold_id_b
    AND event_type = 'legal_hold.released';
  ASSERT v_event_count = 0,
    format('F8-E: no legal_hold.released event must persist, got %s', v_event_count);

  ----------------------------------------------------------------
  -- F8-F — Mutation failure: release of non-existent hold emits no event.
  ----------------------------------------------------------------
  v_release_missing := public.atomic_legal_hold_release(
    p_input => jsonb_build_object(
      'legal_hold_id', gen_random_uuid(),
      'released_by', v_actor,
      'released_reason', 'batch f8 proof release missing target'
    ),
    p_governance => jsonb_build_object(
      'actor_user_id', v_actor,
      'source_function', 'admin-legal-hold',
      'posture_snapshot', jsonb_build_object('verification_posture','Standard'),
      'idempotency_key', 'f8-F|' || v_request_id
    )
  );
  ASSERT (v_release_missing->>'success')::boolean IS FALSE,
    'F8-F: release of missing hold must not succeed';
  ASSERT v_release_missing->>'error' = 'NOT_FOUND',
    format('F8-F: expected NOT_FOUND, got %s', v_release_missing->>'error');

  SELECT count(*) INTO v_event_count
  FROM public.event_store
  WHERE event_type = 'legal_hold.released'
    AND payload->>'idempotency_key' = 'f8-F|' || v_request_id;
  ASSERT v_event_count = 0,
    format('F8-F: failed mutation must not emit a release event, got %s', v_event_count);

  RAISE NOTICE 'Batch F8 atomic legal-hold proof: ALL ASSERTIONS PASSED';
END
$$;

ROLLBACK;
