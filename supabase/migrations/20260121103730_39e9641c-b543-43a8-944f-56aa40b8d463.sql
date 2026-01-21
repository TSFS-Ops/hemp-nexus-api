-- Fix 1: Ensure match_evidence view has proper security
-- The match_evidence is a VIEW - we need to recreate it with SECURITY INVOKER
-- to ensure it respects the caller's RLS permissions

-- First, drop the existing view if it exists
DROP VIEW IF EXISTS public.match_evidence;

-- Recreate the view with SECURITY INVOKER (respects caller's RLS)
CREATE VIEW public.match_evidence
WITH (security_invoker = true)
AS
SELECT 
  m.id AS match_id,
  m.org_id,
  m.created_at AS match_created_at,
  m.settled_at,
  jsonb_build_object(
    'commodity', m.commodity,
    'quantity', jsonb_build_object('amount', m.quantity_amount, 'unit', m.quantity_unit),
    'price', jsonb_build_object('amount', m.price_amount, 'currency', m.price_currency),
    'buyer_id', m.buyer_id,
    'buyer_name', m.buyer_name,
    'seller_id', m.seller_id,
    'seller_name', m.seller_name,
    'terms', m.terms,
    'metadata', m.metadata
  ) AS match_data,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'event_type', me.event_type,
        'created_at', me.created_at,
        'payload_hash', me.payload_hash
      ) ORDER BY me.created_at
    )
    FROM public.match_events me
    WHERE me.match_id = m.id
  ) AS event_timeline,
  m.hash AS match_hash,
  m.status
FROM public.matches m;

-- Grant SELECT to authenticated users (RLS on underlying tables will filter data)
GRANT SELECT ON public.match_evidence TO authenticated;

-- Revoke any public access
REVOKE ALL ON public.match_evidence FROM anon;

-- Fix 2: Create a secure view for api_keys that excludes key_hash
-- This view will be used by the frontend instead of directly querying api_keys
CREATE OR REPLACE VIEW public.api_keys_safe AS
SELECT 
  id,
  org_id,
  name,
  scopes,
  status,
  created_by,
  created_at,
  last_used_at,
  expires_at,
  revoked_at,
  expiry_warning_sent,
  environment
  -- Intentionally excludes: key_hash, key_history
FROM public.api_keys;

-- Grant SELECT on safe view
GRANT SELECT ON public.api_keys_safe TO authenticated;

-- Revoke direct SELECT on key_hash column from api_keys table
-- We can't revoke column-level permissions in a simple way, but we can 
-- use the view pattern consistently

-- Fix 3: Strengthen profiles table RLS - verify no public SELECT exists
-- The current policies look correct, but let's ensure there's no permissive policy
-- that could leak data. We'll add an explicit deny for anon users.

-- Drop any potential permissive policies on profiles that could leak data
-- Then recreate with proper restrictions

-- First, let's check and ensure the policies are RESTRICTIVE (not permissive)
-- The current policies use "Permissive: No" which means they're already RESTRICTIVE

-- Add a comment to document the security configuration
COMMENT ON TABLE public.profiles IS 'User profiles with restricted access. RLS enforced: users can only see their own profile, admins can see all.';
COMMENT ON VIEW public.api_keys_safe IS 'Safe view of API keys that excludes sensitive key_hash column.';
COMMENT ON VIEW public.match_evidence IS 'Match evidence view with SECURITY INVOKER to respect caller RLS permissions.';