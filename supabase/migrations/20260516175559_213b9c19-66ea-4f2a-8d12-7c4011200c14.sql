
-- ── 1. prevent_last_admin_removal trigger ──────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_last_admin_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_other_admins int;
  v_active_members int;
  v_bypass text;
BEGIN
  -- Only care about org_admin going away
  IF TG_OP = 'UPDATE' THEN
    IF OLD.role <> 'org_admin' OR NEW.role = 'org_admin' THEN
      RETURN NEW;
    END IF;
    v_user_id := OLD.user_id;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.role <> 'org_admin' THEN
      RETURN OLD;
    END IF;
    v_user_id := OLD.user_id;
  ELSE
    RETURN NEW;
  END IF;

  -- Explicit bypass for atomic transfer RPC (set LOCAL only)
  BEGIN
    v_bypass := current_setting('app.allow_admin_transfer', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass := NULL;
  END;
  IF v_bypass = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT org_id INTO v_org_id FROM profiles WHERE id = v_user_id;
  IF v_org_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- How many *other* org_admins exist in this org?
  SELECT COUNT(*) INTO v_other_admins
  FROM user_roles ur
  JOIN profiles p ON p.id = ur.user_id
  WHERE p.org_id = v_org_id
    AND ur.role = 'org_admin'
    AND ur.user_id <> v_user_id;

  IF v_other_admins > 0 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- No other admin. Are there still active members in the org (excluding this user)?
  SELECT COUNT(*) INTO v_active_members
  FROM profiles
  WHERE org_id = v_org_id
    AND id <> v_user_id
    AND COALESCE(status, 'active') NOT IN ('pending_deletion', 'deleted');

  IF v_active_members > 0 THEN
    RAISE EXCEPTION
      'LAST_ADMIN: cannot remove or demote the only organisation admin while the organisation still has % active member(s). Use transfer_org_admin to hand over admin rights first.', v_active_members
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS prevent_last_admin_removal_trg ON public.user_roles;
CREATE TRIGGER prevent_last_admin_removal_trg
BEFORE DELETE OR UPDATE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_last_admin_removal();


-- ── 2. profiles.org_id membership audit ────────────────────────────
CREATE OR REPLACE FUNCTION public.log_membership_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_actor_claim text;
  v_source text;
BEGIN
  IF OLD.org_id IS NOT DISTINCT FROM NEW.org_id THEN
    RETURN NEW;
  END IF;

  -- Best-effort actor resolution
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    BEGIN
      v_actor_claim := current_setting('app.actor_user_id', true);
      IF v_actor_claim IS NOT NULL AND v_actor_claim <> '' THEN
        v_actor := v_actor_claim::uuid;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_actor := NULL;
    END;
  END IF;

  BEGIN
    v_source := current_setting('app.actor_source', true);
  EXCEPTION WHEN OTHERS THEN
    v_source := NULL;
  END;

  INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    v_actor,
    'membership.changed',
    'user',
    NEW.id,
    jsonb_build_object(
      'user_id', NEW.id,
      'old_org_id', OLD.org_id,
      'new_org_id', NEW.org_id,
      'actor_user_id', v_actor,
      'source', COALESCE(v_source, 'direct'),
      'changed_at', now()
    )
  );

  -- Notify affected user
  BEGIN
    INSERT INTO notifications (user_id, org_id, type, title, body, link)
    VALUES (
      NEW.id,
      NEW.org_id,
      'membership.changed',
      'Your organisation membership changed',
      'Your access to organisation data has been updated by an administrator. Please refresh your session.',
      '/desk/settings'
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS log_membership_change_trg ON public.profiles;
CREATE TRIGGER log_membership_change_trg
AFTER UPDATE OF org_id ON public.profiles
FOR EACH ROW
WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
EXECUTE FUNCTION public.log_membership_change();


-- ── 3. Atomic admin transfer RPC ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_org_admin(
  p_to_user_id uuid,
  p_reason text,
  p_demote_self boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_org uuid;
  v_target_org uuid;
  v_caller_is_admin boolean;
  v_caller_is_platform boolean;
  v_target_already_admin boolean;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  IF p_to_user_id IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) < 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'REASON_REQUIRED',
      'message', 'A reason (>=4 chars) is required to transfer admin rights.');
  END IF;
  IF p_to_user_id = v_caller AND NOT p_demote_self THEN
    RETURN jsonb_build_object('success', false, 'error', 'SELF_TARGET',
      'message', 'Use change_org_member_role to modify your own role.');
  END IF;

  SELECT org_id INTO v_caller_org FROM profiles WHERE id = v_caller;
  SELECT org_id INTO v_target_org FROM profiles WHERE id = p_to_user_id;

  IF v_caller_org IS NULL OR v_target_org IS NULL OR v_caller_org <> v_target_org THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_IN_ORG',
      'message', 'Target user must be in the same organisation.');
  END IF;

  v_caller_is_admin := public.is_org_admin(v_caller, v_caller_org);
  v_caller_is_platform := public.is_admin(v_caller);
  IF NOT (v_caller_is_admin OR v_caller_is_platform) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = p_to_user_id AND role = 'org_admin'
  ) INTO v_target_already_admin;

  -- Promote target first (org_member ensured too)
  INSERT INTO user_roles (user_id, role) VALUES (p_to_user_id, 'org_admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO user_roles (user_id, role) VALUES (p_to_user_id, 'org_member')
    ON CONFLICT (user_id, role) DO NOTHING;

  -- Optionally demote caller. Use bypass GUC because trigger would otherwise
  -- block "last admin demotion" check until it re-verifies post-promotion.
  IF p_demote_self AND v_caller_is_admin THEN
    PERFORM set_config('app.allow_admin_transfer', 'on', true);
    DELETE FROM user_roles
      WHERE user_id = v_caller AND role = 'org_admin';
    -- Re-verify post-condition: at least one admin must remain
    IF NOT EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN profiles p ON p.id = ur.user_id
      WHERE p.org_id = v_caller_org AND ur.role = 'org_admin'
    ) THEN
      RAISE EXCEPTION 'TRANSFER_FAILED_NO_ADMIN' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    v_caller,
    'role.admin_transferred',
    'user',
    p_to_user_id,
    jsonb_build_object(
      'org_id', v_caller_org,
      'from_user_id', v_caller,
      'to_user_id', p_to_user_id,
      'target_was_admin', v_target_already_admin,
      'self_demoted', p_demote_self,
      'reason', p_reason
    )
  );

  -- Notifications
  BEGIN
    INSERT INTO notifications (user_id, org_id, type, title, body, link)
    VALUES (
      p_to_user_id, v_caller_org, 'role.changed',
      'You are now an organisation admin',
      'You have been granted organisation admin rights.',
      '/desk/settings'
    );
    IF p_demote_self THEN
      INSERT INTO notifications (user_id, org_id, type, title, body, link)
      VALUES (
        v_caller, v_caller_org, 'role.changed',
        'You stepped down as organisation admin',
        'You handed over admin rights and are now an organisation member.',
        '/desk/settings'
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'to_user_id', p_to_user_id,
    'self_demoted', p_demote_self
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_org_admin(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_org_admin(uuid, text, boolean) TO authenticated;


-- ── 4. Strengthen change_org_member_role ───────────────────────────
CREATE OR REPLACE FUNCTION public.change_org_member_role(
  p_target_user_id uuid,
  p_new_role text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_org_id uuid;
  v_target_org_id uuid;
  v_old_roles text[];
  v_is_demotion boolean;
  v_allowed_roles text[] := ARRAY['org_member', 'org_admin'];
  v_claims jsonb;
  v_aal text;
  v_jwt_role text;
BEGIN
  IF p_new_role IS NULL OR NOT (p_new_role = ANY(v_allowed_roles)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_ROLE',
      'message', 'Role must be org_member or org_admin');
  END IF;

  IF v_caller_id = p_target_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'SELF_CHANGE',
      'message', 'You cannot change your own role. Ask another admin or use transfer_org_admin.');
  END IF;

  SELECT org_id INTO v_caller_org_id FROM profiles WHERE id = v_caller_id;
  IF v_caller_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_ORG');
  END IF;

  IF NOT (public.is_org_admin(v_caller_id, v_caller_org_id) OR public.is_admin(v_caller_id)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT org_id INTO v_target_org_id FROM profiles WHERE id = p_target_user_id;
  IF v_target_org_id IS NULL OR v_target_org_id <> v_caller_org_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_IN_ORG');
  END IF;

  SELECT array_agg(role::text ORDER BY role::text) INTO v_old_roles
  FROM user_roles WHERE user_id = p_target_user_id;

  v_is_demotion := ('org_admin' = ANY(COALESCE(v_old_roles, ARRAY[]::text[])))
                   AND p_new_role = 'org_member';

  -- Require reason for demotion
  IF v_is_demotion AND (p_reason IS NULL OR length(btrim(p_reason)) < 4) THEN
    RETURN jsonb_build_object('success', false, 'error', 'REASON_REQUIRED',
      'message', 'A reason (>=4 chars) is required to demote an organisation admin.');
  END IF;

  -- Require AAL2 for demotion when called from an end-user JWT
  IF v_is_demotion THEN
    BEGIN
      v_claims := current_setting('request.jwt.claims', true)::jsonb;
    EXCEPTION WHEN OTHERS THEN v_claims := NULL;
    END;
    v_jwt_role := COALESCE(v_claims ->> 'role', '');
    v_aal := COALESCE(v_claims ->> 'aal', '');
    IF v_claims IS NOT NULL
       AND v_jwt_role NOT IN ('service_role', 'postgres', 'supabase_admin')
       AND v_aal <> 'aal2' THEN
      RETURN jsonb_build_object('success', false, 'error', 'MFA_REQUIRED',
        'message', 'Demoting an organisation admin requires multi-factor authentication. Complete an MFA challenge and retry.');
    END IF;
  END IF;

  DELETE FROM user_roles
  WHERE user_id = p_target_user_id
    AND role IN ('org_member', 'org_admin');

  INSERT INTO user_roles (user_id, role)
  VALUES (p_target_user_id, p_new_role::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  IF p_new_role = 'org_admin' THEN
    INSERT INTO user_roles (user_id, role)
    VALUES (p_target_user_id, 'org_member')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    v_caller_id,
    'role.changed',
    'user',
    p_target_user_id,
    jsonb_build_object(
      'old_roles', v_old_roles,
      'new_roles', ARRAY[p_new_role] ||
                   CASE WHEN p_new_role = 'org_admin' THEN ARRAY['org_member'] ELSE ARRAY[]::text[] END,
      'is_demotion', v_is_demotion,
      'org_id', v_caller_org_id,
      'actor_org_id', v_caller_org_id,
      'target_org_id', v_target_org_id,
      'reason', p_reason
    )
  );

  -- Notify affected user
  BEGIN
    INSERT INTO notifications (user_id, org_id, type, title, body, link)
    VALUES (
      p_target_user_id, v_caller_org_id, 'role.changed',
      CASE WHEN v_is_demotion THEN 'Your role was changed to organisation member'
           ELSE 'Your role was updated' END,
      'An administrator updated your role in the organisation. If this was unexpected, contact your organisation admin or support.',
      '/desk/settings'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_target_user_id,
    'new_role', p_new_role,
    'old_roles', v_old_roles,
    'is_demotion', v_is_demotion
  );
END;
$$;
