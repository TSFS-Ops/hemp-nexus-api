CREATE OR REPLACE FUNCTION public._provision_user(p_user_id uuid, p_email text, p_full_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_profile_exists boolean;
  v_display_name text;
  v_invite record;
  v_invited boolean := false;
  v_assigned_role text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_user_id
  ) INTO v_profile_exists;

  IF v_profile_exists THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, 'org_member')
    ON CONFLICT (user_id, role) DO NOTHING;

    IF p_email LIKE '%@izenzo.co.za' THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (p_user_id, 'platform_admin')
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
      'status', 'exists',
      'profile_id', p_user_id
    );
  END IF;

  v_display_name := COALESCE(NULLIF(p_full_name, ''), p_email, 'User');

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
  VALUES (p_user_id, v_org_id, p_email, v_display_name)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, v_assigned_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  IF v_assigned_role != 'org_member' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, 'org_member')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  IF p_email LIKE '%@izenzo.co.za' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, 'platform_admin')
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
$function$