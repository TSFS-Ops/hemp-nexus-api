CREATE OR REPLACE FUNCTION public.ensure_user_profile(p_user_id uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_result       jsonb;
BEGIN
  -- Guard 1: caller must be authenticated and may only act on their own UUID.
  IF v_caller IS NULL OR v_caller <> p_user_id THEN
    RAISE EXCEPTION 'forbidden: ensure_user_profile may only be called for the calling user'
      USING ERRCODE = '42501';
  END IF;

  -- Guard 2: p_email must match the authenticated session email
  IF p_email IS NULL
     OR v_caller_email = ''
     OR lower(p_email) <> v_caller_email THEN
    RAISE EXCEPTION 'forbidden: p_email must match the authenticated session email'
      USING ERRCODE = '42501';
  END IF;

  v_result := public._provision_user(p_user_id, p_email, NULL);
  IF v_result->>'status' = 'created' THEN
    RAISE WARNING '[ensure_user_profile] Repaired missing profile for user %. This indicates the auth trigger may have failed during registration.',
      p_user_id;
  END IF;

  RETURN v_result;
END;
$function$;