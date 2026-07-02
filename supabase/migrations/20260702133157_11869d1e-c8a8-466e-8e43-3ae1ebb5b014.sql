
-- Fix 1: match_counterparty_intel INSERT policy must require match participation
DROP POLICY IF EXISTS "Org members can create counterparty intel" ON public.match_counterparty_intel;
CREATE POLICY "Org members can create counterparty intel"
ON public.match_counterparty_intel
FOR INSERT
TO authenticated
WITH CHECK (
  org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
  AND public.is_match_participant(auth.uid(), match_id)
);

-- Fix 2: registry_company_people — trigger prevents public_visible=true when PII is populated (going forward)
CREATE OR REPLACE FUNCTION public.registry_company_people_block_public_pii()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.public_visible = true
     AND (NEW.personal_email IS NOT NULL
       OR NEW.personal_phone IS NOT NULL
       OR NEW.personal_address IS NOT NULL) THEN
    RAISE EXCEPTION 'registry_company_people: public_visible cannot be true when personal_email/personal_phone/personal_address is populated'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registry_company_people_block_public_pii ON public.registry_company_people;
CREATE TRIGGER trg_registry_company_people_block_public_pii
BEFORE INSERT OR UPDATE ON public.registry_company_people
FOR EACH ROW EXECUTE FUNCTION public.registry_company_people_block_public_pii();
