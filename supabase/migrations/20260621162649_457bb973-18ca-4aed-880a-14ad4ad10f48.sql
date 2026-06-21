
DROP VIEW IF EXISTS public.registry_company_people_public_safe;

CREATE OR REPLACE FUNCTION public.registry_company_people_public_safe(_record_id uuid)
RETURNS TABLE (
  id uuid,
  record_id uuid,
  role_kind text,
  display_name text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.record_id, p.role_kind, p.display_name, p.created_at
  FROM public.registry_company_people p
  JOIN public.registry_company_records r ON r.id = p.record_id
  WHERE p.record_id = _record_id
    AND p.public_visible = true
    AND r.public_display_allowed = true
    AND p.personal_email IS NULL
    AND p.personal_phone IS NULL
    AND p.personal_address IS NULL;
$$;

REVOKE ALL ON FUNCTION public.registry_company_people_public_safe(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registry_company_people_public_safe(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.registry_company_people_public_safe(uuid) IS
  'Batch 11 hardening: public-safe officer projection. Never returns personal_email/personal_phone/personal_address.';
