-- Audit trigger: log every change to admin_settings.general.maintenanceMode
CREATE OR REPLACE FUNCTION public.log_maintenance_mode_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_mode boolean;
  new_mode boolean;
  new_reason text;
  new_started_at text;
BEGIN
  -- Only act on the 'general' settings row
  IF NEW.key <> 'general' THEN
    RETURN NEW;
  END IF;

  old_mode := COALESCE((OLD.value ->> 'maintenanceMode')::boolean, false);
  new_mode := COALESCE((NEW.value ->> 'maintenanceMode')::boolean, false);

  -- Only log on actual transitions
  IF old_mode IS NOT DISTINCT FROM new_mode THEN
    RETURN NEW;
  END IF;

  new_reason := NEW.value ->> 'maintenanceReason';
  new_started_at := NEW.value ->> 'maintenanceStartedAt';

  INSERT INTO public.admin_audit_logs (
    action,
    target_type,
    target_id,
    admin_user_id,
    details
  ) VALUES (
    CASE WHEN new_mode THEN 'maintenance_mode.enabled' ELSE 'maintenance_mode.disabled' END,
    'platform',
    NULL,
    auth.uid(),
    jsonb_build_object(
      'previous_state', old_mode,
      'new_state', new_mode,
      'reason', new_reason,
      'started_at', new_started_at,
      'changed_at', now()
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_maintenance_mode_change ON public.admin_settings;
CREATE TRIGGER trg_log_maintenance_mode_change
AFTER UPDATE ON public.admin_settings
FOR EACH ROW
WHEN (OLD.value IS DISTINCT FROM NEW.value)
EXECUTE FUNCTION public.log_maintenance_mode_change();