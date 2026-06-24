
REVOKE EXECUTE ON FUNCTION public.p5b3_is_platform_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.p5b3_current_funder_org() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.p5b3_has_active_grant(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.p5b3_set_updated_at() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.p5b3_is_platform_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p5b3_current_funder_org() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p5b3_has_active_grant(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p5b3_set_updated_at() TO service_role;
