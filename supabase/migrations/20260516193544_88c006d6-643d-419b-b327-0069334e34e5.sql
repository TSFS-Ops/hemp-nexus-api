
-- ============================================================
-- Batch S — Support/admin manual-intervention hardening
-- ============================================================

-- 1. Tighten RLS so the modern canonical role gates risk items.
DROP POLICY IF EXISTS "Admins can manage risk items" ON public.admin_risk_items;
CREATE POLICY "Platform admins can read risk items"
  ON public.admin_risk_items
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- 2. Guard trigger: block human UPDATE of status/resolved_at unless
--    the controlled resolver (or an audited system job) sets the GUC
--    `app.allow_risk_item_update = 'on'` inside its own transaction.
CREATE OR REPLACE FUNCTION public.assert_risk_item_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bypass text;
BEGIN
  -- Allow non-status / non-resolved_at field updates (e.g. metadata enrichment
  -- by system jobs) without the guard; only gate the audit-sensitive columns.
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.resolved_at IS NOT DISTINCT FROM OLD.resolved_at
     AND NEW.resolved_by IS NOT DISTINCT FROM OLD.resolved_by THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_bypass := current_setting('app.allow_risk_item_update', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass := NULL;
  END;
  IF v_bypass = 'on' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'RISK_ITEM_UPDATE_BLOCKED: use resolve_admin_risk_item to change status/resolved_at'
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS admin_risk_items_update_guard_trg ON public.admin_risk_items;
CREATE TRIGGER admin_risk_items_update_guard_trg
  BEFORE UPDATE ON public.admin_risk_items
  FOR EACH ROW EXECUTE FUNCTION public.assert_risk_item_update_guard();

-- 3. Controlled resolver. Captures before/after, writes admin_audit_logs,
--    flips the GUC for the duration of the UPDATE only.
CREATE OR REPLACE FUNCTION public.resolve_admin_risk_item(
  p_risk_item_id uuid,
  p_new_status text,
  p_reason text,
  p_admin_user_id uuid,
  p_actor_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_request_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before public.admin_risk_items;
  v_after  public.admin_risk_items;
  v_now    timestamptz := now();
BEGIN
  IF p_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_user_id_required';
  END IF;
  IF NOT public.is_admin(p_admin_user_id) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  IF p_new_status NOT IN ('open','investigating','remediated','resolved','dismissed') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  SELECT * INTO v_before FROM public.admin_risk_items WHERE id = p_risk_item_id;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'risk_item_not_found';
  END IF;

  -- Flip the guard locally for this transaction so the trigger allows the
  -- UPDATE. The GUC is transaction-local and never leaks.
  PERFORM set_config('app.allow_risk_item_update', 'on', true);

  UPDATE public.admin_risk_items
     SET status      = p_new_status,
         resolved_at = CASE WHEN p_new_status IN ('resolved','remediated','dismissed')
                            THEN v_now ELSE NULL END,
         resolved_by = CASE WHEN p_new_status IN ('resolved','remediated','dismissed')
                            THEN p_admin_user_id ELSE NULL END,
         updated_at  = v_now
   WHERE id = p_risk_item_id
   RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_logs(
    admin_user_id, action, target_type, target_id, details, user_agent
  ) VALUES (
    p_admin_user_id,
    'admin_risk_item.resolved',
    'admin_risk_item',
    p_risk_item_id,
    jsonb_build_object(
      'reason',     p_reason,
      'before',     to_jsonb(v_before),
      'after',      to_jsonb(v_after),
      'actor_ip',   p_actor_ip,
      'request_id', p_request_id,
      'source',     'resolve_admin_risk_item'
    ),
    p_user_agent
  );

  -- Best-effort notification cascade.
  IF p_new_status IN ('resolved','remediated','dismissed') THEN
    PERFORM public.resolve_notifications_for('admin_risk_item', p_risk_item_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'risk_item_id', p_risk_item_id,
    'previous_status', v_before.status,
    'new_status', v_after.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_admin_risk_item(uuid, text, text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_admin_risk_item(uuid, text, text, uuid, text, text, text) TO service_role;

COMMENT ON FUNCTION public.resolve_admin_risk_item(uuid, text, text, uuid, text, text, text) IS
  'Batch S SUP-003: controlled human resolver for admin_risk_items. Captures before/after, writes admin_audit_logs, cascades notifications. Reason >= 10 chars and platform_admin required.';

COMMENT ON FUNCTION public.assert_risk_item_update_guard() IS
  'Batch S SUP-003: blocks human UPDATE of admin_risk_items.status/resolved_at unless app.allow_risk_item_update=on is set in the same transaction (only the controlled resolver and explicit system jobs do this).';
