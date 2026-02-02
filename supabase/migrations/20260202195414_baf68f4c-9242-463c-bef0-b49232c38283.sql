-- Fix security issues: Remove public exposure of sensitive views
-- Issue 1: profiles_safe_view_public_exposure
-- Issue 2: match_evidence_public_view_exposure

-- Drop the match_evidence_public view as it's a duplicate that exposes data
-- The match_evidence view already exists and is properly secured to service_role only
DROP VIEW IF EXISTS public.match_evidence_public;

-- Ensure profiles_safe view has proper access restrictions
-- Revoke all access from PUBLIC, anon, and authenticated roles
REVOKE ALL ON public.profiles_safe FROM PUBLIC;
REVOKE ALL ON public.profiles_safe FROM anon;
REVOKE ALL ON public.profiles_safe FROM authenticated;

-- Grant access only to service_role
GRANT SELECT ON public.profiles_safe TO service_role;

-- Ensure match_evidence view also has proper access restrictions (defense in depth)
REVOKE ALL ON public.match_evidence FROM PUBLIC;
REVOKE ALL ON public.match_evidence FROM anon;
REVOKE ALL ON public.match_evidence FROM authenticated;

-- Grant access only to service_role
GRANT SELECT ON public.match_evidence TO service_role;