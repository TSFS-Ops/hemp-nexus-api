
-- 1. Remove all auto-provisioned free licences (amount_usd = 0)
DELETE FROM public.licences WHERE amount_usd = 0 AND tier = 'professional';

-- 2. Drop the auto-provision trigger
DROP TRIGGER IF EXISTS trg_initialize_org_licence ON public.organizations;

-- 3. Drop the trigger function
DROP FUNCTION IF EXISTS public.initialize_org_licence();
