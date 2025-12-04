-- Update is_admin function to only allow specific whitelisted emails
CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN auth.users au ON au.id = ur.user_id
    WHERE ur.user_id = $1
      AND ur.role = 'admin'
      AND au.email IN (
        'david@izenzo.co.za',
        'james@izenzo.co.za',
        'daniel@izenzo.co.za',
        'ts@firstserve.co.za'
      )
  )
$function$;