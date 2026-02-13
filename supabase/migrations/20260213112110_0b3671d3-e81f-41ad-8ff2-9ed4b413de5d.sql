
-- Fix token_balances RLS: policies were all RESTRICTIVE (AND logic), 
-- meaning non-admin users couldn't read their balance.
-- Drop restrictive policies and recreate as PERMISSIVE (OR logic).

DROP POLICY IF EXISTS "Users can view their org's token balance" ON public.token_balances;
DROP POLICY IF EXISTS "Admins can view all token balances" ON public.token_balances;
DROP POLICY IF EXISTS "Admins can manage all token balances" ON public.token_balances;
DROP POLICY IF EXISTS "Service role can manage token balances" ON public.token_balances;

-- Recreate as PERMISSIVE (default) so any matching policy grants access
CREATE POLICY "Users can view their org token balance"
  ON public.token_balances FOR SELECT
  USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY "Admins can manage all token balances"
  ON public.token_balances FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can manage token balances"
  ON public.token_balances FOR ALL
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text)
  WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);
