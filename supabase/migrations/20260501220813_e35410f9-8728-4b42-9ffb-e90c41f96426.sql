-- ═══════════════════════════════════════════════════════════════════════════
-- SECDEF Stage D1 — Lockdown of Service-Role Atomic RPCs
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Revokes EXECUTE from PUBLIC, anon, and authenticated for seven SECURITY
-- DEFINER functions that are only ever invoked by service-role edge functions.
-- Explicitly grants service_role.
--
-- Functions locked down:
--   1. atomic_token_burn
--   2. atomic_generate_poi_v2
--   3. atomic_accept_bind
--   4. atomic_engagement_transition
--   5. atomic_validate_governance_doc
--   6. is_test_mode_bypass_enabled
--   7. is_production_environment
--
-- Pre-flight verified (2026-05-01): zero production frontend callers in src/.
-- All callers are supabase/functions/* using the service-role client.
-- The previous UAT direct-RPC happy-path tests have been refactored to assert
-- the new security boundary (permission-denied for authenticated users).
--
-- DOES NOT touch: is_same_org (RLS dependency), Stage D2 orphans
-- (atomic_seal_deal, verify_acceptance_receipt), or Stage D3 frontend-facing
-- helpers (admin_get_reconciliation_alarms, get_test_mode_bypass_state,
-- get_test_mode_lockout_state, get_billing_availability, get_org_gate_position).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) atomic_token_burn
REVOKE EXECUTE ON FUNCTION public.atomic_token_burn(p_org_id uuid, p_amount integer, p_reason text, p_reference_id text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_token_burn(p_org_id uuid, p_amount integer, p_reason text, p_reference_id text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atomic_token_burn(p_org_id uuid, p_amount integer, p_reason text, p_reference_id text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_token_burn(p_org_id uuid, p_amount integer, p_reason text, p_reference_id text) TO   service_role;

-- 2) atomic_generate_poi_v2
REVOKE EXECUTE ON FUNCTION public.atomic_generate_poi_v2(p_match_id uuid, p_org_id uuid, p_settled_at timestamp with time zone, p_actor_user_id uuid, p_acks jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_generate_poi_v2(p_match_id uuid, p_org_id uuid, p_settled_at timestamp with time zone, p_actor_user_id uuid, p_acks jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atomic_generate_poi_v2(p_match_id uuid, p_org_id uuid, p_settled_at timestamp with time zone, p_actor_user_id uuid, p_acks jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_generate_poi_v2(p_match_id uuid, p_org_id uuid, p_settled_at timestamp with time zone, p_actor_user_id uuid, p_acks jsonb) TO   service_role;

-- 3) atomic_accept_bind
REVOKE EXECUTE ON FUNCTION public.atomic_accept_bind(p_match_id uuid, p_counterparty_org_id uuid, p_counterparty_role text, p_counterparty_name text, p_caller_org_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_accept_bind(p_match_id uuid, p_counterparty_org_id uuid, p_counterparty_role text, p_counterparty_name text, p_caller_org_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atomic_accept_bind(p_match_id uuid, p_counterparty_org_id uuid, p_counterparty_role text, p_counterparty_name text, p_caller_org_id uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_accept_bind(p_match_id uuid, p_counterparty_org_id uuid, p_counterparty_role text, p_counterparty_name text, p_caller_org_id uuid) TO   service_role;

-- 4) atomic_engagement_transition
REVOKE EXECUTE ON FUNCTION public.atomic_engagement_transition(p_engagement_id uuid, p_actor_type text, p_actor_user_id uuid, p_actor_email text, p_actor_name text, p_new_status text, p_entry_type text, p_contact_method text, p_contact_detail text, p_notes text, p_audit_action text, p_audit_org_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_engagement_transition(p_engagement_id uuid, p_actor_type text, p_actor_user_id uuid, p_actor_email text, p_actor_name text, p_new_status text, p_entry_type text, p_contact_method text, p_contact_detail text, p_notes text, p_audit_action text, p_audit_org_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atomic_engagement_transition(p_engagement_id uuid, p_actor_type text, p_actor_user_id uuid, p_actor_email text, p_actor_name text, p_new_status text, p_entry_type text, p_contact_method text, p_contact_detail text, p_notes text, p_audit_action text, p_audit_org_id uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_engagement_transition(p_engagement_id uuid, p_actor_type text, p_actor_user_id uuid, p_actor_email text, p_actor_name text, p_new_status text, p_entry_type text, p_contact_method text, p_contact_detail text, p_notes text, p_audit_action text, p_audit_org_id uuid) TO   service_role;

-- 5) atomic_validate_governance_doc
REVOKE EXECUTE ON FUNCTION public.atomic_validate_governance_doc(p_governance_doc_id uuid, p_org_id uuid, p_burn_amount integer, p_actor_user_id uuid, p_doc_type text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_validate_governance_doc(p_governance_doc_id uuid, p_org_id uuid, p_burn_amount integer, p_actor_user_id uuid, p_doc_type text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atomic_validate_governance_doc(p_governance_doc_id uuid, p_org_id uuid, p_burn_amount integer, p_actor_user_id uuid, p_doc_type text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_validate_governance_doc(p_governance_doc_id uuid, p_org_id uuid, p_burn_amount integer, p_actor_user_id uuid, p_doc_type text) TO   service_role;

-- 6) is_test_mode_bypass_enabled
REVOKE EXECUTE ON FUNCTION public.is_test_mode_bypass_enabled(_gate text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_test_mode_bypass_enabled(_gate text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_test_mode_bypass_enabled(_gate text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.is_test_mode_bypass_enabled(_gate text) TO   service_role;

-- 7) is_production_environment
REVOKE EXECUTE ON FUNCTION public.is_production_environment() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_production_environment() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_production_environment() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.is_production_environment() TO   service_role;