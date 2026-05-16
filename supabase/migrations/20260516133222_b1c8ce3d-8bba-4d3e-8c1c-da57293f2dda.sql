-- OPS-001 Stage 2 — Sentry receiving-events assurance
-- ---------------------------------------------------------------------------
-- Single-row table tracking the last synthetic Sentry heartbeat. Admin-only
-- via RLS. Updated by the `sentry-heartbeat` edge function, which is itself
-- scheduled through the existing cron_invoke wrapper so failures also land
-- in cron_heartbeats.

CREATE TABLE IF NOT EXISTS public.sentry_heartbeats (
  id                 boolean PRIMARY KEY DEFAULT true,  -- enforce single row
  last_attempt_at    timestamptz,
  last_success_at    timestamptz,
  last_status        text NOT NULL DEFAULT 'unknown',
  last_http_status   integer,
  last_error         text,
  last_event_id      text,
  dsn_configured     boolean NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sentry_heartbeats_singleton CHECK (id = true),
  CONSTRAINT sentry_heartbeats_last_status_check CHECK (
    last_status = ANY (ARRAY['unknown','pending','success','failed','dsn_missing'])
  )
);

ALTER TABLE public.sentry_heartbeats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view sentry heartbeats" ON public.sentry_heartbeats;
CREATE POLICY "Admins can view sentry heartbeats"
  ON public.sentry_heartbeats
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Seed singleton row so the HealthBoard tile reads `unknown / dsn_missing`
-- rather than "no row at all" before the first heartbeat fires.
INSERT INTO public.sentry_heartbeats (id, last_status, dsn_configured)
VALUES (true, 'unknown', false)
ON CONFLICT (id) DO NOTHING;

-- Touch trigger.
CREATE OR REPLACE FUNCTION public.touch_sentry_heartbeats_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sentry_heartbeats_touch ON public.sentry_heartbeats;
CREATE TRIGGER sentry_heartbeats_touch
  BEFORE UPDATE ON public.sentry_heartbeats
  FOR EACH ROW EXECUTE FUNCTION public.touch_sentry_heartbeats_updated_at();

-- Seed the cron_heartbeats row so HealthBoard surfaces the cron job too.
INSERT INTO public.cron_heartbeats (job_name, last_status, expected_interval_seconds)
VALUES ('sentry-heartbeat-cron', 'unknown', 900)
ON CONFLICT (job_name) DO UPDATE SET expected_interval_seconds = EXCLUDED.expected_interval_seconds;

-- Schedule the sentry-heartbeat function every 15 minutes through cron_invoke
-- so its cron-side outcome also surfaces in cron_heartbeats.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sentry-heartbeat-cron') THEN
    PERFORM cron.unschedule('sentry-heartbeat-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'sentry-heartbeat-cron',
  '*/15 * * * *',
  $cron$ SELECT public.cron_invoke(
    'sentry-heartbeat-cron',
    'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/sentry-heartbeat',
    jsonb_build_object('time', now(), 'source', 'cron:sentry-heartbeat-cron')
  ); $cron$
);