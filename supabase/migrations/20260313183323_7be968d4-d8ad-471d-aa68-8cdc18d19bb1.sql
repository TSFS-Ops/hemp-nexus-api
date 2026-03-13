
-- CRITICAL: Revoke anon EXECUTE on all security-sensitive functions.
-- These are balance mutation, state mutation, and security control functions
-- that must only be callable by authenticated users or service_role.

-- Balance mutation primitives (no internal auth check)
REVOKE EXECUTE ON FUNCTION public.atomic_token_burn(uuid, integer, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atomic_token_credit(uuid, integer, text, text) FROM anon;

-- State mutation primitives
REVOKE EXECUTE ON FUNCTION public.safe_transition_match_state(uuid, uuid, text, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.safe_update_deal_terms(uuid, uuid, integer, jsonb) FROM anon;

-- Security control — anon must not bypass rate limiting
REVOKE EXECUTE ON FUNCTION public.reset_auth_rate_limit(text, text) FROM anon;

-- Cleanup functions — admin/cron only
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_rate_limits() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_idempotency_keys() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_auth_rate_limits() FROM anon;

-- Internal increment — used by edge functions with service_role
REVOKE EXECUTE ON FUNCTION public.increment_rate_limit(uuid, text, timestamptz) FROM anon;

-- Trigger functions — not directly callable but good hygiene
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.initialize_org_token_balance() FROM anon;
REVOKE EXECUTE ON FUNCTION public.audit_dispute_creation() FROM anon;
REVOKE EXECUTE ON FUNCTION public.prevent_break_glass_mutation() FROM anon;
REVOKE EXECUTE ON FUNCTION public.prevent_collapse_ledger_mutation() FROM anon;
REVOKE EXECUTE ON FUNCTION public.prevent_event_store_mutation() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon;

-- Hash generation — internal use only
REVOKE EXECUTE ON FUNCTION public.generate_event_hash(text, jsonb, text) FROM anon;

-- Evidence retrieval — requires authenticated context
REVOKE EXECUTE ON FUNCTION public.get_match_evidence(uuid, uuid) FROM anon;

-- Admin checks — no reason for anon access
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_org_admin(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_dd_role(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;

-- Profile creation — happens post-signup (authenticated)
REVOKE EXECUTE ON FUNCTION public.ensure_user_profile(uuid, text) FROM anon;

-- KEEP anon EXECUTE on these (needed for login flow):
-- check_auth_lockout(text, text)
-- check_and_increment_auth_failure(text, text, integer, integer)
-- get_user_email(uuid) — returns redacted for non-self
