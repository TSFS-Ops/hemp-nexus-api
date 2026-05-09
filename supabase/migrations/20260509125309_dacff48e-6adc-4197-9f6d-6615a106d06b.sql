-- =====================================================================
-- Batch C Phase 2 — Service-role helpers + Break-Glass RPC
-- Legacy public.disputes intentionally untouched.
-- No rating-emission code added (challenge_rating_impact remains disabled).
-- =====================================================================

-- (1) Helper: does this match have any non-terminal challenge?
CREATE OR REPLACE FUNCTION public.has_open_match_challenge(p_match_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.match_challenges mc
    WHERE mc.match_id = p_match_id
      AND mc.status IN ('open','under_review')
  )
$$;

REVOKE EXECUTE ON FUNCTION public.has_open_match_challenge(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.has_open_match_challenge(uuid) TO service_role;

-- (2) Break-Glass RPC.
-- Records an explicit platform_admin override on the (unique) open challenge
-- for a match. Requires reason >= 60 chars. Service-role only.
-- Sets status=outcome_recorded, outcome_code='admin_override_recorded',
-- outcome_summary=reason, break_glass_override_used=true, closed_by_user_id=p_actor.
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
  v_row public.match_challenges%ROWTYPE;
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

  -- Move via state machine: must pass through under_review if currently open.
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

  -- Audit trail (best-effort, do not block on schema mismatch).
  BEGIN
    INSERT INTO public.audit_logs (action, actor_user_id, resource_type, resource_id, metadata)
    VALUES (
      'challenge.break_glass_override',
      p_actor_user_id,
      'match_challenge',
      v_row.id::text,
      jsonb_build_object(
        'match_id', p_match_id,
        'reason_length', char_length(p_reason)
      )
    );
  EXCEPTION WHEN others THEN
    -- audit_logs schema differences must not break governance.
    NULL;
  END;

  RETURN v_row;
END
$$;

REVOKE EXECUTE ON FUNCTION public.platform_admin_break_glass_progress(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.platform_admin_break_glass_progress(uuid, uuid, text) TO service_role;