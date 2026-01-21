-- Create table to track failed authentication attempts for rate limiting
CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL, -- IP address or API key prefix
  identifier_type text NOT NULL CHECK (identifier_type IN ('ip', 'api_key_prefix')),
  failed_attempts integer NOT NULL DEFAULT 0,
  last_failed_at timestamp with time zone,
  locked_until timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (identifier, identifier_type)
);

-- Enable RLS
ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;

-- Only service role can manage auth rate limits
CREATE POLICY "Service role can manage auth rate limits"
ON public.auth_rate_limits FOR ALL
USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text)
WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_identifier 
ON public.auth_rate_limits(identifier, identifier_type);

-- Create index for cleanup of old records
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_updated_at 
ON public.auth_rate_limits(updated_at);

-- Function to atomically increment failed attempts and check lockout
CREATE OR REPLACE FUNCTION public.check_and_increment_auth_failure(
  p_identifier text,
  p_identifier_type text,
  p_max_attempts integer DEFAULT 5,
  p_base_lockout_seconds integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record auth_rate_limits%ROWTYPE;
  v_lockout_seconds integer;
  v_now timestamp with time zone := now();
BEGIN
  -- Upsert the record
  INSERT INTO auth_rate_limits (identifier, identifier_type, failed_attempts, last_failed_at, updated_at)
  VALUES (p_identifier, p_identifier_type, 1, v_now, v_now)
  ON CONFLICT (identifier, identifier_type) 
  DO UPDATE SET 
    failed_attempts = CASE 
      -- Reset if lockout has expired
      WHEN auth_rate_limits.locked_until IS NOT NULL AND auth_rate_limits.locked_until < v_now THEN 1
      -- Reset if last failure was more than 1 hour ago
      WHEN auth_rate_limits.last_failed_at < v_now - interval '1 hour' THEN 1
      ELSE auth_rate_limits.failed_attempts + 1
    END,
    last_failed_at = v_now,
    locked_until = CASE 
      -- Reset lockout if it has expired
      WHEN auth_rate_limits.locked_until IS NOT NULL AND auth_rate_limits.locked_until < v_now THEN NULL
      ELSE auth_rate_limits.locked_until
    END,
    updated_at = v_now
  RETURNING * INTO v_record;
  
  -- Check if we need to apply a new lockout (exponential backoff)
  IF v_record.failed_attempts >= p_max_attempts AND (v_record.locked_until IS NULL OR v_record.locked_until < v_now) THEN
    -- Calculate lockout time with exponential backoff: base * 2^(attempts/max - 1)
    -- 5 fails = 60s, 10 fails = 120s, 15 fails = 240s, etc.
    v_lockout_seconds := p_base_lockout_seconds * power(2, (v_record.failed_attempts / p_max_attempts) - 1);
    -- Cap at 1 hour
    v_lockout_seconds := LEAST(v_lockout_seconds, 3600);
    
    UPDATE auth_rate_limits 
    SET locked_until = v_now + (v_lockout_seconds || ' seconds')::interval
    WHERE id = v_record.id
    RETURNING * INTO v_record;
  END IF;
  
  RETURN jsonb_build_object(
    'failed_attempts', v_record.failed_attempts,
    'locked_until', v_record.locked_until,
    'is_locked', v_record.locked_until IS NOT NULL AND v_record.locked_until > v_now,
    'lockout_remaining_seconds', CASE 
      WHEN v_record.locked_until IS NOT NULL AND v_record.locked_until > v_now 
      THEN EXTRACT(EPOCH FROM (v_record.locked_until - v_now))::integer
      ELSE 0
    END
  );
END;
$$;

-- Function to check if an identifier is currently locked out
CREATE OR REPLACE FUNCTION public.check_auth_lockout(
  p_identifier text,
  p_identifier_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record auth_rate_limits%ROWTYPE;
  v_now timestamp with time zone := now();
BEGIN
  SELECT * INTO v_record
  FROM auth_rate_limits
  WHERE identifier = p_identifier AND identifier_type = p_identifier_type;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_locked', false, 'failed_attempts', 0);
  END IF;
  
  RETURN jsonb_build_object(
    'failed_attempts', v_record.failed_attempts,
    'locked_until', v_record.locked_until,
    'is_locked', v_record.locked_until IS NOT NULL AND v_record.locked_until > v_now,
    'lockout_remaining_seconds', CASE 
      WHEN v_record.locked_until IS NOT NULL AND v_record.locked_until > v_now 
      THEN EXTRACT(EPOCH FROM (v_record.locked_until - v_now))::integer
      ELSE 0
    END
  );
END;
$$;

-- Function to reset auth rate limit on successful authentication
CREATE OR REPLACE FUNCTION public.reset_auth_rate_limit(
  p_identifier text,
  p_identifier_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM auth_rate_limits 
  WHERE identifier = p_identifier AND identifier_type = p_identifier_type;
END;
$$;

-- Cleanup function for old records (to be called by cron)
CREATE OR REPLACE FUNCTION public.cleanup_old_auth_rate_limits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM auth_rate_limits
  WHERE updated_at < now() - interval '24 hours';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;