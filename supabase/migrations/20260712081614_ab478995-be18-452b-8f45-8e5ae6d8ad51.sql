-- Security hardening: re-affirm column-level restrictions on webhook_endpoints
-- so that the org-member SELECT policy cannot expose the webhook signing
-- secrets (secret_hash, previous_secret_hash), even to authenticated org
-- members. Column-level privileges are enforced by Postgres in addition to
-- the RLS policy. Idempotent.

REVOKE SELECT (secret_hash, previous_secret_hash)
  ON public.webhook_endpoints
  FROM anon, authenticated, PUBLIC;

-- Re-grant the safe column set to authenticated (idempotent).
GRANT SELECT (
  id, org_id, url, events, status, last_delivery_at,
  created_at, updated_at, consecutive_failures, disabled_at,
  is_primary, previous_secret_expires_at
) ON public.webhook_endpoints TO authenticated;

-- Ensure service_role retains full access for edge functions that sign
-- outbound webhook payloads.
GRANT ALL ON public.webhook_endpoints TO service_role;

COMMENT ON POLICY "Users can select their org webhooks" ON public.webhook_endpoints IS
  'Org-scoped row visibility. Column-level GRANTs (see migration re-affirming REVOKE on secret_hash / previous_secret_hash) prevent any non-service-role reader from selecting the webhook signing secrets, regardless of RLS.';

COMMENT ON COLUMN public.webhook_endpoints.secret_hash IS
  'SECURITY: webhook signing secret. SELECT is revoked from anon and authenticated at column level. Only service_role (edge functions) may read this value.';

COMMENT ON COLUMN public.webhook_endpoints.previous_secret_hash IS
  'SECURITY: previous webhook signing secret used during rotation grace window. SELECT is revoked from anon and authenticated at column level. Only service_role may read this value.';
