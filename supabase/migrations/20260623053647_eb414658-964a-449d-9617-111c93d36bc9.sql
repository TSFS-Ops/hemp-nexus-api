CREATE OR REPLACE FUNCTION public.cron_reconcile_heartbeats()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net'
AS $function$
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
    FROM net._http_response
    WHERE id = r.last_request_id;

    IF NOT FOUND THEN
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
$function$;