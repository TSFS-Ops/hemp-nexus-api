-- Batch O Phase 2b Step 4 — admin_repair_legacy_match RPC
--
-- Server-side, SECURITY DEFINER, service-role only. Companion to the
-- Step 3 archive RPC: instead of holding an inconsistent legacy match,
-- this RPC applies a *bounded* deterministic repair patch from a fixed
-- allow-list, then writes a single `match.legacy_state_repaired` audit
-- row capturing the before/after snapshots.
--
-- Allow-list of operations (no other operation strings are accepted):
--   1. `clear_stale_settled_at`
--        target reason: settled_at_without_settled_status
--        patch:        UPDATE matches SET settled_at = NULL
--        post-check:   row must no longer be inconsistent.
--   2. `restore_poi_state_for_completed`
--        target reason: completed_state_with_open_poi
--        patch:        UPDATE matches SET poi_state = 'COMPLETED'
--                      (ONLY when state = 'completed')
--        post-check:   row must no longer be inconsistent.
--   3. `clear_legacy_repair_marker`
--        target reason: legacy_repair_required OR state_reconciliation_required
--        patch:        remove those two keys from metadata jsonb
--        post-check:   row must no longer be inconsistent.
--
-- DEFERRED operation (intentionally not implemented):
--   • `force_terminal_for_orphan_settled` — addressing
--     settled_with_draft_poi requires deciding whether the settlement was
--     genuine (the DRAFT POI is the orphan and should be discarded) or
--     premature (the status is the orphan and should be cleared). That
--     decision crosses POI/credit semantics. Until business sign-off
--     names the safe patch, the RPC rejects this operation with
--     `operation_deferred`.
--
-- Safety:
--   * Per-match advisory transaction lock prevents concurrent races with
--     archive and other repairs.
--   * Conservative SQL-side inconsistency predicate identical to the
--     archive RPC (and a subset of the TS predicate).
--   * Operation-to-reason matching: an operation is rejected if the
--     reason it targets is not currently present.
--   * Idempotency: re-running the same operation when the patch is
--     already a no-op short-circuits and does NOT write a duplicate
--     audit row.
--   * No POI / WaD / payment / credit / token / rating / notification
--     table is touched. Only public.matches and public.audit_logs.

CREATE OR REPLACE FUNCTION public.admin_repair_legacy_match(
  p_match_id uuid,
  p_admin_user_id uuid,
  p_operation text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match            public.matches%ROWTYPE;
  v_after            public.matches%ROWTYPE;
  v_notes            text;
  v_operation        text;
  v_is_admin         boolean;
  v_inconsistent     boolean;
  v_post_inconsistent boolean;
  v_reason_present   boolean;
  v_no_op            boolean := false;
  v_new_metadata     jsonb;
  v_repaired_at      timestamptz := now();
  v_terminal_poi     text[] := ARRAY[
    'EXPIRED','REJECTED','ANNULLED','CANCELLED','COMPLETED','SETTLED'
  ];
  v_terminal_status  text[] := ARRAY['completed','cancelled','annulled'];
  v_allowed          text[] := ARRAY[
    'clear_stale_settled_at',
    'restore_poi_state_for_completed',
    'clear_legacy_repair_marker',
    'force_terminal_for_orphan_settled' -- accepted only to return DEFERRED
  ];
BEGIN
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match_id required' USING ERRCODE = '22023';
  END IF;
  IF p_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_user_id required' USING ERRCODE = '22023';
  END IF;

  v_operation := btrim(coalesce(p_operation, ''));
  IF v_operation = '' THEN
    RAISE EXCEPTION 'operation_required' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_operation = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'operation_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_operation = 'force_terminal_for_orphan_settled' THEN
    RAISE EXCEPTION 'operation_deferred' USING ERRCODE = '22023';
  END IF;

  v_notes := btrim(coalesce(p_notes, ''));
  IF char_length(v_notes) < 10 THEN
    RAISE EXCEPTION 'notes_too_short' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_notes) > 2000 THEN
    RAISE EXCEPTION 'notes_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT public.is_admin(p_admin_user_id) INTO v_is_admin;
  IF NOT coalesce(v_is_admin, false) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('match_legacy_repair:' || p_match_id::text, 0)
  );

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Pre-check: row must currently be inconsistent.
  v_inconsistent := (
    coalesce((v_match.metadata ->> 'legacy_repair_required')::boolean, false)
    OR coalesce((v_match.metadata ->> 'state_reconciliation_required')::boolean, false)
    OR (v_match.status = 'settled' AND v_match.poi_state = 'DRAFT')
    OR (
      v_match.state = 'completed'
      AND v_match.poi_state IS NOT NULL
      AND v_match.poi_state <> ''
      AND v_match.poi_state <> 'ISSUED'
      AND NOT (v_match.poi_state = ANY (v_terminal_poi))
    )
    OR (
      v_match.settled_at IS NOT NULL
      AND v_match.status <> 'settled'
      AND NOT (v_match.status = ANY (v_terminal_status))
    )
    OR (
      v_match.buyer_committed_at IS NOT NULL
      AND v_match.seller_committed_at IS NOT NULL
      AND v_match.state = 'discovery'
    )
    OR (
      v_match.buyer_org_id IS NOT NULL
      AND v_match.seller_org_id IS NOT NULL
      AND v_match.buyer_org_id = v_match.seller_org_id
    )
  );

  -- Operation-to-reason gate + idempotency no-op detection.
  IF v_operation = 'clear_stale_settled_at' THEN
    v_reason_present := (
      v_match.settled_at IS NOT NULL
      AND v_match.status <> 'settled'
      AND NOT (v_match.status = ANY (v_terminal_status))
    );
    v_no_op := (v_match.settled_at IS NULL);
  ELSIF v_operation = 'restore_poi_state_for_completed' THEN
    v_reason_present := (
      v_match.state = 'completed'
      AND v_match.poi_state IS NOT NULL
      AND v_match.poi_state <> ''
      AND v_match.poi_state <> 'ISSUED'
      AND NOT (v_match.poi_state = ANY (v_terminal_poi))
    );
    -- No-op when already COMPLETED on a completed-state row.
    v_no_op := (v_match.state = 'completed' AND v_match.poi_state = 'COMPLETED');
  ELSIF v_operation = 'clear_legacy_repair_marker' THEN
    v_reason_present := (
      coalesce((v_match.metadata ->> 'legacy_repair_required')::boolean, false)
      OR coalesce((v_match.metadata ->> 'state_reconciliation_required')::boolean, false)
    );
    v_no_op := NOT v_reason_present;
  END IF;

  -- Idempotent short-circuit: same operation already applied.
  IF v_no_op THEN
    RETURN jsonb_build_object(
      'match_id', v_match.id,
      'operation', v_operation,
      'idempotent', true,
      'no_op', true
    );
  END IF;

  -- Now real work — require inconsistency and reason match.
  IF NOT v_inconsistent THEN
    RAISE EXCEPTION 'not_inconsistent' USING ERRCODE = '23514';
  END IF;
  IF NOT v_reason_present THEN
    RAISE EXCEPTION 'operation_not_applicable' USING ERRCODE = '23514';
  END IF;

  -- Apply the deterministic patch for the chosen operation.
  IF v_operation = 'clear_stale_settled_at' THEN
    UPDATE public.matches
       SET settled_at = NULL
     WHERE id = p_match_id;
  ELSIF v_operation = 'restore_poi_state_for_completed' THEN
    -- Defensive guard at write-time: only when state='completed'.
    IF v_match.state <> 'completed' THEN
      RAISE EXCEPTION 'operation_not_applicable' USING ERRCODE = '23514';
    END IF;
    UPDATE public.matches
       SET poi_state = 'COMPLETED'
     WHERE id = p_match_id
       AND state = 'completed';
  ELSIF v_operation = 'clear_legacy_repair_marker' THEN
    v_new_metadata := coalesce(v_match.metadata, '{}'::jsonb)
      - 'legacy_repair_required'
      - 'state_reconciliation_required';
    UPDATE public.matches
       SET metadata = v_new_metadata
     WHERE id = p_match_id;
  END IF;

  -- Reload the row and re-run the inconsistency predicate.
  SELECT * INTO v_after FROM public.matches WHERE id = p_match_id;

  v_post_inconsistent := (
    coalesce((v_after.metadata ->> 'legacy_repair_required')::boolean, false)
    OR coalesce((v_after.metadata ->> 'state_reconciliation_required')::boolean, false)
    OR (v_after.status = 'settled' AND v_after.poi_state = 'DRAFT')
    OR (
      v_after.state = 'completed'
      AND v_after.poi_state IS NOT NULL
      AND v_after.poi_state <> ''
      AND v_after.poi_state <> 'ISSUED'
      AND NOT (v_after.poi_state = ANY (v_terminal_poi))
    )
    OR (
      v_after.settled_at IS NOT NULL
      AND v_after.status <> 'settled'
      AND NOT (v_after.status = ANY (v_terminal_status))
    )
    OR (
      v_after.buyer_committed_at IS NOT NULL
      AND v_after.seller_committed_at IS NOT NULL
      AND v_after.state = 'discovery'
    )
    OR (
      v_after.buyer_org_id IS NOT NULL
      AND v_after.seller_org_id IS NOT NULL
      AND v_after.buyer_org_id = v_after.seller_org_id
    )
  );

  -- Post-check: none of the implemented operations are partial holds, so
  -- the row must no longer be inconsistent. If something else is wrong
  -- (multi-reason row), abort and surface a controlled error so the
  -- admin can choose the next operation.
  IF v_post_inconsistent THEN
    RAISE EXCEPTION 'still_inconsistent_after_repair' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.audit_logs (
    org_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    v_match.org_id,
    p_admin_user_id,
    'match.legacy_state_repaired',
    'match',
    p_match_id,
    jsonb_build_object(
      'operation', v_operation,
      'notes', v_notes,
      'repaired_at', v_repaired_at,
      'before', jsonb_build_object(
        'state', v_match.state,
        'status', v_match.status,
        'poi_state', v_match.poi_state,
        'settled_at', v_match.settled_at,
        'metadata', v_match.metadata
      ),
      'after', jsonb_build_object(
        'state', v_after.state,
        'status', v_after.status,
        'poi_state', v_after.poi_state,
        'settled_at', v_after.settled_at,
        'metadata', v_after.metadata
      )
    )
  );

  RETURN jsonb_build_object(
    'match_id', v_match.id,
    'operation', v_operation,
    'repaired_at', v_repaired_at,
    'idempotent', false,
    'no_op', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_repair_legacy_match(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_repair_legacy_match(uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_repair_legacy_match(uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_repair_legacy_match(uuid, uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.admin_repair_legacy_match(uuid, uuid, text, text) IS
  'Batch O Phase 2b Step 4 — admin-only bounded repair of an inconsistent legacy match. Allow-list of operations: clear_stale_settled_at, restore_poi_state_for_completed, clear_legacy_repair_marker. force_terminal_for_orphan_settled is explicitly deferred. Writes a single match.legacy_state_repaired audit row with before/after snapshots. Service-role only.';