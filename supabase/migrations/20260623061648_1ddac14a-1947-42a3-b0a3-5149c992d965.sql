
-- 1) Narrow system wrapper: only cron heartbeat reconciler calls this.
CREATE OR REPLACE FUNCTION public.system_resolve_cron_risk_items(p_job_name text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_count int := 0;
  v_ids   uuid[];
BEGIN
  -- Transaction-local bypass of assert_risk_item_update_guard (same mechanism
  -- used by the approved resolve_admin_risk_item function). Never leaks.
  PERFORM set_config('app.allow_risk_item_update', 'on', true);

  WITH updated AS (
    UPDATE public.admin_risk_items
       SET status      = 'resolved',
           resolved_at = now(),
           updated_at  = now()
     WHERE status <> 'resolved'
       AND title IN (
         format('Cron job failed: %s',        p_job_name),
         format('Cron job stale: %s',         p_job_name),
         format('Cron job has never run: %s', p_job_name)
       )
     RETURNING id
  )
  SELECT array_agg(id), count(*) INTO v_ids, v_count FROM updated;

  IF v_count > 0 THEN
    INSERT INTO public.admin_audit_logs(
      admin_user_id, action, target_type, target_id, details
    )
    SELECT NULL,
           'admin_risk_item.auto_resolved',
           'admin_risk_item',
           rid,
           jsonb_build_object(
             'reason',   'heartbeat recovered: ' || p_job_name,
             'source',   'cron_reconcile_heartbeats',
             'job_name', p_job_name
           )
    FROM unnest(v_ids) AS rid;
  END IF;

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.system_resolve_cron_risk_items(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.system_resolve_cron_risk_items(text) FROM anon;
REVOKE ALL ON FUNCTION public.system_resolve_cron_risk_items(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.system_resolve_cron_risk_items(text) TO service_role;

-- 2) Replace ONLY the offending auto-resolve branch in cron_reconcile_heartbeats.
--    Rest of the function (search_path, loop a, loop b open/update paths) is
--    byte-identical to the current definition.
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
        -- Auto-resolve via narrow system wrapper (guard-compliant).
        PERFORM public.system_resolve_cron_risk_items(r.job_name);
      END IF;
    END;
  END LOOP;
END;
$function$;
