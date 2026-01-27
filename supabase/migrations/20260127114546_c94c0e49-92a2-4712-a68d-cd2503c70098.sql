-- Clean up duplicate rate limit records before adding unique constraint
-- Keep only the record with the highest request_count for each (org_id, endpoint, window_end) combination

DELETE FROM public.rate_limits
WHERE id NOT IN (
  SELECT DISTINCT ON (org_id, endpoint, window_end) id
  FROM public.rate_limits
  ORDER BY org_id, endpoint, window_end, request_count DESC
);

-- Now create the unique index
CREATE UNIQUE INDEX idx_rate_limits_org_endpoint_window 
ON public.rate_limits (org_id, endpoint, window_end);