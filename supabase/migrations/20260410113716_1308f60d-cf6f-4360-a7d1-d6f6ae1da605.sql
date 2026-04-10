-- FIX: Remove overly permissive trade_orders SELECT policy
DROP POLICY IF EXISTS "Authenticated users can browse active orders" ON public.trade_orders;