-- Remove the security definer view and use policy-based approach instead
DROP VIEW IF EXISTS public.webhook_endpoints_view;

-- Add documentation comment about secret_hash security
COMMENT ON COLUMN public.webhook_endpoints.secret_hash IS 'SECURITY: This field contains sensitive webhook signing secrets. Frontend code should never SELECT this field. Only backend edge functions should access it for webhook delivery.';

-- The frontend should select specific columns, never SELECT *
-- Example: SELECT id, url, events, status, last_delivery_at, created_at FROM webhook_endpoints