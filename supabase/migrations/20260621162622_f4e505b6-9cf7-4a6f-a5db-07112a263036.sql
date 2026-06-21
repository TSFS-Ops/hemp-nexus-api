
-- 1) Drop the unsafe public read policy on registry_company_people
DROP POLICY IF EXISTS "public reads public people" ON public.registry_company_people;

-- 2) Trigger: block public_visible = true if any personal contact field is populated
CREATE OR REPLACE FUNCTION public.registry_company_people_guard_public_visible()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.public_visible = true AND (
       NEW.personal_email IS NOT NULL
    OR NEW.personal_phone IS NOT NULL
    OR NEW.personal_address IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'registry_company_people: cannot set public_visible = true while personal contact fields are populated (id=%)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registry_company_people_guard_public_visible ON public.registry_company_people;
CREATE TRIGGER trg_registry_company_people_guard_public_visible
BEFORE INSERT OR UPDATE ON public.registry_company_people
FOR EACH ROW EXECUTE FUNCTION public.registry_company_people_guard_public_visible();

-- 3) Defense in depth: revoke column-level privileges on personal contact fields
REVOKE SELECT (personal_email, personal_phone, personal_address)
  ON public.registry_company_people FROM anon;
REVOKE SELECT (personal_email, personal_phone, personal_address)
  ON public.registry_company_people FROM authenticated;

-- 4) Public-safe view (security definer; only non-sensitive columns)
DROP VIEW IF EXISTS public.registry_company_people_public_safe;
CREATE VIEW public.registry_company_people_public_safe
WITH (security_invoker = false) AS
SELECT
  p.id,
  p.record_id,
  p.role_kind,
  p.display_name,
  p.created_at
FROM public.registry_company_people p
JOIN public.registry_company_records r ON r.id = p.record_id
WHERE p.public_visible = true
  AND r.public_display_allowed = true
  AND p.personal_email IS NULL
  AND p.personal_phone IS NULL
  AND p.personal_address IS NULL;

GRANT SELECT ON public.registry_company_people_public_safe TO anon, authenticated;

COMMENT ON VIEW public.registry_company_people_public_safe IS
  'Batch 11 hardening: public-safe officer projection. Excludes personal_email, personal_phone, personal_address. Only rows where public_visible=true, parent record public_display_allowed=true, and no personal contact data is present.';
