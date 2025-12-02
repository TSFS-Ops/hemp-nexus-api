-- Fix match_evidence view - add RLS policies
-- First, we need to enable RLS on the underlying matches table view access
-- The match_evidence is a VIEW, so we control access via the underlying tables

-- Create a security definer function to safely access match evidence
CREATE OR REPLACE FUNCTION public.get_match_evidence(p_match_id uuid, p_org_id uuid)
RETURNS TABLE (
  match_id uuid,
  org_id uuid,
  match_created_at timestamptz,
  settled_at timestamptz,
  match_data jsonb,
  event_timeline jsonb,
  match_hash text,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    match_id,
    org_id,
    match_created_at,
    settled_at,
    match_data,
    event_timeline,
    match_hash,
    status
  FROM match_evidence
  WHERE match_evidence.match_id = p_match_id
    AND match_evidence.org_id = p_org_id;
$$;

-- Fix function search paths for existing functions
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;