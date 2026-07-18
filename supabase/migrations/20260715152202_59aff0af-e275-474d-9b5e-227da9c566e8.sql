
CREATE OR REPLACE FUNCTION public._support_notify_ticket_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key text;
BEGIN
  IF NEW.event_kind NOT IN ('created','customer_message_posted','status_changed','auto_escalated') THEN
    RETURN NEW;
  END IF;
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'INTERNAL_CRON_KEY' LIMIT 1;
  IF v_key IS NULL THEN
    RAISE WARNING 'support-notify skipped: INTERNAL_CRON_KEY not in vault';
    RETURN NEW;
  END IF;
  PERFORM net.http_post(
    url := 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/support-notify',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-key', v_key
    ),
    body := jsonb_build_object('kind','ticket_event','event_id', NEW.id)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'support-notify ticket dispatch failed: %', SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_support_notify_ticket_event ON public.support_ticket_events;
CREATE TRIGGER trg_support_notify_ticket_event
  AFTER INSERT ON public.support_ticket_events
  FOR EACH ROW EXECUTE FUNCTION public._support_notify_ticket_event();

CREATE OR REPLACE FUNCTION public._support_notify_incident_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key text;
BEGIN
  IF NOT NEW.is_public THEN RETURN NEW; END IF;
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'INTERNAL_CRON_KEY' LIMIT 1;
  IF v_key IS NULL THEN
    RAISE WARNING 'support-notify skipped: INTERNAL_CRON_KEY not in vault';
    RETURN NEW;
  END IF;
  PERFORM net.http_post(
    url := 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/support-notify',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-key', v_key
    ),
    body := jsonb_build_object('kind','incident_update','incident_update_id', NEW.id)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'support-notify incident dispatch failed: %', SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_support_notify_incident_update ON public.support_incident_updates;
CREATE TRIGGER trg_support_notify_incident_update
  AFTER INSERT ON public.support_incident_updates
  FOR EACH ROW EXECUTE FUNCTION public._support_notify_incident_update();
