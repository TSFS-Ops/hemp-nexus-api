
-- Revoke all access to internal function from all roles
REVOKE EXECUTE ON FUNCTION public._provision_user(uuid, text, text) FROM PUBLIC;
-- Re-grant only to service_role (used by SECURITY DEFINER callers)
GRANT EXECUTE ON FUNCTION public._provision_user(uuid, text, text) TO postgres;
