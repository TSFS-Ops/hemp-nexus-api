-- ── Backstop: DB trigger writes audit row on every persona change ──
-- This catches programmatic updates (admin tooling, manual SQL, future code paths)
-- that bypass the SPA's audit-insert in Welcome.tsx.

CREATE OR REPLACE FUNCTION public.audit_persona_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when selected_persona actually changes (handles NULL transitions)
  IF NEW.selected_persona IS DISTINCT FROM OLD.selected_persona THEN
    INSERT INTO public.audit_logs (
      org_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      metadata
    ) VALUES (
      COALESCE(NEW.org_id, OLD.org_id),
      auth.uid(),  -- NULL if updated by service role / trigger
      'profile.persona_selected',
      'profile',
      NEW.id,
      jsonb_build_object(
        'persona', NEW.selected_persona,
        'previous_persona', OLD.selected_persona,
        'source', 'db_trigger',
        'changed_at', now()
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_persona_change ON public.profiles;
CREATE TRIGGER trg_audit_persona_change
AFTER UPDATE OF selected_persona ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.audit_persona_change();

-- ── Backfill: write a single audit row for every user who already has a persona ──
-- Marked source='backfill' so analytics can distinguish historical from live events.
INSERT INTO public.audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
SELECT
  p.org_id,
  p.id,
  'profile.persona_selected',
  'profile',
  p.id,
  jsonb_build_object(
    'persona', p.selected_persona,
    'previous_persona', NULL,
    'source', 'backfill',
    'backfilled_at', now()
  )
FROM public.profiles p
WHERE p.selected_persona IS NOT NULL
  AND p.org_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.audit_logs al
    WHERE al.entity_id = p.id
      AND al.action = 'profile.persona_selected'
  );