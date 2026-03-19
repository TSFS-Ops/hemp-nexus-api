-- Secure function for org admins to change a team member's role within their org.
-- Enforces: caller must be org_admin of the same org, cannot demote self,
-- cannot assign platform_admin, and logs every change to admin_audit_logs.
CREATE OR REPLACE FUNCTION public.change_org_member_role(
  p_target_user_id uuid,
  p_new_role text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_org_id uuid;
  v_target_org_id uuid;
  v_old_roles text[];
  v_allowed_roles text[] := ARRAY['org_member', 'org_admin'];
BEGIN
  -- Validate new role
  IF p_new_role IS NULL OR NOT (p_new_role = ANY(v_allowed_roles)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_ROLE',
      'message', 'Role must be org_member or org_admin');
  END IF;

  -- Cannot change own role
  IF v_caller_id = p_target_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'SELF_CHANGE',
      'message', 'You cannot change your own role. Ask another admin.');
  END IF;

  -- Get caller's org
  SELECT org_id INTO v_caller_org_id FROM profiles WHERE id = v_caller_id;
  IF v_caller_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_ORG', 'message', 'Caller has no organisation');
  END IF;

  -- Caller must be org_admin or platform_admin
  IF NOT (
    public.is_org_admin(v_caller_id, v_caller_org_id) OR
    public.is_admin(v_caller_id)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN',
      'message', 'Only organisation admins can change roles');
  END IF;

  -- Target must be in same org
  SELECT org_id INTO v_target_org_id FROM profiles WHERE id = p_target_user_id;
  IF v_target_org_id IS NULL OR v_target_org_id != v_caller_org_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_IN_ORG',
      'message', 'User is not a member of your organisation');
  END IF;

  -- Capture old roles for audit
  SELECT array_agg(role::text) INTO v_old_roles
  FROM user_roles WHERE user_id = p_target_user_id;

  -- Remove existing org-level roles (preserve platform_admin if present)
  DELETE FROM user_roles
  WHERE user_id = p_target_user_id
    AND role IN ('org_member', 'org_admin');

  -- Insert new role
  INSERT INTO user_roles (user_id, role)
  VALUES (p_target_user_id, p_new_role::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Ensure org_member always exists (org_admin implies membership)
  IF p_new_role = 'org_admin' THEN
    INSERT INTO user_roles (user_id, role)
    VALUES (p_target_user_id, 'org_member')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  -- Audit log
  INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    v_caller_id,
    'role.changed',
    'user',
    p_target_user_id::text,
    jsonb_build_object(
      'old_roles', v_old_roles,
      'new_role', p_new_role,
      'org_id', v_caller_org_id,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_target_user_id,
    'new_role', p_new_role,
    'old_roles', v_old_roles
  );
END;
$function$;

-- Grant execute to authenticated users only
REVOKE ALL ON FUNCTION public.change_org_member_role(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_org_member_role(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.change_org_member_role(uuid, text, text) TO authenticated