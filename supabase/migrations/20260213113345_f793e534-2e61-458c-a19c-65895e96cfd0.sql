
-- New orgs should start with 0 credits (production mode)
-- Credits are only added via real Paystack purchases
CREATE OR REPLACE FUNCTION public.initialize_org_token_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.token_balances (org_id, balance, minimum_required)
  VALUES (NEW.id, 0, 0)
  ON CONFLICT (org_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- Also update the default on the table itself
ALTER TABLE public.token_balances ALTER COLUMN balance SET DEFAULT 0;
ALTER TABLE public.token_balances ALTER COLUMN minimum_required SET DEFAULT 0;
