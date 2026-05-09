-- Batch C Phase 2b correction: make break-glass audit MANDATORY.
-- Fixes column drift (resource_* -> entity_*), supplies required org_id from
-- the match, and removes the best-effort EXCEPTION block so any audit failure
-- aborts the override (transactional integrity for governance control).

CREATE OR REPLACE FUNCTION public.platform_admin_break_glass_progress(
  p_match_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
RETURNS public.match_challenges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     public.match_challenges%ROWTYPE;
  v_org_id  uuid;
BEGIN
  IF p_match_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'p_match_id and p_actor_user_id required'
      USING ERRCODE = '22023';
  END IF;

  IF p_reason IS NULL OR char_length(p_reason) < 60 THEN
    RAISE EXCEPTION 'break_glass reason must be at least 60 characters'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_admin(p_actor_user_id) THEN
    RAISE EXCEPTION 'only platform_admin may invoke break_glass_progress'
      USING ERRCODE = '42501';
  END IF;

  -- Resolve owning org for the audit row (mandatory NOT NULL in audit_logs).
  SELECT m.org_id INTO v_org_id FROM public.matches m WHERE m.id = p_match_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'match % has no resolvable org_id for audit', p_match_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Lock the (unique) non-terminal challenge for this match.
  SELECT * INTO v_row
  FROM public.match_challenges
  WHERE match_id = p_match_id
    AND status IN ('open','under_review')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no open challenge to override on match %', p_match_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status = 'open' THEN
    UPDATE public.match_challenges
       SET status = 'under_review'
     WHERE id = v_row.id;
  END IF;

  UPDATE public.match_challenges
     SET status = 'outcome_recorded',
         outcome_code = 'admin_override_recorded',
         outcome_summary = p_reason,
         break_glass_override_used = true,
         closed_by_user_id = p_actor_user_id
   WHERE id = v_row.id
   RETURNING * INTO v_row;

  -- MANDATORY audit row. No EXCEPTION shield: if this fails, the override
  -- fails. Governance control must not silently lose its audit trail.
  INSERT INTO public.audit_logs (
    org_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  VALUES (
    v_org_id,
    p_actor_user_id,
    'challenge.break_glass_override',
    'match_challenge',
    v_row.id,
    jsonb_build_object(
      'match_id',      p_match_id,
      'reason_length', char_length(p_reason),
      'closed_status', v_row.status,
      'outcome_code',  v_row.outcome_code
    )
  );

  RETURN v_row;
END
$$;

REVOKE EXECUTE ON FUNCTION public.platform_admin_break_glass_progress(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.platform_admin_break_glass_progress(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.platform_admin_break_glass_progress(uuid, uuid, text) IS
  'Batch C Phase 2b: platform_admin override that closes the open challenge as outcome_recorded/admin_override_recorded. Audit row is MANDATORY — failure aborts the override.';