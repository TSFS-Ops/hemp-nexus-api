-- Batch M: notifications entity linkage + auto-resolve
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id uuid,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_notifications_entity
  ON public.notifications (entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_unread_user
  ON public.notifications (user_id, read)
  WHERE read = false;

-- Recipient role + policy on dispatch log
ALTER TABLE public.notification_dispatches
  ADD COLUMN IF NOT EXISTS recipient_role text,
  ADD COLUMN IF NOT EXISTS routing_policy_key text;

CREATE INDEX IF NOT EXISTS idx_notif_dispatch_role
  ON public.notification_dispatches (recipient_role)
  WHERE recipient_role IS NOT NULL;

-- Helper: mark all unread notifications for an entity as read+resolved.
CREATE OR REPLACE FUNCTION public.resolve_notifications_for(
  p_entity_type text,
  p_entity_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_entity_type IS NULL OR p_entity_id IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE public.notifications
     SET read = true,
         resolved_at = COALESCE(resolved_at, now())
   WHERE entity_type = p_entity_type
     AND entity_id = p_entity_id
     AND (read = false OR resolved_at IS NULL);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_notifications_for(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_notifications_for(text, uuid) TO service_role;

-- Preference-change audit trigger
CREATE OR REPLACE FUNCTION public.audit_notification_preferences_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_after  jsonb;
  v_actor  uuid;
  v_org    uuid;
BEGIN
  v_before := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE COALESCE(OLD.preferences, '{}'::jsonb) END;
  v_after  := COALESCE(NEW.preferences, '{}'::jsonb);

  IF v_before = v_after THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_actor := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  SELECT org_id INTO v_org FROM public.profiles WHERE id = NEW.user_id LIMIT 1;

  INSERT INTO public.audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    COALESCE(v_org, '00000000-0000-0000-0000-000000000000'::uuid),
    v_actor,
    'notification_preference.changed',
    'notification_preference',
    NEW.user_id,
    jsonb_build_object(
      'before', v_before,
      'after',  v_after,
      'source', CASE WHEN v_actor IS NULL OR v_actor = NEW.user_id THEN 'self' ELSE 'admin' END,
      'target_user_id', NEW.user_id,
      'op', TG_OP
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notification_preferences_audit ON public.notification_preferences;
CREATE TRIGGER trg_notification_preferences_audit
AFTER INSERT OR UPDATE ON public.notification_preferences
FOR EACH ROW EXECUTE FUNCTION public.audit_notification_preferences_change();