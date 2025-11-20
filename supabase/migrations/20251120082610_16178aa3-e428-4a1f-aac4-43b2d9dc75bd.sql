-- Update the handle_new_user function to only assign admin to @izenzo.co.za emails
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_org_id uuid;
  user_role app_role;
BEGIN
  -- Create a new organization for the user
  INSERT INTO public.organizations (name, status)
  VALUES (
    COALESCE(NEW.email, 'Organization'),
    'active'
  )
  RETURNING id INTO new_org_id;

  -- Create the user profile with the new org_id
  INSERT INTO public.profiles (id, org_id, email, full_name)
  VALUES (
    NEW.id,
    new_org_id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );

  -- Assign role based on email domain
  IF NEW.email LIKE '%@izenzo.co.za' THEN
    user_role := 'admin';
  ELSE
    user_role := 'buyer';
  END IF;

  -- Assign the determined role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, user_role);

  RETURN NEW;
END;
$$;