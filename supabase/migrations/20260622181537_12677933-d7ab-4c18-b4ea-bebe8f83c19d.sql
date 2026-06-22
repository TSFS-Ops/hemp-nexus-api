-- Fix: revoke direct RPC execution of has_dd_role from normal users.
-- Function body is unchanged. RLS policies that reference has_dd_role(...)
-- continue to evaluate normally: Postgres executes policy expressions as the
-- table owner, and the helper remains SECURITY DEFINER, so policy-internal
-- calls do not depend on the caller's EXECUTE privilege. Only the direct
-- PostgREST RPC surface (anon/authenticated calling rpc('has_dd_role', ...))
-- is removed. service_role retains EXECUTE for server-side/admin use.

REVOKE EXECUTE ON FUNCTION public.has_dd_role(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_dd_role(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_dd_role(uuid, uuid, text) FROM authenticated;

GRANT  EXECUTE ON FUNCTION public.has_dd_role(uuid, uuid, text) TO service_role;