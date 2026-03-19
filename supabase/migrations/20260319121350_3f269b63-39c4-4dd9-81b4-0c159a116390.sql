
CREATE OR REPLACE FUNCTION public.audit_dispute_status_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.audit_logs (
      org_id,
      entity_type,
      entity_id,
      action,
      actor_user_id,
      metadata
    ) VALUES (
      NEW.raised_by_org_id,
      'dispute',
      NEW.id,
      'dispute.' || NEW.status,
      NEW.resolved_by,
      jsonb_build_object(
        'match_id', NEW.match_id,
        'previous_status', OLD.status,
        'new_status', NEW.status,
        'resolution_outcome', NEW.resolution_outcome
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_dispute_status_change
  AFTER UPDATE ON public.disputes
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_dispute_status_change();
