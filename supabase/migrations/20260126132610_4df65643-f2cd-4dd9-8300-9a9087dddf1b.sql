-- ============================================================
-- Email Access Hardening Migration
-- Creates get_user_email() function for secure email lookups
-- ============================================================

-- Create secure email accessor function
-- Returns email only for:
-- 1. Self-access (caller is the target user)
-- 2. Admin access (caller has admin role)
-- Otherwise returns redacted email
CREATE OR REPLACE FUNCTION public.get_user_email(target_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_is_admin boolean;
  result_email text;
BEGIN
  -- Null target returns null
  IF target_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Self-access is always allowed
  IF caller_id IS NOT NULL AND caller_id = target_user_id THEN
    SELECT email INTO result_email FROM profiles WHERE id = target_user_id;
    RETURN result_email;
  END IF;
  
  -- Admin access is allowed
  IF caller_id IS NOT NULL THEN
    SELECT public.has_role(caller_id, 'admin'::public.app_role) INTO caller_is_admin;
    IF COALESCE(caller_is_admin, false) THEN
      SELECT email INTO result_email FROM profiles WHERE id = target_user_id;
      RETURN result_email;
    END IF;
  END IF;
  
  -- Service role access is allowed
  IF (auth.jwt() ->> 'role') = 'service_role' THEN
    SELECT email INTO result_email FROM profiles WHERE id = target_user_id;
    RETURN result_email;
  END IF;
  
  -- Everyone else gets redacted
  RETURN '***@***.***';
END;
$$;

-- Grant execute to authenticated users (access is controlled within the function)
GRANT EXECUTE ON FUNCTION public.get_user_email(uuid) TO authenticated;

-- Add documentation comment
COMMENT ON FUNCTION public.get_user_email IS 
'Security: Returns email only for self or admin. Prevents email enumeration across organizations.';

-- ============================================================
-- Create profiles_safe view for frontend consumption
-- Email is automatically redacted for non-self/non-admin callers
-- ============================================================

CREATE OR REPLACE VIEW public.profiles_safe
WITH (security_invoker = true)
AS
SELECT 
  id,
  org_id,
  full_name,
  status,
  created_at,
  updated_at,
  -- Email is redacted unless caller is self or admin
  public.get_user_email(id) as email
FROM public.profiles;

-- Grant select to authenticated (RLS still applies via security_invoker)
GRANT SELECT ON public.profiles_safe TO authenticated;

-- Revoke anon access to this view
REVOKE ALL ON public.profiles_safe FROM anon;

-- Add documentation comment
COMMENT ON VIEW public.profiles_safe IS 
'Security: Safe view of profiles that automatically redacts email for non-self/non-admin callers.';