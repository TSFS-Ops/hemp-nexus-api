
-- Create a safe view for webhook_endpoints that excludes secret_hash
CREATE OR REPLACE VIEW public.webhook_endpoints_safe
WITH (security_invoker = true)
AS
SELECT
  id,
  org_id,
  url,
  events,
  status,
  last_delivery_at,
  created_at,
  updated_at
FROM public.webhook_endpoints;

-- Comment explaining the view
COMMENT ON VIEW public.webhook_endpoints_safe IS 'Safe view of webhook_endpoints excluding secret_hash. Use this for frontend queries.';
