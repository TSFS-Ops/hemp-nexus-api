-- Backfill profiles for existing users who don't have them
DO $$
DECLARE
  user_record RECORD;
  new_org_id uuid;
  user_role app_role;
BEGIN
  FOR user_record IN 
    SELECT u.id, u.email, u.raw_user_meta_data
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE p.id IS NULL
  LOOP
    -- Create organization for the user
    INSERT INTO public.organizations (name, status)
    VALUES (
      COALESCE(user_record.email, 'Organization'),
      'active'
    )
    RETURNING id INTO new_org_id;

    -- Create profile
    INSERT INTO public.profiles (id, org_id, email, full_name)
    VALUES (
      user_record.id,
      new_org_id,
      user_record.email,
      COALESCE(user_record.raw_user_meta_data->>'full_name', user_record.email)
    );

    -- Assign role based on email domain
    IF user_record.email LIKE '%@izenzo.co.za' THEN
      user_role := 'admin';
    ELSE
      user_role := 'buyer';
    END IF;

    -- Assign role
    INSERT INTO public.user_roles (user_id, role)
    VALUES (user_record.id, user_role);

    RAISE NOTICE 'Created profile and role for user: %', user_record.email;
  END LOOP;
END $$;