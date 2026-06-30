
-- 1) has_role: self-only for authenticated callers, plus admin escape, plus
--    EXECUTE restricted to authenticated + service_role.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
      AND (
        -- service-role / internal RLS contexts where auth.uid() is null
        auth.uid() IS NULL
        -- caller is asking about themselves
        OR _user_id = auth.uid()
        -- caller is a platform admin (direct lookup; no recursion via has_role)
        OR EXISTS (
          SELECT 1
          FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role = 'platform_admin'::app_role
        )
      )
  )
$function$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

-- 2) registry_company_people — re-assert column-level REVOKE on personal_*
--    fields from anon/authenticated/PUBLIC. Reads of these columns must go
--    through the service-role edge function only.
REVOKE SELECT (personal_email, personal_phone, personal_address)
  ON public.registry_company_people FROM PUBLIC;
REVOKE SELECT (personal_email, personal_phone, personal_address)
  ON public.registry_company_people FROM anon;
REVOKE SELECT (personal_email, personal_phone, personal_address)
  ON public.registry_company_people FROM authenticated;

COMMENT ON COLUMN public.registry_company_people.personal_email IS
  'Admin-only personal contact. Direct data-API SELECT is revoked from anon/authenticated/PUBLIC; access only via service-role edge functions.';
COMMENT ON COLUMN public.registry_company_people.personal_phone IS
  'Admin-only personal contact. Direct data-API SELECT is revoked from anon/authenticated/PUBLIC; access only via service-role edge functions.';
COMMENT ON COLUMN public.registry_company_people.personal_address IS
  'Admin-only personal contact. Direct data-API SELECT is revoked from anon/authenticated/PUBLIC; access only via service-role edge functions.';

-- 3) registry_import_records_staging — revoke column-level SELECT on the
--    contact_*_admin_only fields from anon/authenticated/PUBLIC. The
--    compliance_owner role (which authenticates via the `authenticated`
--    Postgres role at the data API) therefore cannot read these columns
--    directly; service-role / edge functions remain the only path.
REVOKE SELECT (contact_email_admin_only, contact_phone_admin_only)
  ON public.registry_import_records_staging FROM PUBLIC;
REVOKE SELECT (contact_email_admin_only, contact_phone_admin_only)
  ON public.registry_import_records_staging FROM anon;
REVOKE SELECT (contact_email_admin_only, contact_phone_admin_only)
  ON public.registry_import_records_staging FROM authenticated;

COMMENT ON COLUMN public.registry_import_records_staging.contact_email_admin_only IS
  'Admin-only contact. Direct data-API SELECT is revoked from anon/authenticated/PUBLIC; access only via service-role edge functions.';
COMMENT ON COLUMN public.registry_import_records_staging.contact_phone_admin_only IS
  'Admin-only contact. Direct data-API SELECT is revoked from anon/authenticated/PUBLIC; access only via service-role edge functions.';
