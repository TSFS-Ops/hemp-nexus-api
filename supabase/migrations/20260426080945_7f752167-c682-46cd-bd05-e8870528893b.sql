CREATE OR REPLACE FUNCTION public.ensure_sole_member_is_org_admin(_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _member_count int;
  _sole_user_id uuid;
BEGIN
  IF _org_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*)::int
    INTO _member_count
  FROM public.profiles
  WHERE org_id = _org_id
    AND status = 'active';

  IF _member_count = 1 THEN
    SELECT id
      INTO _sole_user_id
    FROM public.profiles
    WHERE org_id = _org_id
      AND status = 'active'
    LIMIT 1;

    IF _sole_user_id IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (_sole_user_id, 'org_admin'::app_role)
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.profiles_sole_member_promote_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.ensure_sole_member_is_org_admin(NEW.org_id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      PERFORM public.ensure_sole_member_is_org_admin(OLD.org_id);
      PERFORM public.ensure_sole_member_is_org_admin(NEW.org_id);
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM public.ensure_sole_member_is_org_admin(NEW.org_id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.ensure_sole_member_is_org_admin(OLD.org_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS profiles_sole_member_promote ON public.profiles;
CREATE TRIGGER profiles_sole_member_promote
AFTER INSERT OR UPDATE OF org_id, status OR DELETE
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.profiles_sole_member_promote_trg();

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT org_id
    FROM public.profiles
    WHERE status = 'active'
    GROUP BY org_id
    HAVING COUNT(*) = 1
  LOOP
    PERFORM public.ensure_sole_member_is_org_admin(r.org_id);
  END LOOP;
END;
$$;
