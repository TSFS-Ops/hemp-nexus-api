-- Batch K Fix 2: Block restore_poi_state_for_completed when no sealed WaD exists.
-- The repair operation must not create the very drift the new detector flags.

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
  v_has_sealed_wad   boolean;
  v_terminal_poi     text[] := ARRAY[
    'EXPIRED','REJECTED','ANNULLED','CANCELLED','COMPLETED','SETTLED'
  ];
  v_terminal_status  text[] := ARRAY['completed','cancelled','annulled'];
  v_allowed          text[] := ARRAY[
    'clear_stale_settled_at',
    'restore_poi_state_for_completed',
    'clear_legacy_repair_marker',
    'force_terminal_for_orphan_settled'
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
    v_no_op := (v_match.state = 'completed' AND v_match.poi_state = 'COMPLETED');
  ELSIF v_operation = 'clear_legacy_repair_marker' THEN
    v_reason_present := (
      coalesce((v_match.metadata ->> 'legacy_repair_required')::boolean, false)
      OR coalesce((v_match.metadata ->> 'state_reconciliation_required')::boolean, false)
    );
    v_no_op := NOT v_reason_present;
  END IF;

  IF v_no_op THEN
    RETURN jsonb_build_object(
      'match_id', v_match.id,
      'operation', v_operation,
      'idempotent', true,
      'no_op', true
    );
  END IF;

  IF NOT v_inconsistent THEN
    RAISE EXCEPTION 'not_inconsistent' USING ERRCODE = '23514';
  END IF;
  IF NOT v_reason_present THEN
    RAISE EXCEPTION 'operation_not_applicable' USING ERRCODE = '23514';
  END IF;

  -- Batch K Fix 2: For restore_poi_state_for_completed, require a sealed WaD.
  -- Without one, this would set poi_state='COMPLETED' on a match that has no
  -- proof of settlement — the exact MATCH-008 drift we are trying to detect.
  IF v_operation = 'restore_poi_state_for_completed' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.wads w
      WHERE w.poi_id = p_match_id
        AND w.sealed_at IS NOT NULL
        AND w.status = 'sealed'
    ) INTO v_has_sealed_wad;
    IF NOT v_has_sealed_wad THEN
      RAISE EXCEPTION 'completed_without_sealed_wad' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_operation = 'clear_stale_settled_at' THEN
    UPDATE public.matches
       SET settled_at = NULL
     WHERE id = p_match_id;
  ELSIF v_operation = 'restore_poi_state_for_completed' THEN
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