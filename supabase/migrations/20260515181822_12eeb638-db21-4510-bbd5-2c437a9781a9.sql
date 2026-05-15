-- Batch O Phase 2b Step 3 — admin_archive_legacy_match RPC
--
-- Server-side, SECURITY DEFINER. Marks an inconsistent legacy match as
-- archived/held via a metadata marker and writes a single
-- `match.legacy_state_archived` audit row. Service-role only — invoked
-- exclusively by the `admin-match-legacy-archive` edge function.
--
-- Safety:
--   * Per-match advisory transaction lock prevents concurrent archive races.
--   * Conservative SQL-side inconsistency predicate, aligned with the
--     `inconsistencyReasons()` TS function (subset, biased to NOT flag).
--   * Idempotent: re-invocation on an already-archived row returns the
--     existing archive metadata without re-writing.
--   * No POI / WaD / payment / credit / notification table is touched.

CREATE OR REPLACE FUNCTION public.admin_archive_legacy_match(
  p_match_id uuid,
  p_admin_user_id uuid,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match           public.matches%ROWTYPE;
  v_notes           text;
  v_is_admin        boolean;
  v_inconsistent    boolean;
  v_already         boolean;
  v_new_metadata    jsonb;
  v_archived_at     timestamptz := now();
  v_terminal_poi    text[] := ARRAY[
    'EXPIRED','REJECTED','ANNULLED','CANCELLED','COMPLETED','SETTLED'
  ];
  v_terminal_status text[] := ARRAY['completed','cancelled','annulled'];
BEGIN
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match_id required' USING ERRCODE = '22023';
  END IF;
  IF p_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_user_id required' USING ERRCODE = '22023';
  END IF;

  -- Notes: trimmed length 10..2000.
  v_notes := btrim(coalesce(p_notes, ''));
  IF char_length(v_notes) < 10 THEN
    RAISE EXCEPTION 'notes_too_short' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_notes) > 2000 THEN
    RAISE EXCEPTION 'notes_too_long' USING ERRCODE = '22023';
  END IF;

  -- Admin gate (defence in depth — edge function also checks).
  SELECT public.is_admin(p_admin_user_id) INTO v_is_admin;
  IF NOT coalesce(v_is_admin, false) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;

  -- Per-match advisory lock for the duration of this transaction.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('match_legacy_archive:' || p_match_id::text, 0)
  );

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency: already archived under this marker → return existing.
  v_already := coalesce(
    (v_match.metadata ->> 'legacy_archived_admin_hold')::boolean,
    false
  );
  IF v_already THEN
    RETURN jsonb_build_object(
      'match_id', v_match.id,
      'marker', 'legacy_archived_admin_hold',
      'archived_at', v_match.metadata ->> 'legacy_archived_at',
      'idempotent', true
    );
  END IF;

  -- Conservative inconsistency check (mirrors a subset of the TS predicate).
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

  IF NOT v_inconsistent THEN
    RAISE EXCEPTION 'not_inconsistent' USING ERRCODE = '23514';
  END IF;

  v_new_metadata := coalesce(v_match.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'legacy_archived_admin_hold', true,
      'legacy_archived_at', to_jsonb(v_archived_at),
      'legacy_archived_by', to_jsonb(p_admin_user_id),
      'legacy_archive_notes', to_jsonb(v_notes)
    );

  UPDATE public.matches
     SET metadata = v_new_metadata
   WHERE id = p_match_id;

  INSERT INTO public.audit_logs (
    org_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    v_match.org_id,
    p_admin_user_id,
    'match.legacy_state_archived',
    'match',
    p_match_id,
    jsonb_build_object(
      'notes', v_notes,
      'archived_at', v_archived_at,
      'marker', 'legacy_archived_admin_hold',
      'before', jsonb_build_object(
        'state', v_match.state,
        'status', v_match.status,
        'poi_state', v_match.poi_state,
        'metadata', v_match.metadata
      ),
      'after_metadata', v_new_metadata
    )
  );

  RETURN jsonb_build_object(
    'match_id', v_match.id,
    'marker', 'legacy_archived_admin_hold',
    'archived_at', v_archived_at,
    'idempotent', false
  );
END;
$$;

-- Lock down execution to service_role only. Edge function uses the service
-- role key; clients (anon / authenticated) cannot call this RPC directly.
REVOKE ALL ON FUNCTION public.admin_archive_legacy_match(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_archive_legacy_match(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_archive_legacy_match(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_archive_legacy_match(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.admin_archive_legacy_match(uuid, uuid, text) IS
  'Batch O Phase 2b Step 3 — admin-only archive of an inconsistent legacy match. Marks metadata.legacy_archived_admin_hold=true and writes a match.legacy_state_archived audit row. Service-role only.';