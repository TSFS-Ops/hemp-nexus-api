-- Restrict webhook_endpoints.secret_hash so only service_role (edge functions)
-- and admin selectors can read it. Regular org members can still SELECT the
-- rest of the row via existing org-scoped RLS, but the signing-secret hash
-- (and its previous rotation counterpart) is now column-level revoked from
-- authenticated/anon. Edge functions using the service role are unaffected.
REVOKE SELECT (secret_hash, previous_secret_hash) ON public.webhook_endpoints FROM authenticated;
REVOKE SELECT (secret_hash, previous_secret_hash) ON public.webhook_endpoints FROM anon;