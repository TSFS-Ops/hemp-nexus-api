-- Fix options table security: restrict INSERT to system processes only
-- The edge function uses service role key which bypasses RLS, so we can safely
-- remove the permissive INSERT policy that allows any authenticated user to insert

-- Drop the dangerous INSERT policy
DROP POLICY IF EXISTS "System can insert options" ON public.options;

-- Keep the SELECT policy that allows users to view their own signal options
-- (no changes needed to this policy)

-- Note: The signals edge function uses SUPABASE_SERVICE_ROLE_KEY which bypasses
-- RLS entirely, so it can still insert options during background search.
-- Regular users will no longer be able to insert options directly.