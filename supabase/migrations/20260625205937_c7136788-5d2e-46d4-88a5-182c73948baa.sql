CREATE OR REPLACE FUNCTION public.p5b5_resolve_actor_role(
  _user_id uuid,
  _allowed_roles text[]
) RETURNS public.p5_batch4_role_key
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
BEGIN
  IF _user_id IS NULL THEN RETURN NULL; END IF;
  FOREACH r IN ARRAY _allowed_roles LOOP
    IF public.has_role(_user_id, r::public.app_role) THEN
      RETURN CASE
        WHEN r = 'platform_admin' THEN 'platform_admin'::public.p5_batch4_role_key
        ELSE 'operator'::public.p5_batch4_role_key
      END;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;