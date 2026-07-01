-- Fix: profiles_org_id_self_update
-- Prevent users from moving themselves into another org via self-update.
-- Only platform_admin (via the pre-existing "Platform admins can manage all
-- profiles" policy) may change org_id.

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND id = auth.uid()
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND id = auth.uid()
  AND org_id IS NOT DISTINCT FROM (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
);

-- Fix: invites_update_missing_with_check
-- Recipients can only accept/decline; they cannot rewrite routing/payload
-- columns. Enforced with a BEFORE UPDATE trigger, because RLS WITH CHECK
-- cannot compare NEW.* against OLD.* on a per-column basis.

DROP POLICY IF EXISTS "Recipients can accept decline invites to their email" ON public.invites;
DROP POLICY IF EXISTS "Recipients can accept decline invites to their org"   ON public.invites;

CREATE POLICY "Recipients can accept decline invites to their email"
ON public.invites
FOR UPDATE
TO authenticated
USING (
  to_email IN (SELECT users.email FROM auth.users WHERE users.id = auth.uid())
)
WITH CHECK (
  to_email IN (SELECT users.email FROM auth.users WHERE users.id = auth.uid())
);

CREATE POLICY "Recipients can accept decline invites to their org"
ON public.invites
FOR UPDATE
TO authenticated
USING (
  to_org_id IN (SELECT profiles.org_id FROM public.profiles WHERE profiles.id = auth.uid())
)
WITH CHECK (
  to_org_id IN (SELECT profiles.org_id FROM public.profiles WHERE profiles.id = auth.uid())
);

CREATE OR REPLACE FUNCTION public.assert_invite_recipient_column_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      uuid := auth.uid();
  v_user_email   text;
  v_user_org_id  uuid;
  v_is_recipient boolean := false;
  v_is_sender    boolean := false;
  v_is_admin     boolean := false;
  v_jwt_role     text    := coalesce(auth.jwt() ->> 'role', '');
BEGIN
  -- Service role bypasses this recipient-scoped guard.
  IF v_jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_is_admin := public.has_role(v_user_id, 'platform_admin'::public.app_role);
  EXCEPTION WHEN OTHERS THEN
    v_is_admin := false;
  END;
  IF v_is_admin THEN
    RETURN NEW;
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  SELECT org_id INTO v_user_org_id FROM public.profiles WHERE id = v_user_id;

  v_is_sender    := (OLD.from_org_id IS NOT NULL AND OLD.from_org_id = v_user_org_id);
  v_is_recipient := (
    (v_user_email IS NOT NULL AND OLD.to_email = v_user_email)
    OR (v_user_org_id IS NOT NULL AND OLD.to_org_id = v_user_org_id)
  );

  -- Senders retain their existing broader update surface.
  IF v_is_sender AND NOT v_is_recipient THEN
    RETURN NEW;
  END IF;

  IF NOT v_is_recipient THEN
    RETURN NEW;
  END IF;

  -- Recipient path: routing / payload columns are immutable.
  IF NEW.from_org_id          IS DISTINCT FROM OLD.from_org_id          THEN
    RAISE EXCEPTION 'invite_recipient_immutable: from_org_id cannot be changed by recipients' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.to_org_id            IS DISTINCT FROM OLD.to_org_id            THEN
    RAISE EXCEPTION 'invite_recipient_immutable: to_org_id cannot be changed by recipients' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.to_email             IS DISTINCT FROM OLD.to_email             THEN
    RAISE EXCEPTION 'invite_recipient_immutable: to_email cannot be changed by recipients' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.match_id             IS DISTINCT FROM OLD.match_id             THEN
    RAISE EXCEPTION 'invite_recipient_immutable: match_id cannot be changed by recipients' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.selected_result_data IS DISTINCT FROM OLD.selected_result_data THEN
    RAISE EXCEPTION 'invite_recipient_immutable: selected_result_data cannot be changed by recipients' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id                   IS DISTINCT FROM OLD.id                   THEN
    RAISE EXCEPTION 'invite_recipient_immutable: id cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.created_at           IS DISTINCT FROM OLD.created_at           THEN
    RAISE EXCEPTION 'invite_recipient_immutable: created_at cannot be changed' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invites_recipient_column_immutability_trg ON public.invites;
CREATE TRIGGER invites_recipient_column_immutability_trg
BEFORE UPDATE ON public.invites
FOR EACH ROW
EXECUTE FUNCTION public.assert_invite_recipient_column_immutability();
