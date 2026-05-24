-- MT-012 — Trade Request Archive while child matches active.
-- Metadata-flag-first; trade_requests.status enum unchanged.

ALTER TABLE public.trade_requests
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_mode TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_requests_archive_mode_check'
  ) THEN
    ALTER TABLE public.trade_requests
      ADD CONSTRAINT trade_requests_archive_mode_check
      CHECK (archive_mode IS NULL OR archive_mode IN ('normal','admin_override_active_children'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trade_requests_archived_at
  ON public.trade_requests(archived_at) WHERE archived_at IS NOT NULL;

-- ----------------------------------------------------------------------
-- 1) Normal archive RPC
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_trade_request(
  p_trade_request_id UUID,
  p_actor_user_id    UUID,
  p_actor_org_id     UUID,
  p_reason           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tr   public.trade_requests%ROWTYPE;
  v_blocking JSONB;
  v_count INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('trade_request:' || p_trade_request_id::text));

  SELECT * INTO v_tr FROM public.trade_requests WHERE id = p_trade_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_tr.org_id <> p_actor_org_id THEN
    RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = '42501';
  END IF;

  IF v_tr.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_ARCHIVED' USING ERRCODE = '22023';
  END IF;

  -- Compute non-terminal, non-exception-held children.
  SELECT jsonb_agg(jsonb_build_object(
           'match_id', m.id,
           'status',   m.status,
           'state',    m.state,
           'poi_state', m.poi_state
         )),
         COUNT(*)
    INTO v_blocking, v_count
  FROM public.matches m
  WHERE m.trade_request_id = p_trade_request_id
    AND COALESCE((m.metadata ->> 'parent_archived_admin_exception_hold')::boolean, false) = false
    AND COALESCE((m.metadata ->> 'legacy_archived_admin_hold')::boolean, false) = false
    AND COALESCE(m.status, '') NOT IN ('completed','cancelled','annulled')
    AND COALESCE(m.state,  '') NOT IN ('completed','cancelled','annulled')
    AND COALESCE(m.poi_state, '') NOT IN ('EXPIRED','REJECTED','ANNULLED','CANCELLED','COMPLETED','SETTLED');

  IF v_count > 0 THEN
    INSERT INTO public.audit_logs(org_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_tr.org_id, p_actor_user_id,
      'trade_request.archive_blocked_active_child_matches',
      'trade_request', p_trade_request_id,
      jsonb_build_object(
        'trade_request_id', p_trade_request_id,
        'actor_user_id',    p_actor_user_id,
        'actor_org_id',     p_actor_org_id,
        'blocking_count',   v_count,
        'blocking_children', v_blocking,
        'reason',           p_reason
      )
    );
    RAISE EXCEPTION 'ACTIVE_CHILDREN_BLOCK' USING ERRCODE = '40001',
      DETAIL = v_blocking::text;
  END IF;

  UPDATE public.trade_requests
     SET archived_at    = now(),
         archived_by    = p_actor_user_id,
         archive_reason = p_reason,
         archive_mode   = 'normal',
         updated_at     = now()
   WHERE id = p_trade_request_id;

  INSERT INTO public.audit_logs(org_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_tr.org_id, p_actor_user_id,
    'trade_request.archived_normal',
    'trade_request', p_trade_request_id,
    jsonb_build_object(
      'trade_request_id', p_trade_request_id,
      'actor_user_id',    p_actor_user_id,
      'actor_org_id',     p_actor_org_id,
      'reason',           p_reason
    )
  );

  RETURN jsonb_build_object('archived', true, 'archive_mode', 'normal');
END;
$$;

REVOKE ALL ON FUNCTION public.archive_trade_request(UUID,UUID,UUID,TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.archive_trade_request(UUID,UUID,UUID,TEXT) TO service_role;

-- ----------------------------------------------------------------------
-- 2) Admin override RPC
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_archive_trade_request_override(
  p_trade_request_id UUID,
  p_admin_user_id    UUID,
  p_reason           TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tr public.trade_requests%ROWTYPE;
  v_ids UUID[];
  v_snapshot JSONB;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('trade_request:' || p_trade_request_id::text));

  SELECT * INTO v_tr FROM public.trade_requests WHERE id = p_trade_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_tr.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_ARCHIVED' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(m.id),
         jsonb_agg(jsonb_build_object(
           'match_id', m.id,
           'status',   m.status,
           'state',    m.state,
           'poi_state', m.poi_state
         ))
    INTO v_ids, v_snapshot
  FROM public.matches m
  WHERE m.trade_request_id = p_trade_request_id
    AND COALESCE((m.metadata ->> 'parent_archived_admin_exception_hold')::boolean, false) = false
    AND COALESCE((m.metadata ->> 'legacy_archived_admin_hold')::boolean, false) = false
    AND COALESCE(m.status, '') NOT IN ('completed','cancelled','annulled')
    AND COALESCE(m.state,  '') NOT IN ('completed','cancelled','annulled')
    AND COALESCE(m.poi_state, '') NOT IN ('EXPIRED','REJECTED','ANNULLED','CANCELLED','COMPLETED','SETTLED');

  UPDATE public.trade_requests
     SET archived_at    = now(),
         archived_by    = p_admin_user_id,
         archive_reason = p_reason,
         archive_mode   = 'admin_override_active_children',
         updated_at     = now()
   WHERE id = p_trade_request_id;

  IF v_ids IS NOT NULL THEN
    UPDATE public.matches m
       SET metadata = COALESCE(m.metadata, '{}'::jsonb) || jsonb_build_object(
             'parent_archived_admin_exception_hold',           true,
             'parent_archived_admin_exception_hold_at',        now(),
             'parent_archived_admin_exception_hold_reason',    p_reason,
             'parent_archived_admin_exception_hold_parent_id', p_trade_request_id,
             'parent_archived_admin_exception_hold_by',        p_admin_user_id
           )
     WHERE m.id = ANY(v_ids);
  END IF;

  INSERT INTO public.audit_logs(org_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_tr.org_id, p_admin_user_id,
    'trade_request.archived_admin_override_active_children',
    'trade_request', p_trade_request_id,
    jsonb_build_object(
      'trade_request_id',          p_trade_request_id,
      'actor_user_id',             p_admin_user_id,
      'reason',                    p_reason,
      'archived_child_match_ids',  COALESCE(to_jsonb(v_ids), '[]'::jsonb),
      'snapshot_states',           COALESCE(v_snapshot, '[]'::jsonb)
    )
  );

  RETURN jsonb_build_object(
    'archived', true,
    'archive_mode', 'admin_override_active_children',
    'exception_hold_child_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb),
    'count', COALESCE(array_length(v_ids,1), 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_archive_trade_request_override(UUID,UUID,TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_archive_trade_request_override(UUID,UUID,TEXT) TO service_role;

-- ----------------------------------------------------------------------
-- 3) Release exception hold (admin)
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_release_trade_request_exception_hold(
  p_trade_request_id UUID,
  p_admin_user_id    UUID,
  p_reason           TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tr public.trade_requests%ROWTYPE;
  v_released_ids UUID[];
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('trade_request:' || p_trade_request_id::text));

  SELECT * INTO v_tr FROM public.trade_requests WHERE id = p_trade_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT array_agg(m.id) INTO v_released_ids
  FROM public.matches m
  WHERE m.trade_request_id = p_trade_request_id
    AND COALESCE((m.metadata ->> 'parent_archived_admin_exception_hold')::boolean, false) = true
    AND COALESCE((m.metadata ->> 'parent_archived_admin_exception_hold_released_at') IS NOT NULL, false) = false;

  IF v_released_ids IS NULL OR array_length(v_released_ids,1) IS NULL THEN
    RAISE EXCEPTION 'NO_EXCEPTION_HOLD' USING ERRCODE = '22023';
  END IF;

  UPDATE public.matches m
     SET metadata = COALESCE(m.metadata, '{}'::jsonb) || jsonb_build_object(
           'parent_archived_admin_exception_hold',              false,
           'parent_archived_admin_exception_hold_released_at',  now(),
           'parent_archived_admin_exception_hold_release_reason', p_reason,
           'parent_archived_admin_exception_hold_released_by',  p_admin_user_id
         )
   WHERE m.id = ANY(v_released_ids);

  INSERT INTO public.audit_logs(org_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_tr.org_id, p_admin_user_id,
    'trade_request.admin_exception_hold_released',
    'trade_request', p_trade_request_id,
    jsonb_build_object(
      'trade_request_id', p_trade_request_id,
      'actor_user_id',    p_admin_user_id,
      'reason',           p_reason,
      'released_child_match_ids', to_jsonb(v_released_ids),
      'count',            array_length(v_released_ids,1),
      'parent_remains_archived', (v_tr.archived_at IS NOT NULL)
    )
  );

  RETURN jsonb_build_object(
    'released', true,
    'released_child_match_ids', to_jsonb(v_released_ids),
    'count', array_length(v_released_ids,1),
    'parent_remains_archived', (v_tr.archived_at IS NOT NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_release_trade_request_exception_hold(UUID,UUID,TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_release_trade_request_exception_hold(UUID,UUID,TEXT) TO service_role;