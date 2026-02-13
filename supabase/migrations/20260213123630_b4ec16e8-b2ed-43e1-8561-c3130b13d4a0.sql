
-- Step 2: Migrate existing roles and update functions
-- Migrate: admin → platform_admin, buyer → org_member
UPDATE public.user_roles SET role = 'platform_admin' WHERE role = 'admin';
UPDATE public.user_roles SET role = 'org_member' WHERE role = 'buyer';

-- Update handle_new_user: new users get org_admin + org_member; @izenzo.co.za gets platform_admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_org_id uuid;
BEGIN
  INSERT INTO public.organizations (name, status)
  VALUES (COALESCE(NEW.email, 'Organization'), 'active')
  RETURNING id INTO new_org_id;

  INSERT INTO public.profiles (id, org_id, email, full_name)
  VALUES (NEW.id, new_org_id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  -- First user of a new org is org_admin + org_member
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'org_admin');
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'org_member');

  -- Platform admin for @izenzo.co.za emails
  IF NEW.email LIKE '%@izenzo.co.za' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'platform_admin');
  END IF;

  RETURN NEW;
END;
$function$;

-- Update is_admin to recognize both legacy 'admin' and new 'platform_admin'
CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = $1 AND ur.role IN ('admin', 'platform_admin')
  )
$function$;

-- New: check if user is org_admin for a specific org
CREATE OR REPLACE FUNCTION public.is_org_admin(_user_id uuid, _org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = _user_id AND ur.role = 'org_admin' AND p.org_id = _org_id
  )
$function$;
