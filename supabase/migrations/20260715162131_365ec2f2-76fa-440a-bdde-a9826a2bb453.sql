-- Revoke column-level SELECT on hashed credential columns from `authenticated`
-- so end users (including the key creator / org members) cannot read the
-- one-way hashes that back API key and webhook signature verification.
-- Client code already uses the api_keys_safe and webhook_endpoints_safe
-- views for these lookups. service_role keeps full access for edge functions.

REVOKE SELECT (key_hash) ON public.api_keys FROM authenticated;
REVOKE SELECT (key_history) ON public.api_keys FROM authenticated;

REVOKE SELECT (secret_hash) ON public.webhook_endpoints FROM authenticated;
REVOKE SELECT (previous_secret_hash) ON public.webhook_endpoints FROM authenticated;

COMMENT ON COLUMN public.api_keys.key_hash IS
  'One-way hash of the API key. Not readable by authenticated role; access via server-side functions only.';
COMMENT ON COLUMN public.api_keys.key_history IS
  'Rotation history containing prior hashes. Not readable by authenticated role.';
COMMENT ON COLUMN public.webhook_endpoints.secret_hash IS
  'Hashed webhook signing secret. Not readable by authenticated role; use webhook_endpoints_safe.';
COMMENT ON COLUMN public.webhook_endpoints.previous_secret_hash IS
  'Prior hashed webhook signing secret retained for rotation grace. Not readable by authenticated role.';
