-- Atomic success: reset counter, clear disabled flag
CREATE OR REPLACE FUNCTION public.webhook_record_success(p_endpoint_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.webhook_endpoints
     SET consecutive_failures = 0,
         disabled_at = NULL,
         last_delivery_at = now(),
         updated_at = now()
   WHERE id = p_endpoint_id
     AND consecutive_failures > 0;  -- no-op if already at 0 (avoids needless writes)

  -- Always update last_delivery_at even on the no-op path
  UPDATE public.webhook_endpoints
     SET last_delivery_at = now()
   WHERE id = p_endpoint_id
     AND last_delivery_at IS DISTINCT FROM now();
END;
$$;

-- Atomic failure: increment counter, trip breaker at threshold
-- Returns the new counter and whether the breaker tripped
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
BEGIN
  -- Atomic increment using UPDATE ... RETURNING
  UPDATE public.webhook_endpoints
     SET consecutive_failures = consecutive_failures + 1,
         last_delivery_at = now(),
         updated_at = now()
   WHERE id = p_endpoint_id
  RETURNING consecutive_failures INTO v_new_count;

  -- Trip the breaker if threshold crossed
  IF v_new_count >= p_threshold THEN
    UPDATE public.webhook_endpoints
       SET status = 'inactive',
           disabled_at = now(),
           updated_at = now()
     WHERE id = p_endpoint_id
       AND disabled_at IS NULL;

    v_tripped := FOUND;
  END IF;

  RETURN QUERY SELECT v_new_count, v_tripped;
END;
$$;

REVOKE ALL ON FUNCTION public.webhook_record_success(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_record_failure(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webhook_record_success(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.webhook_record_failure(uuid, integer) TO service_role;