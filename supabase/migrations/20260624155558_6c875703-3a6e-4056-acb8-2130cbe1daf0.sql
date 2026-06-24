
REVOKE EXECUTE ON FUNCTION public.p5_has_any_role(uuid, text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.p5_has_any_role(uuid, text[]) TO authenticated, service_role;
