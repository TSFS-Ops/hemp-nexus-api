-- Update the handle_new_user function to create an organization first
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_org_id uuid;
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

  -- Assign the user a default role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'admin');

  RETURN NEW;
END;
$function$;