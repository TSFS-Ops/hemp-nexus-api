
-- ── Phase 1 — SMS/WhatsApp Notification Readiness Shell ──
-- No live providers, no credentials, no webhooks, no test sends.

CREATE TABLE public.notification_channel_readiness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL UNIQUE CHECK (channel IN ('in_app','email','sms','whatsapp')),
  status text NOT NULL CHECK (status IN ('active','not_configured','disabled')),
  provider_status text NOT NULL DEFAULT 'not_available' CHECK (provider_status IN ('not_available','configured','unavailable')),
  credentials_status text NOT NULL DEFAULT 'not_configured' CHECK (credentials_status IN ('not_configured','configured')),
  template_status text NOT NULL DEFAULT 'not_approved' CHECK (template_status IN ('not_approved','approved')),
  webhook_status text NOT NULL DEFAULT 'not_configured' CHECK (webhook_status IN ('not_configured','configured')),
  live_sending_enabled boolean NOT NULL DEFAULT false,
  test_send_enabled boolean NOT NULL DEFAULT false,
  safe_label text NOT NULL,
  phase_1_locked boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.notification_channel_readiness TO authenticated;
GRANT ALL ON public.notification_channel_readiness TO service_role;

ALTER TABLE public.notification_channel_readiness ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read channel readiness"
  ON public.notification_channel_readiness FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role)
      OR public.has_role(auth.uid(),'compliance_analyst'::app_role));

CREATE OR REPLACE FUNCTION public.notification_channel_readiness_phase1_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.channel IN ('sms','whatsapp') THEN
    IF NEW.live_sending_enabled THEN
      RAISE EXCEPTION 'phase_1_locked: live_sending_enabled forbidden for % in Phase 1', NEW.channel;
    END IF;
    IF NEW.test_send_enabled THEN
      RAISE EXCEPTION 'phase_1_locked: test_send_enabled forbidden for % in Phase 1', NEW.channel;
    END IF;
    IF NEW.status NOT IN ('not_configured','disabled') THEN
      RAISE EXCEPTION 'phase_1_locked: status must be not_configured or disabled for % in Phase 1', NEW.channel;
    END IF;
    IF NEW.credentials_status <> 'not_configured' THEN
      RAISE EXCEPTION 'phase_1_locked: credentials_status must remain not_configured for % in Phase 1', NEW.channel;
    END IF;
    IF NEW.webhook_status <> 'not_configured' THEN
      RAISE EXCEPTION 'phase_1_locked: webhook_status must remain not_configured for % in Phase 1', NEW.channel;
    END IF;
    IF NEW.provider_status NOT IN ('not_available','unavailable') THEN
      RAISE EXCEPTION 'phase_1_locked: provider_status must remain not_available/unavailable for % in Phase 1', NEW.channel;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notification_channel_readiness_phase1_guard
  BEFORE INSERT OR UPDATE ON public.notification_channel_readiness
  FOR EACH ROW EXECUTE FUNCTION public.notification_channel_readiness_phase1_guard();

INSERT INTO public.notification_channel_readiness (channel,status,safe_label) VALUES
  ('in_app','active','In-app notifications active'),
  ('email','active','Email notifications active'),
  ('sms','not_configured','SMS is not configured. No external message was sent.'),
  ('whatsapp','not_configured','WhatsApp is not configured. No external message was sent.');

CREATE TABLE public.notification_channel_skipped_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('sms','whatsapp','email','in_app')),
  reason text NOT NULL CHECK (reason IN (
    'notification_skipped_provider_not_configured',
    'notification_provider_unavailable',
    'notification_template_not_approved',
    'notification_phone_missing_or_invalid',
    'notification_delivery_failed',
    'notification_suppressed_opt_out',
    'notification_channel_disabled',
    'notification_not_in_phase_1'
  )),
  source_event_type text,
  target_entity_type text,
  target_entity_id uuid,
  masked_contact text,
  fallback_channel text CHECK (fallback_channel IS NULL OR fallback_channel IN ('in_app','email','none')),
  template_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.notification_channel_skipped_events TO authenticated;
GRANT ALL ON public.notification_channel_skipped_events TO service_role;

ALTER TABLE public.notification_channel_skipped_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read skipped events"
  ON public.notification_channel_skipped_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role)
      OR public.has_role(auth.uid(),'compliance_analyst'::app_role));

CREATE OR REPLACE FUNCTION public.notification_skipped_event_mask_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.masked_contact IS NOT NULL AND NEW.masked_contact ~ '^\+?[0-9]{8,}$' THEN
    RAISE EXCEPTION 'masked_contact must be masked (no raw phone numbers in notification audit)';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notification_skipped_event_mask_guard
  BEFORE INSERT OR UPDATE ON public.notification_channel_skipped_events
  FOR EACH ROW EXECUTE FUNCTION public.notification_skipped_event_mask_guard();

CREATE TABLE public.manual_outreach_contact_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  case_type text NOT NULL DEFAULT 'unknown_counterparty_facilitation'
    CHECK (case_type = 'unknown_counterparty_facilitation'),
  contact_method text NOT NULL CHECK (contact_method IN ('sms','whatsapp','phone_call','in_person','other')),
  manual_channel_used text NOT NULL,
  contact_role text NOT NULL,
  masked_contact text NOT NULL,
  contacted_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL,
  admin_note text,
  next_action text,
  engagement_complete boolean NOT NULL DEFAULT false,
  evidence_reference text,
  display_label text NOT NULL DEFAULT 'Izenzo logged manual contact outside the platform. This is not a system-sent message.',
  logged_by uuid NOT NULL REFERENCES auth.users(id),
  logged_by_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.manual_outreach_contact_logs TO authenticated;
GRANT ALL ON public.manual_outreach_contact_logs TO service_role;

ALTER TABLE public.manual_outreach_contact_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read manual outreach logs"
  ON public.manual_outreach_contact_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role)
      OR public.has_role(auth.uid(),'compliance_analyst'::app_role));

CREATE OR REPLACE FUNCTION public.manual_outreach_contact_log_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.logged_by_role NOT IN ('platform_admin','support_admin') THEN
    RAISE EXCEPTION 'manual_outreach_contact_log: logged_by_role must be platform_admin or support_admin (got %)', NEW.logged_by_role;
  END IF;
  IF NEW.masked_contact ~ '^\+?[0-9]{8,}$' THEN
    RAISE EXCEPTION 'manual_outreach_contact_log: masked_contact must be masked';
  END IF;
  IF NEW.display_label NOT LIKE 'Izenzo logged manual contact outside the platform%' THEN
    RAISE EXCEPTION 'manual_outreach_contact_log: display_label must use the canonical safe label';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_manual_outreach_contact_log_guard
  BEFORE INSERT OR UPDATE ON public.manual_outreach_contact_logs
  FOR EACH ROW EXECUTE FUNCTION public.manual_outreach_contact_log_guard();

CREATE TABLE public.notification_channel_consent_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid,
  channel text NOT NULL CHECK (channel IN ('sms','whatsapp','email','in_app')),
  consent_granted boolean NOT NULL DEFAULT false,
  consent_source text,
  consent_actor uuid REFERENCES auth.users(id),
  consent_wording_version text,
  consent_at timestamptz,
  opted_out boolean NOT NULL DEFAULT false,
  suppression_reason text,
  suppression_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id, channel)
);

GRANT SELECT ON public.notification_channel_consent_states TO authenticated;
GRANT ALL ON public.notification_channel_consent_states TO service_role;

ALTER TABLE public.notification_channel_consent_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "self or admin read consent state"
  ON public.notification_channel_consent_states FOR SELECT TO authenticated
  USING (user_id = auth.uid()
      OR public.has_role(auth.uid(),'platform_admin'::app_role)
      OR public.has_role(auth.uid(),'compliance_analyst'::app_role));

CREATE OR REPLACE FUNCTION public.notification_channel_consent_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_notification_channel_consent_touch
  BEFORE UPDATE ON public.notification_channel_consent_states
  FOR EACH ROW EXECUTE FUNCTION public.notification_channel_consent_touch();
