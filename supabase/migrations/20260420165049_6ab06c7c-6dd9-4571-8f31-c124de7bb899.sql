-- Gap (a): Stop seeding profiles.full_name with the user's email at signup.
-- Leave it NULL so onboarding/My Profile must capture a real legal name.
-- Existing rows where full_name == email are also reset to NULL so the
-- diagnostic block fires correctly for users who never updated it.

CREATE OR REPLACE FUNCTION public._provision_user(p_user_id uuid, p_email text, p_full_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_profile_exists boolean;
  v_clean_full_name text;
  v_invite record;
  v_invited boolean := false;
  v_assigned_role text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_user_id
  ) INTO v_profile_exists;

  IF v_profile_exists THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, 'org_member'::app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    IF p_email LIKE '%@izenzo.co.za' THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (p_user_id, 'platform_admin'::app_role)
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
      'status', 'exists',
      'profile_id', p_user_id
    );
  END IF;

  -- Only accept a real legal name; reject empty strings and anything that
  -- looks like an email address. Leave NULL so the user must capture it.
  v_clean_full_name := NULLIF(trim(COALESCE(p_full_name, '')), '');
  IF v_clean_full_name IS NOT NULL AND v_clean_full_name ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    v_clean_full_name := NULL;
  END IF;

  SELECT id, org_id, role INTO v_invite
  FROM public.team_invitations
  WHERE email = lower(trim(p_email))
    AND status = 'pending'
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_invite.id IS NOT NULL THEN
    v_org_id := v_invite.org_id;
    v_invited := true;
    v_assigned_role := COALESCE(v_invite.role, 'org_member');

    UPDATE public.team_invitations
    SET status = 'accepted', accepted_at = now()
    WHERE id = v_invite.id;
  ELSE
    INSERT INTO public.organizations (name, status)
    VALUES (COALESCE(p_email, 'Organization'), 'active')
    RETURNING id INTO v_org_id;

    v_assigned_role := 'org_admin';
  END IF;

  INSERT INTO public.profiles (id, org_id, email, full_name)
  VALUES (p_user_id, v_org_id, p_email, v_clean_full_name)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, v_assigned_role::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  IF v_assigned_role != 'org_member' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, 'org_member'::app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  IF p_email LIKE '%@izenzo.co.za' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, 'platform_admin'::app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'status', 'created',
    'profile_id', p_user_id,
    'org_id', v_org_id,
    'invited', v_invited,
    'role', v_assigned_role
  );
END;
$function$;

-- Backfill: any existing profile whose full_name equals its email (or is the
-- email pattern) is reset to NULL so the gate gives the same diagnostic.
UPDATE public.profiles
   SET full_name = NULL
 WHERE full_name IS NOT NULL
   AND (
        lower(trim(full_name)) = lower(trim(email))
     OR full_name ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
   );

-- Audit the backfill so we have a record.
INSERT INTO public.admin_audit_logs (action, target_type, target_id, details)
VALUES (
  'profiles.full_name.backfill_nulled',
  'profiles',
  NULL,
  jsonb_build_object(
    'reason', 'Reset full_name to NULL where it was equal to email or matched email pattern',
    'applied_at', now()
  )
);