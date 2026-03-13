
-- The previous REVOKE FROM anon was ineffective because grants flow through the PUBLIC role.
-- Must REVOKE from PUBLIC, then selectively re-GRANT to authenticated.

-- Step 1: Revoke ALL public schema function EXECUTE from PUBLIC role
DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN 
    SELECT p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC', fn.proname, fn.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', fn.proname, fn.args);
  END LOOP;
END $$;

-- Step 2: Grant to authenticated for functions the frontend calls
GRANT EXECUTE ON FUNCTION public.atomic_token_burn(uuid, integer, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_token_credit(uuid, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_transition_match_state(uuid, uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_update_deal_terms(uuid, uuid, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_user_profile(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_dd_role(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_match_evidence(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_email(uuid) TO authenticated;

-- Step 3: Keep anon EXECUTE only for auth flow functions
GRANT EXECUTE ON FUNCTION public.check_auth_lockout(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.check_and_increment_auth_failure(text, text, integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.check_auth_lockout(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_auth_failure(text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_auth_rate_limit(text, text) TO authenticated;

-- Step 4: Grant service_role access to all (it already has it via superuser, but explicit)
-- (service_role inherits from postgres which has superuser, so no action needed)

-- Step 5: Cleanup and trigger functions need authenticated for RLS policy checks
GRANT EXECUTE ON FUNCTION public.generate_event_hash(text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_rate_limits() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_idempotency_keys() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_auth_rate_limits() TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(uuid, text, timestamptz) TO authenticated;

-- Verify: check_security_definer_views and check_public_exposure need service_role only
-- check_backend_only_views needs service_role only
-- No grants needed — service_role has superuser
