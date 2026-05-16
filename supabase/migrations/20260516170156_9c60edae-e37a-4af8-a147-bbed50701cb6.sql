ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS allowed_ips text[],
  ADD COLUMN IF NOT EXISTS allowed_origins text[];

COMMENT ON COLUMN public.api_keys.allowed_ips IS
  'Batch N: optional IP allowlist. NULL/empty = unrestricted. When set, requests from other IPs are rejected with generic 401/403.';
COMMENT ON COLUMN public.api_keys.allowed_origins IS
  'Batch N: optional Origin allowlist. NULL/empty = unrestricted. When set, requests with other Origin headers are rejected.';