-- Stage C: SECURITY DEFINER grant hardening
-- Group A: revoke anon, keep authenticated + service_role
-- Group B: revoke anon + authenticated, keep service_role only
-- Stage D high-risk atomic lifecycle functions are intentionally NOT touched here.

-- ── Group A ─────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.acknowledge_acceptance_receipt(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.safe_transition_match_state(uuid, uuid, text, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.safe_update_deal_terms(uuid, uuid, integer, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_email_retention_health() FROM anon;
REVOKE EXECUTE ON FUNCTION public.touch_match_view(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ensure_user_profile(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_match_evidence(uuid, uuid) FROM anon;

-- ── Group B ─────────────────────────────────────────────────────────────
-- atomic_token_credit: HIGHEST PRIORITY. Was callable by any authenticated user
-- against any org_id. Locking to service_role closes a privilege-escalation hole.
-- Known impact: AdminTokenManagement.tsx top-up UI will fail until a follow-up
-- edge function (admin-credit-org) is shipped to invoke it via service_role.
REVOKE EXECUTE ON FUNCTION public.atomic_token_credit(uuid, integer, text, text) FROM anon, authenticated, PUBLIC;

REVOKE EXECUTE ON FUNCTION public.refund_tokens_on_conflict(uuid, integer, uuid, text, text, uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_check_and_increment_rate_limit(uuid, text, timestamptz, integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_rate_limit(uuid, text, timestamptz) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_sole_member_is_org_admin(uuid) FROM anon, authenticated, PUBLIC;

-- Ensure service_role retains EXECUTE on every Group B function (idempotent).
GRANT EXECUTE ON FUNCTION public.atomic_token_credit(uuid, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_tokens_on_conflict(uuid, integer, uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.atomic_check_and_increment_rate_limit(uuid, text, timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_sole_member_is_org_admin(uuid) TO service_role;