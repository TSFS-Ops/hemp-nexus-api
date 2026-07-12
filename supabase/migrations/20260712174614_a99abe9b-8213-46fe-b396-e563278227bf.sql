
-- ─────────────────────────────────────────────────────────────
-- Fix: invites_update_no_column_restriction
-- Recipients may only change status/accepted_at/declined_at/declined_reason.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_invite_recipient_column_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service boolean := (auth.jwt() ->> 'role') = 'service_role';
  v_is_admin boolean := false;
  v_is_sender boolean := false;
  v_recipient_email text;
  v_recipient_org uuid;
BEGIN
  IF v_uid IS NULL OR v_is_service THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_is_admin := public.is_admin(v_uid);
  EXCEPTION WHEN OTHERS THEN
    v_is_admin := false;
  END;
  IF v_is_admin THEN
    RETURN NEW;
  END IF;

  -- Sender-side actors are allowed broader edits (existing sender policy already permits).
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_uid AND p.org_id = OLD.from_org_id
  ) INTO v_is_sender;
  IF v_is_sender THEN
    RETURN NEW;
  END IF;

  -- Recipient scope: match on to_email or to_org_id.
  SELECT u.email INTO v_recipient_email FROM auth.users u WHERE u.id = v_uid;
  SELECT p.org_id INTO v_recipient_org FROM public.profiles p WHERE p.id = v_uid;

  IF (OLD.to_email IS NOT NULL AND OLD.to_email = v_recipient_email)
     OR (OLD.to_org_id IS NOT NULL AND OLD.to_org_id = v_recipient_org)
  THEN
    IF NEW.id                  IS DISTINCT FROM OLD.id
    OR NEW.created_at          IS DISTINCT FROM OLD.created_at
    OR NEW.from_user_id        IS DISTINCT FROM OLD.from_user_id
    OR NEW.from_org_id         IS DISTINCT FROM OLD.from_org_id
    OR NEW.to_email            IS DISTINCT FROM OLD.to_email
    OR NEW.to_org_id           IS DISTINCT FROM OLD.to_org_id
    OR NEW.search_query        IS DISTINCT FROM OLD.search_query
    OR NEW.search_results      IS DISTINCT FROM OLD.search_results
    OR NEW.selected_result_id  IS DISTINCT FROM OLD.selected_result_id
    OR NEW.selected_result_data IS DISTINCT FROM OLD.selected_result_data
    OR NEW.match_id            IS DISTINCT FROM OLD.match_id
    OR NEW.expires_at          IS DISTINCT FROM OLD.expires_at
    THEN
      RAISE EXCEPTION 'Recipients may only change status/accepted_at/declined_at/declined_reason on invites'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_invite_recipient_column_scope ON public.invites;
CREATE TRIGGER trg_enforce_invite_recipient_column_scope
  BEFORE UPDATE ON public.invites
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invite_recipient_column_scope();

-- ─────────────────────────────────────────────────────────────
-- Fix: profiles_org_id_tenant_hop
-- Only platform_admin / service role may change a profile's org_id.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_profile_org_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service boolean := (auth.jwt() ->> 'role') = 'service_role';
  v_is_platform_admin boolean := false;
BEGIN
  IF NEW.org_id IS NOT DISTINCT FROM OLD.org_id THEN
    RETURN NEW;
  END IF;

  IF v_is_service OR v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_is_platform_admin := public.has_role(v_uid, 'platform_admin'::public.app_role);
  EXCEPTION WHEN OTHERS THEN
    v_is_platform_admin := false;
  END;

  IF v_is_platform_admin THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Changing org_id on a profile is not permitted'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_profile_org_immutability ON public.profiles;
CREATE TRIGGER trg_enforce_profile_org_immutability
  BEFORE UPDATE OF org_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_org_immutability();
