-- 1. Insert a 1-year professional licence for every existing org that lacks one
INSERT INTO public.licences (org_id, tier, starts_at, expires_at, amount_usd, status)
SELECT o.id, 'professional', now(), now() + interval '1 year', 0, 'active'
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.licences l
  WHERE l.org_id = o.id AND l.status = 'active' AND l.expires_at > now()
);

-- 2. Create a trigger function to auto-provision a licence for new orgs
CREATE OR REPLACE FUNCTION public.initialize_org_licence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.licences (org_id, tier, starts_at, expires_at, amount_usd, status)
  VALUES (NEW.id, 'professional', now(), now() + interval '1 year', 0, 'active')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;

-- 3. Attach the trigger to the organizations table
DROP TRIGGER IF EXISTS trg_initialize_org_licence ON public.organizations;
CREATE TRIGGER trg_initialize_org_licence
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.initialize_org_licence();