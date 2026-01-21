-- Phase 1: Critical Database Security Fixes

-- 1.1 Secure the match_evidence view with SECURITY INVOKER
-- This ensures the view respects the caller's RLS permissions
DROP VIEW IF EXISTS public.match_evidence;
CREATE VIEW public.match_evidence 
WITH (security_invoker = true) AS
SELECT 
  m.id AS match_id,
  m.org_id,
  m.created_at AS match_created_at,
  m.settled_at,
  jsonb_build_object(
    'buyer_id', m.buyer_id,
    'buyer_name', m.buyer_name,
    'seller_id', m.seller_id,
    'seller_name', m.seller_name,
    'commodity', m.commodity,
    'quantity_amount', m.quantity_amount,
    'quantity_unit', m.quantity_unit,
    'price_amount', m.price_amount,
    'price_currency', m.price_currency,
    'terms', m.terms,
    'metadata', m.metadata
  ) AS match_data,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'event_type', me.event_type,
        'created_at', me.created_at,
        'payload_hash', me.payload_hash,
        'previous_event_hash', me.previous_event_hash
      ) ORDER BY me.created_at
    )
    FROM match_events me
    WHERE me.match_id = m.id
  ) AS event_timeline,
  m.hash AS match_hash,
  m.status
FROM matches m;

-- 1.2 Remove hardcoded email whitelist from is_admin function
-- Now uses ONLY role-based checks (admin role assignment is separate concern)
CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = $1
      AND ur.role = 'admin'
  )
$$;

-- 1.3 Strengthen options table RLS with explicit org_id check
-- Drop existing policy first
DROP POLICY IF EXISTS "Users can view options for their signals" ON public.options;

-- Create more explicit policy with direct org isolation through signal chain
CREATE POLICY "Users can view options for their org's signals"
ON public.options FOR SELECT TO authenticated
USING (
  signal_id IN (
    SELECT id FROM signals 
    WHERE org_id = (
      SELECT org_id FROM profiles 
      WHERE id = auth.uid()
      LIMIT 1
    )
  )
);

-- Add service role insert policy for options (needed for edge functions)
DROP POLICY IF EXISTS "Service role can insert options" ON public.options;
CREATE POLICY "Service role can insert options"
ON public.options FOR INSERT
WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);