
-- Extend platform_admin_break_glass_progress with structured governance fields.
-- Backwards-compatible: new params have DEFAULTs, so the existing 3-arg call
-- signature used by the edge function and tests continues to resolve.

CREATE OR REPLACE FUNCTION public.platform_admin_break_glass_progress(
  p_match_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_reason_category text DEFAULT NULL,
  p_internal_approval_reference text DEFAULT NULL,
  p_regulator_reference text DEFAULT NULL
)
RETURNS match_challenges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row     public.match_challenges%ROWTYPE;
  v_org_id  uuid;
  v_allowed_categories constant text[] := ARRAY[
    'documentation_corrected_commercial_confirmation_received',
    'compliance_review_completed',
    'regulator_or_authority_instruction',
    'platform_risk_review_completed',
    'duplicate_or_erroneous_challenge',
    'other_governance_reason'
  ];
  v_regulator text;
BEGIN
  IF p_match_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'p_match_id and p_actor_user_id required'
      USING ERRCODE = '22023';
  END IF;

  IF p_reason IS NULL OR char_length(p_reason) < 60 THEN
    RAISE EXCEPTION 'break_glass reason must be at least 60 characters'
      USING ERRCODE = '22023';
  END IF;

  -- Structured governance fields: required when supplied at all.
  -- Category must be one of the allowed governance categories.
  IF p_reason_category IS NOT NULL
     AND NOT (p_reason_category = ANY (v_allowed_categories)) THEN
    RAISE EXCEPTION 'reason_category % is not an allowed governance category', p_reason_category
      USING ERRCODE = '22023';
  END IF;

  IF p_reason_category IS NOT NULL
     AND (p_internal_approval_reference IS NULL
          OR char_length(btrim(p_internal_approval_reference)) = 0) THEN
    RAISE EXCEPTION 'internal_approval_reference is required when reason_category is supplied'
      USING ERRCODE = '22023';
  END IF;

  -- Regulator reference: optional, normalise blank → "Not applicable".
  v_regulator := CASE
    WHEN p_regulator_reference IS NULL OR char_length(btrim(p_regulator_reference)) = 0
      THEN 'Not applicable'
    ELSE btrim(p_regulator_reference)
  END;

  IF NOT public.is_admin(p_actor_user_id) THEN
    RAISE EXCEPTION 'only platform_admin may invoke break_glass_progress'
      USING ERRCODE = '42501';
  END IF;

  SELECT m.org_id INTO v_org_id FROM public.matches m WHERE m.id = p_match_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'match % has no resolvable org_id for audit', p_match_id
      USING ERRCODE = 'P0002';
  END IF;

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

  -- MANDATORY audit row. Structured governance fields stored in metadata.
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
      'match_id',                     p_match_id,
      'reason_length',                char_length(p_reason),
      'closed_status',                v_row.status,
      'outcome_code',                 v_row.outcome_code,
      'reason_category',              p_reason_category,
      'internal_approval_reference',  p_internal_approval_reference,
      'regulator_reference',          v_regulator,
      'written_reason',               p_reason
    )
  );

  RETURN v_row;
END
$function$;

-- Lock down execution to service_role only (per SECDEF Stage D1).
REVOKE EXECUTE ON FUNCTION public.platform_admin_break_glass_progress(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.platform_admin_break_glass_progress(uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_break_glass_progress(uuid, uuid, text, text, text, text)
  TO service_role;
