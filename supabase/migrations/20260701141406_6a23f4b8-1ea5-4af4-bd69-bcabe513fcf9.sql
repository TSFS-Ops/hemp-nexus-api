-- Batch G — webhook auto-disable observability.
-- Preserves the existing behaviour of public.webhook_record_failure
-- (increment counter, trip at threshold, idempotent replays, no backoff change)
-- and adds one audit_logs row, one admin_risk_items row, and per-platform-admin
-- notifications on the trip edge (active -> inactive).

CREATE OR REPLACE FUNCTION public.webhook_record_failure(
  p_endpoint_id uuid,
  p_threshold integer DEFAULT 10
)
RETURNS TABLE(new_consecutive_failures integer, tripped boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_count integer;
  v_tripped boolean := false;
  v_org_id uuid;
  v_url text;
  v_disabled_at timestamptz;
  v_dedup_key text;
BEGIN
  -- Atomic increment
  UPDATE public.webhook_endpoints
     SET consecutive_failures = consecutive_failures + 1,
         last_delivery_at = now(),
         updated_at = now()
   WHERE id = p_endpoint_id
  RETURNING consecutive_failures, org_id, url
    INTO v_new_count, v_org_id, v_url;

  -- Trip the breaker if threshold crossed and not already tripped.
  IF v_new_count >= p_threshold THEN
    UPDATE public.webhook_endpoints
       SET status = 'inactive',
           disabled_at = now(),
           updated_at = now()
     WHERE id = p_endpoint_id
       AND disabled_at IS NULL
    RETURNING disabled_at INTO v_disabled_at;

    v_tripped := FOUND;
  END IF;

  -- On the trip edge only, emit observability. Wrapped in exception blocks so
  -- observability failures never break the atomic counter/state contract.
  IF v_tripped THEN
    BEGIN
      INSERT INTO public.audit_logs (
        org_id, action, entity_type, entity_id, metadata
      ) VALUES (
        v_org_id,
        'webhook.endpoint.auto_disabled',
        'webhook',
        p_endpoint_id,
        jsonb_build_object(
          'endpoint_id', p_endpoint_id,
          'org_id', v_org_id,
          'url', v_url,
          'consecutive_failures', v_new_count,
          'threshold', p_threshold,
          'disabled_at', v_disabled_at
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'webhook_record_failure: audit_logs insert failed: %', SQLERRM;
    END;

    v_dedup_key := 'webhook_auto_disabled:' || p_endpoint_id::text || ':' || COALESCE(v_disabled_at::text, '');
    BEGIN
      INSERT INTO public.admin_risk_items (
        org_id, kind, title, description, severity, status, metadata, dedup_key
      ) VALUES (
        v_org_id,
        'webhook_auto_disabled',
        'Customer webhook endpoint auto-disabled',
        format('Endpoint %s auto-disabled after %s consecutive delivery failures (threshold %s).',
               v_url, v_new_count, p_threshold),
        'warning',
        'open',
        jsonb_build_object(
          'endpoint_id', p_endpoint_id,
          'org_id', v_org_id,
          'url', v_url,
          'consecutive_failures', v_new_count,
          'threshold', p_threshold,
          'disabled_at', v_disabled_at
        ),
        v_dedup_key
      )
      ON CONFLICT (dedup_key) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'webhook_record_failure: admin_risk_items insert failed: %', SQLERRM;
    END;

    -- Best-effort per-platform-admin notification. No-op if user_roles or
    -- notifications shape changes. Idempotent-ish via same disabled_at edge —
    -- trip only fires once per disable cycle.
    BEGIN
      INSERT INTO public.notifications (
        user_id, org_id, type, title, body, link, entity_type, entity_id, is_demo
      )
      SELECT
        ur.user_id,
        v_org_id,
        'webhook_auto_disabled',
        'Customer webhook auto-disabled',
        format('Endpoint %s was auto-disabled after %s consecutive failures.', v_url, v_new_count),
        '/admin/webhooks',
        'webhook',
        p_endpoint_id,
        false
      FROM public.user_roles ur
      WHERE ur.role = 'platform_admin';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'webhook_record_failure: notifications insert failed: %', SQLERRM;
    END;
  END IF;

  RETURN QUERY SELECT v_new_count, v_tripped;
END;
$$;

REVOKE ALL ON FUNCTION public.webhook_record_failure(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webhook_record_failure(uuid, integer) TO service_role;

-- Dedup index for admin_risk_items so ON CONFLICT works (no-op if already exists).
CREATE UNIQUE INDEX IF NOT EXISTS admin_risk_items_dedup_key_unique
  ON public.admin_risk_items (dedup_key)
  WHERE dedup_key IS NOT NULL;