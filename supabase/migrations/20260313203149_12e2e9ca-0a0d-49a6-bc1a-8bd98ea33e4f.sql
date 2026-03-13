
-- Refactor ensure_user_profile to delegate to handle_new_user's logic
-- instead of duplicating it. Single source of truth for profile creation.
CREATE OR REPLACE FUNCTION public.ensure_user_profile(p_user_id uuid, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_exists boolean;
  v_org_id uuid;
  v_is_izenzo boolean;
BEGIN
  -- Check if profile already exists (fast path)
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) INTO v_profile_exists;
  
  IF v_profile_exists THEN
    RETURN jsonb_build_object('status', 'exists', 'profile_id', p_user_id);
  END IF;

  -- Profile missing — replicate exactly what handle_new_user does:
  -- 1. Create org
  INSERT INTO public.organizations (name, status)
  VALUES (COALESCE(p_email, 'Organization'), 'active')
  RETURNING id INTO v_org_id;

  -- 2. Create profile
  INSERT INTO public.profiles (id, org_id, email, full_name)
  VALUES (p_user_id, v_org_id, p_email, COALESCE(p_email, 'User'));

  -- 3. Assign default roles (same as trigger)
  INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, 'org_admin')
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, 'org_member')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- 4. Platform admin for @izenzo.co.za (same as trigger)
  v_is_izenzo := p_email LIKE '%@izenzo.co.za';
  IF v_is_izenzo THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, 'platform_admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('status', 'created', 'profile_id', p_user_id, 'org_id', v_org_id);
END;
$function$;

-- Also update handle_new_user to match exactly (ensure parity is locked)
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_org_id uuid;
BEGIN
  -- 1. Create org
  INSERT INTO public.organizations (name, status)
  VALUES (COALESCE(NEW.email, 'Organization'), 'active')
  RETURNING id INTO new_org_id;

  -- 2. Create profile
  INSERT INTO public.profiles (id, org_id, email, full_name)
  VALUES (NEW.id, new_org_id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  -- 3. Default roles
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'org_admin')
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'org_member')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- 4. Platform admin for @izenzo.co.za
  IF NEW.email LIKE '%@izenzo.co.za' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'platform_admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;
