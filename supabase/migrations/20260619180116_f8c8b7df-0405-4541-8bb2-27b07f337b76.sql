
-- ============================================================
-- Batch 4 follow-up · Alert assignment / ownership
-- ============================================================

ALTER TABLE public.api_usage_alerts
  ADD COLUMN IF NOT EXISTS assigned_to uuid NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS assigned_by uuid NULL;

CREATE INDEX IF NOT EXISTS api_usage_alerts_assigned_to_idx
  ON public.api_usage_alerts(assigned_to)
  WHERE assigned_to IS NOT NULL;

-- ── list RPC: add assignment fields + p_assigned_to filter ───
CREATE OR REPLACE FUNCTION public.list_api_usage_alerts(
  p_status text DEFAULT NULL,
  p_environment text DEFAULT NULL,
  p_severity text DEFAULT NULL,
  p_api_client_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_assigned_to uuid DEFAULT NULL  -- NULL = any; nil-uuid = unassigned only; uuid = that owner
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
  IF NOT public.can_access_api_monitoring(v_uid) THEN
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

-- ── assign RPC (platform_admin only) ─────────────────────────
CREATE OR REPLACE FUNCTION public.assign_api_usage_alert(
  p_alert_id uuid,
  p_assignee uuid DEFAULT NULL,    -- NULL = unassign
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prev uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'platform_admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT assigned_to INTO v_prev FROM public.api_usage_alerts WHERE id = p_alert_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'alert not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.api_usage_alerts
     SET assigned_to = p_assignee,
         assigned_at = CASE WHEN p_assignee IS NULL THEN NULL ELSE now() END,
         assigned_by = CASE WHEN p_assignee IS NULL THEN NULL ELSE v_uid END,
         latest_note = COALESCE(left(p_note, 1000), latest_note)
   WHERE id = p_alert_id;

  INSERT INTO public.admin_audit_logs(admin_user_id, action, target_type, target_id, details)
  VALUES (
    v_uid,
    CASE WHEN p_assignee IS NULL THEN 'api_usage_alert.unassigned'
         ELSE 'api_usage_alert.assigned' END,
    'api_usage_alert',
    p_alert_id,
    jsonb_build_object(
      'previous_assignee', v_prev,
      'new_assignee', p_assignee,
      'self_claim', (p_assignee IS NOT NULL AND p_assignee = v_uid),
      'note_present', p_note IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'id', p_alert_id,
    'assigned_to', p_assignee,
    'status', CASE WHEN p_assignee IS NULL THEN 'unassigned' ELSE 'assigned' END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_api_usage_alert(uuid,uuid,text) TO authenticated;
