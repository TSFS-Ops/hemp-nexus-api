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