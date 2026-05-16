
-- ===========================================================================
-- Batch A Stage 1 — operational truthfulness backbone
-- ===========================================================================

-- 1. Heartbeat table -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cron_heartbeats (
  job_name                  text PRIMARY KEY,
  last_run_at               timestamptz,
  last_request_id           bigint,
  last_http_status          int,
  last_status               text NOT NULL DEFAULT 'unknown'
                            CHECK (last_status IN ('unknown','pending','success','failed')),
  last_error                text,
  expected_interval_seconds int NOT NULL DEFAULT 3600,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cron_heartbeats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view cron heartbeats" ON public.cron_heartbeats;
CREATE POLICY "Admins can view cron heartbeats"
  ON public.cron_heartbeats
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Seed rows so HealthBoard can render "never run" without a NULL hole.
INSERT INTO public.cron_heartbeats (job_name, expected_interval_seconds)
VALUES
  ('webhook-retry-job',               300),
  ('engagement-reminder-daily',       86400),
  ('burn-poi-reconciliation-daily',   86400),
  ('infra-alerts-cron',               300),
  ('cron-heartbeat-reconcile',        60)
ON CONFLICT (job_name) DO NOTHING;

-- 2. cron_invoke wrapper ---------------------------------------------------
-- Writes a heartbeat row marked 'pending' and dispatches the HTTP call
-- through pg_net. The reconciler below resolves it to success/failed.
CREATE OR REPLACE FUNCTION public.cron_invoke(
  p_job_name text,
  p_url      text,
  p_body     jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_key text;
  v_req bigint;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'INTERNAL_CRON_KEY'
  LIMIT 1;

  IF v_key IS NULL THEN
    UPDATE public.cron_heartbeats
       SET last_run_at  = now(),
           last_status  = 'failed',
           last_error   = 'INTERNAL_CRON_KEY missing from vault',
           last_http_status = NULL,
           updated_at   = now()
     WHERE job_name = p_job_name;
    RETURN NULL;
  END IF;

  SELECT extensions.net.http_post(
    url     := p_url,
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-internal-key', v_key
    ),
    body    := COALESCE(p_body, '{}'::jsonb)
  ) INTO v_req;

  INSERT INTO public.cron_heartbeats AS h
    (job_name, last_run_at, last_request_id, last_status,
     last_http_status, last_error, updated_at)
  VALUES
    (p_job_name, now(), v_req, 'pending', NULL, NULL, now())
  ON CONFLICT (job_name) DO UPDATE
    SET last_run_at      = EXCLUDED.last_run_at,
        last_request_id  = EXCLUDED.last_request_id,
        last_status      = 'pending',
        last_http_status = NULL,
        last_error       = NULL,
        updated_at       = now();

  RETURN v_req;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_invoke(text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- 3. Reconciler ------------------------------------------------------------
-- Resolves pending heartbeats by reading the real pg_net response row,
-- and opens an admin risk item for any non-2xx, errored, or stale run.
CREATE OR REPLACE FUNCTION public.cron_reconcile_heartbeats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r           record;
  v_status    int;
  v_error     text;
  v_content   text;
  v_existing  uuid;
BEGIN
  -- a) Resolve pending heartbeats whose pg_net response has landed.
  FOR r IN
    SELECT job_name, last_request_id
    FROM public.cron_heartbeats
    WHERE last_status = 'pending'
      AND last_request_id IS NOT NULL
  LOOP
    SELECT status_code, error_msg, content
      INTO v_status, v_error, v_content
    FROM extensions.net._http_response
    WHERE id = r.last_request_id;

    IF NOT FOUND THEN
      -- Response not yet recorded. Leave pending; staleness check below
      -- will eventually flag it if the request never lands.
      CONTINUE;
    END IF;

    IF v_error IS NOT NULL THEN
      UPDATE public.cron_heartbeats
         SET last_status      = 'failed',
             last_http_status = v_status,
             last_error       = v_error,
             updated_at       = now()
       WHERE job_name = r.job_name;
    ELSIF v_status IS NULL OR v_status < 200 OR v_status >= 300 THEN
      UPDATE public.cron_heartbeats
         SET last_status      = 'failed',
             last_http_status = v_status,
             last_error       = LEFT(COALESCE(v_content, ''), 500),
             updated_at       = now()
       WHERE job_name = r.job_name;
    ELSE
      UPDATE public.cron_heartbeats
         SET last_status      = 'success',
             last_http_status = v_status,
             last_error       = NULL,
             updated_at       = now()
       WHERE job_name = r.job_name;
    END IF;
  END LOOP;

  -- b) Raise risk items for failed or stale jobs (no duplicate while open).
  FOR r IN
    SELECT job_name, last_status, last_http_status, last_error, last_run_at,
           expected_interval_seconds
    FROM public.cron_heartbeats
  LOOP
    DECLARE
      v_title       text;
      v_description text;
      v_severity    text;
      v_should_open boolean := false;
      v_stale_secs  int;
    BEGIN
      v_stale_secs := EXTRACT(EPOCH FROM (now() - COALESCE(r.last_run_at, now() - interval '10 years')))::int;

      IF r.last_status = 'failed' THEN
        v_should_open := true;
        v_title       := format('Cron job failed: %s', r.job_name);
        v_description := format(
          'Edge invocation returned HTTP %s. Error: %s',
          COALESCE(r.last_http_status::text, 'unknown'),
          COALESCE(r.last_error, '(no body)')
        );
        v_severity := CASE
          WHEN r.last_http_status IN (401, 403) THEN 'high'
          WHEN r.last_http_status IS NULL OR r.last_http_status >= 500 THEN 'high'
          ELSE 'medium'
        END;
      ELSIF r.last_run_at IS NULL THEN
        IF r.job_name <> 'cron-heartbeat-reconcile' THEN
          v_should_open := true;
          v_title       := format('Cron job has never run: %s', r.job_name);
          v_description := 'No heartbeat recorded since deploy. Verify pg_cron schedule.';
          v_severity    := 'medium';
        END IF;
      ELSIF v_stale_secs > (r.expected_interval_seconds * 2) THEN
        v_should_open := true;
        v_title       := format('Cron job stale: %s', r.job_name);
        v_description := format(
          'Last heartbeat %s seconds ago (expected every %s seconds).',
          v_stale_secs, r.expected_interval_seconds
        );
        v_severity := 'high';
      END IF;

      IF v_should_open THEN
        SELECT id INTO v_existing
        FROM public.admin_risk_items
        WHERE title = v_title AND status <> 'resolved'
        LIMIT 1;

        IF v_existing IS NULL THEN
          INSERT INTO public.admin_risk_items (title, description, severity, status)
          VALUES (v_title, v_description, v_severity, 'open');
        ELSE
          UPDATE public.admin_risk_items
             SET description = v_description,
                 severity    = v_severity,
                 updated_at  = now()
           WHERE id = v_existing;
        END IF;
      ELSIF r.last_status = 'success' THEN
        -- Auto-resolve any open risk items for this job that we previously opened.
        UPDATE public.admin_risk_items
           SET status      = 'resolved',
               resolved_at = now(),
               updated_at  = now()
         WHERE status <> 'resolved'
           AND (
             title = format('Cron job failed: %s',          r.job_name) OR
             title = format('Cron job stale: %s',           r.job_name) OR
             title = format('Cron job has never run: %s',   r.job_name)
           );
      END IF;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_reconcile_heartbeats() FROM PUBLIC, anon, authenticated;

-- 4. Reschedule existing jobs through the wrapper --------------------------
DO $$
DECLARE j text;
BEGIN
  FOR j IN SELECT unnest(ARRAY[
    'webhook-retry-job',
    'engagement-reminder-daily',
    'burn-poi-reconciliation-daily',
    'infra-alerts-cron',
    'cron-heartbeat-reconcile'
  ]) LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.unschedule(j);
    END IF;
  END LOOP;
END $$;

SELECT cron.schedule(
  'webhook-retry-job',
  '*/5 * * * *',
  $cron$ SELECT public.cron_invoke(
    'webhook-retry-job',
    'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/webhook-retry',
    jsonb_build_object('time', now(), 'source', 'cron:webhook-retry-job')
  ); $cron$
);

SELECT cron.schedule(
  'engagement-reminder-daily',
  '0 6 * * *',
  $cron$ SELECT public.cron_invoke(
    'engagement-reminder-daily',
    'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/engagement-reminder',
    jsonb_build_object('time', now(), 'source', 'cron:engagement-reminder-daily')
  ); $cron$
);

SELECT cron.schedule(
  'burn-poi-reconciliation-daily',
  '30 3 * * *',
  $cron$ SELECT public.cron_invoke(
    'burn-poi-reconciliation-daily',
    'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/burn-poi-reconciliation',
    jsonb_build_object('time', now(), 'source', 'cron:burn-poi-reconciliation-daily',
                       'window_days', 7, 'open_risk_items', true)
  ); $cron$
);

SELECT cron.schedule(
  'infra-alerts-cron',
  '*/5 * * * *',
  $cron$ SELECT public.cron_invoke(
    'infra-alerts-cron',
    'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/infra-alerts',
    jsonb_build_object('time', now(), 'source', 'cron:infra-alerts-cron')
  ); $cron$
);

SELECT cron.schedule(
  'cron-heartbeat-reconcile',
  '* * * * *',
  $cron$ SELECT public.cron_reconcile_heartbeats(); $cron$
);
