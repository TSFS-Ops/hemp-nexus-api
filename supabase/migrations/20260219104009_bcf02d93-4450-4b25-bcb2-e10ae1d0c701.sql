
-- 1. Update the trigger to grant 1000 trial credits with minimum_required=0
CREATE OR REPLACE FUNCTION public.initialize_org_token_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.token_balances (org_id, balance, minimum_required)
  VALUES (NEW.id, 1000, 0)
  ON CONFLICT (org_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- 2. Grant trial credits to all existing accounts that have 0 balance
-- and set their minimum_required to 0 for the trial period
UPDATE public.token_balances
SET balance = 1000, minimum_required = 0
WHERE balance <= 20;
