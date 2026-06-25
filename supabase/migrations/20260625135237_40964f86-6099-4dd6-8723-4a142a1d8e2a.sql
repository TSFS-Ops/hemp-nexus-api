-- Phase 1: cron_invoke correlation-id hardening (outreach-only witness fallback)
-- Additive only. No business-table mutations, no schedule/active changes.

-- 1) Additive heartbeat correlation columns
ALTER TABLE public.cron_heartbeats
  ADD COLUMN IF NOT EXISTS last_correlation_id uuid NULL,
  ADD COLUMN IF NOT EXISTS last_metadata jsonb NULL;

-- 2) Update public.cron_invoke to inject cron_run_id + cron_job_name and
--    persist correlation id / metadata on the heartbeat. Signature unchanged.
CREATE OR REPLACE FUNCTION public.cron_invoke(
  p_job_name text,
  p_url      text,
  p_body     jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault', 'net'
AS $function$
DECLARE
  v_key      text;
  v_req      bigint;
  v_run_id   uuid := gen_random_uuid();
  v_body     jsonb;
  v_meta     jsonb;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'INTERNAL_CRON_KEY'
  LIMIT 1;

  IF v_key IS NULL THEN
    UPDATE public.cron_heartbeats
       SET last_run_at        = now(),
           last_status        = 'failed',
           last_error         = 'INTERNAL_CRON_KEY missing from vault',
           last_http_status   = NULL,
           last_correlation_id = v_run_id,
           last_metadata      = jsonb_build_object(
             'cron_job_name', p_job_name,
             'url', p_url,
             'missing_secret', true,
             'correlation_written_at', now()
           ),
           updated_at         = now()
     WHERE job_name = p_job_name;
    RETURN NULL;
  END IF;

  v_body := COALESCE(p_body, '{}'::jsonb)
            || jsonb_build_object(
                 'cron_run_id',   v_run_id,
                 'cron_job_name', p_job_name
               );

  SELECT net.http_post(
    url     := p_url,
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-internal-key', v_key
    ),
    body    := v_body
  ) INTO v_req;

  v_meta := jsonb_build_object(
    'cron_job_name',          p_job_name,
    'url',                    p_url,
    'pg_net_request_id',      v_req,
    'correlation_written_at', now()
  );

  INSERT INTO public.cron_heartbeats AS h
    (job_name, last_run_at, last_request_id, last_status,
     last_http_status, last_error, last_correlation_id, last_metadata, updated_at)
  VALUES
    (p_job_name, now(), v_req, 'pending', NULL, NULL, v_run_id, v_meta, now())
  ON CONFLICT (job_name) DO UPDATE
    SET last_run_at         = EXCLUDED.last_run_at,
        last_request_id     = EXCLUDED.last_request_id,
        last_status         = 'pending',
        last_http_status    = NULL,
        last_error          = NULL,
        last_correlation_id = EXCLUDED.last_correlation_id,
        last_metadata       = EXCLUDED.last_metadata,
        updated_at          = now();

  RETURN v_req;
END;
$function$;

-- 3) Update public.cron_reconcile_heartbeats() — add outreach-only edge-witness
--    fallback for pg_net failures when a matching witness row was emitted.
CREATE OR REPLACE FUNCTION public.cron_reconcile_heartbeats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE
  r              record;
  v_status       int;
  v_error        text;
  v_content      text;
  v_existing     uuid;
  v_corr         uuid;
  v_run_at       timestamptz;
  v_meta         jsonb;
  v_witness_seen timestamptz;
BEGIN
  -- a) Resolve pending heartbeats whose pg_net response has landed.
  FOR r IN
    SELECT job_name, last_request_id, last_correlation_id, last_run_at, last_metadata
    FROM public.cron_heartbeats
    WHERE last_status = 'pending'
      AND last_request_id IS NOT NULL
  LOOP
    SELECT status_code, error_msg, content
      INTO v_status, v_error, v_content
    FROM net._http_response
    WHERE id = r.last_request_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_corr   := r.last_correlation_id;
    v_run_at := r.last_run_at;
    v_meta   := COALESCE(r.last_metadata, '{}'::jsonb);
    v_witness_seen := NULL;

    -- Outreach-only edge-witness fallback. Only consult witness when
    -- pg_net reports a transport-level problem (DNS timeout / null / non-2xx).
    IF r.job_name = 'outreach-sla-monitor'
       AND v_corr IS NOT NULL
       AND (v_error IS NOT NULL OR v_status IS NULL OR v_status < 200 OR v_status >= 300)
    THEN
      SELECT created_at
        INTO v_witness_seen
      FROM public.admin_audit_logs
      WHERE action = 'cron.outreach_sla_monitor_tick'
        AND (details->>'cron_run_id') = v_corr::text
        AND (details->>'outcome')     = 'ok'
        AND created_at BETWEEN COALESCE(v_run_at, now()) - interval '1 minute'
                           AND COALESCE(v_run_at, now()) + interval '10 minutes'
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;

    IF v_witness_seen IS NOT NULL THEN
      UPDATE public.cron_heartbeats
         SET last_status      = 'success_with_pg_net_warning',
             last_http_status = v_status,
             last_error       = NULL,
             last_metadata    = v_meta || jsonb_build_object(
               'pg_net_warning',  COALESCE(v_error, format('http_status=%s', COALESCE(v_status::text, 'null'))),
               'witness_action',  'cron.outreach_sla_monitor_tick',
               'witness_seen_at', v_witness_seen,
               'reconciled_via',  'edge_witness'
             ),
             updated_at       = now()
       WHERE job_name = r.job_name;
    ELSIF v_error IS NOT NULL THEN
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
  --    'success_with_pg_net_warning' is NOT treated as failed and does not
  --    open a high-severity risk item; auto-resolve runs the same as 'success'.
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
      ELSIF r.last_status IN ('success', 'success_with_pg_net_warning') THEN
        PERFORM public.system_resolve_cron_risk_items(r.job_name);
      END IF;
    END;
  END LOOP;
END;
$function$;