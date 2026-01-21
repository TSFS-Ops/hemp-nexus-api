-- Create atomic rate limit increment function to prevent race conditions
CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_org_id uuid,
  p_endpoint text,
  p_window_end timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  UPDATE rate_limits
  SET request_count = request_count + 1
  WHERE org_id = p_org_id 
    AND endpoint = p_endpoint 
    AND window_end = p_window_end
  RETURNING request_count INTO new_count;
  
  RETURN COALESCE(new_count, 0);
END;
$$;