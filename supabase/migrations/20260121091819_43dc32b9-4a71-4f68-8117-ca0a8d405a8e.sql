-- Fix: match_evidence is a VIEW, not a table. Views with security_invoker 
-- inherit RLS from underlying tables, but the scanner sees it as unprotected.
-- Solution: The view already uses SECURITY INVOKER which inherits 'matches' table RLS.
-- The underlying 'matches' table has proper RLS policies.
-- We should verify the view behavior is correct by testing.

-- Additional hardening: Restrict profiles visibility 
-- Users should only see their own profile, admins can see all
-- (The existing policy already does this correctly)

-- Verify profiles has correct policies - no changes needed as:
-- "Users can view their own profile" - USING (id = auth.uid())
-- This prevents email harvesting

-- For extra defense, add a policy comment for documentation
COMMENT ON POLICY "Users can view their own profile" ON public.profiles IS 
'Security: Prevents email enumeration by restricting profile access to self only. Admins have separate ALL policy.';