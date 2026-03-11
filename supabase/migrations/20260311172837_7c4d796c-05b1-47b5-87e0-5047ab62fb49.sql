
CREATE OR REPLACE FUNCTION public.ensure_user_profile(p_user_id uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_profile_exists boolean;
  v_org_id uuid;
BEGIN
  -- Check if profile already exists
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) INTO v_profile_exists;
  
  IF v_profile_exists THEN
    -- Profile exists, return it
    RETURN jsonb_build_object(
      'status', 'exists',
      'profile_id', p_user_id
    );
  END IF;

  -- Create organization
  INSERT INTO public.organizations (name, status)
  VALUES (COALESCE(p_email, 'Organization'), 'active')
  RETURNING id INTO v_org_id;

  -- Create profile
  INSERT INTO public.profiles (id, org_id, email, full_name)
  VALUES (p_user_id, v_org_id, p_email, COALESCE(p_email, 'User'));

  -- Assign default roles
  INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, 'org_admin')
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, 'org_member')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Platform admin for @izenzo.co.za emails
  IF p_email LIKE '%@izenzo.co.za' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, 'platform_admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'status', 'created',
    'profile_id', p_user_id,
    'org_id', v_org_id
  );
END;
$$;
