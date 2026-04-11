-- 1. Add unique constraint to prevent duplicate rate limit windows from concurrent upserts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rate_limits_org_endpoint_window_key'
  ) THEN
    ALTER TABLE public.rate_limits
    ADD CONSTRAINT rate_limits_org_endpoint_window_key
    UNIQUE (org_id, endpoint, window_end);
  END IF;
END $$;

-- 2. Replace increment_rate_limit with atomic check-and-increment
--    Returns the new count if under the limit, or -1 if the limit would be exceeded.
CREATE OR REPLACE FUNCTION public.atomic_check_and_increment_rate_limit(
  p_org_id uuid,
  p_endpoint text,
  p_window_end timestamptz,
  p_limit integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_count integer;
BEGIN
  -- Atomic increment + limit check in a single UPDATE ... RETURNING
  -- The WHERE clause rejects the update if we're already at or above the limit.
  UPDATE rate_limits
  SET request_count = request_count + 1,
      updated_at = now()
  WHERE org_id = p_org_id
    AND endpoint = p_endpoint
    AND window_end = p_window_end
    AND request_count < p_limit
  RETURNING request_count INTO v_new_count;

  IF NOT FOUND THEN
    -- Either (a) no row exists yet, or (b) limit already reached.
    -- Check which case:
    PERFORM 1 FROM rate_limits
    WHERE org_id = p_org_id
      AND endpoint = p_endpoint
      AND window_end = p_window_end;

    IF FOUND THEN
      -- Row exists but count >= limit → rejected
      RETURN -1;
    END IF;

    -- Row doesn't exist → create it with count=1 (handles race with ON CONFLICT)
    INSERT INTO rate_limits (org_id, endpoint, window_start, window_end, request_count)
    VALUES (
      p_org_id,
      p_endpoint,
      p_window_end - interval '1 minute', -- approximate; real window_start set by caller
      p_window_end,
      1
    )
    ON CONFLICT (org_id, endpoint, window_end)
    DO UPDATE SET request_count = rate_limits.request_count + 1, updated_at = now()
    WHERE rate_limits.request_count < p_limit
    RETURNING request_count INTO v_new_count;

    IF NOT FOUND THEN
      -- ON CONFLICT matched but WHERE failed → limit reached
      RETURN -1;
    END IF;
  END IF;

  RETURN v_new_count;
END;
$$;

-- 3. Keep the old function for backward compat but mark it as a simple passthrough
CREATE OR REPLACE FUNCTION public.increment_rate_limit(p_org_id uuid, p_endpoint text, p_window_end timestamp with time zone)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_count integer;
BEGIN
  -- Atomic increment with row-level lock (UPDATE acquires RowExclusiveLock)
  UPDATE rate_limits
  SET request_count = request_count + 1,
      updated_at = now()
  WHERE org_id = p_org_id
    AND endpoint = p_endpoint
    AND window_end = p_window_end
  RETURNING request_count INTO new_count;

  RETURN COALESCE(new_count, 0);
END;
$$;