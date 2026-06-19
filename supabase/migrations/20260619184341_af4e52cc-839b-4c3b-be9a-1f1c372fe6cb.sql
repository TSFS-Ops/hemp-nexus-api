
-- ============================================================
-- API Usage Alerts · RBAC tightening
--   View   = platform_admin + api_admin
--   Manage = platform_admin only (unchanged)
--   Auditor: removed from live alert visibility (audit evidence
--            remains in admin_audit_logs).
-- ============================================================

-- 1. New view-gate helper (separate from monitoring helper so
--    auditor retains other monitoring surfaces).
CREATE OR REPLACE FUNCTION public.can_view_api_usage_alerts(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND (
    public.has_role(_user_id, 'platform_admin'::public.app_role)
    OR public.has_role(_user_id, 'api_admin'::public.app_role)
  )
$$;

GRANT EXECUTE ON FUNCTION public.can_view_api_usage_alerts(uuid) TO authenticated;

-- 2. Manage-gate helper (platform_admin only) for clarity.
CREATE OR REPLACE FUNCTION public.can_manage_api_usage_alerts(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
    AND public.has_role(_user_id, 'platform_admin'::public.app_role)
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_api_usage_alerts(uuid) TO authenticated;

-- 3. Replace SELECT policy on api_usage_alerts to use the new view gate.
DROP POLICY IF EXISTS "internal monitors read api usage alerts"
  ON public.api_usage_alerts;

CREATE POLICY "authorised admins read api usage alerts"
  ON public.api_usage_alerts
  FOR SELECT
  TO authenticated
  USING (public.can_view_api_usage_alerts(auth.uid()));

-- 4. Tighten list_api_usage_alerts gate (was: can_access_api_monitoring).
CREATE OR REPLACE FUNCTION public.list_api_usage_alerts(
  p_status text DEFAULT NULL,
  p_environment text DEFAULT NULL,
  p_severity text DEFAULT NULL,
  p_api_client_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_assigned_to uuid DEFAULT NULL
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_nil uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  IF NOT public.can_view_api_usage_alerts(v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', a.id,
    'alert_type', a.alert_type,
    'severity', a.severity,
    'status', a.status,
    'api_client_id', a.api_client_id,
    'api_client_name', c.client_name,
    'api_key_id', a.api_key_id,
    'api_key_alias', k.name,
    'environment', a.environment,
    'trigger_value', a.trigger_value,
    'threshold_value', a.threshold_value,
    'details', a.details,
    'latest_note', a.latest_note,
    'acknowledged_by', a.acknowledged_by,
    'acknowledged_at', a.acknowledged_at,
    'resolved_by', a.resolved_by,
    'resolved_at', a.resolved_at,
    'assigned_to', a.assigned_to,
    'assigned_at', a.assigned_at,
    'assigned_by', a.assigned_by,
    'created_at', a.created_at,
    'updated_at', a.updated_at
  )
  FROM public.api_usage_alerts a
  LEFT JOIN public.api_clients c ON c.id = a.api_client_id
  LEFT JOIN public.api_keys k ON k.id = a.api_key_id
  WHERE (p_status IS NULL OR a.status = p_status)
    AND (p_environment IS NULL OR a.environment = p_environment)
    AND (p_severity IS NULL OR a.severity = p_severity)
    AND (p_api_client_id IS NULL OR a.api_client_id = p_api_client_id)
    AND (
      p_assigned_to IS NULL
      OR (p_assigned_to = v_nil AND a.assigned_to IS NULL)
      OR (p_assigned_to <> v_nil AND a.assigned_to = p_assigned_to)
    )
  ORDER BY
    CASE a.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
    CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
    a.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 200), 1000));
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_api_usage_alerts(text,text,text,uuid,integer,uuid) TO authenticated;

-- 5. Audit the policy change (one-off marker so the tightening is
--    visible in the canonical audit stream).
INSERT INTO public.admin_audit_logs(admin_user_id, action, target_type, target_id, details)
VALUES (
  NULL,
  'api_usage_alert.rbac_tightened',
  'policy',
  NULL,
  jsonb_build_object(
    'view_roles', jsonb_build_array('platform_admin','api_admin'),
    'manage_roles', jsonb_build_array('platform_admin'),
    'auditor_view_revoked', true
  )
);
