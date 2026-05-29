INSERT INTO public.tenant_boundary_allowlist (table_name, reason, added_by)
VALUES (
  'idempotency_keys',
  'Service-role-only table (JWT role claim check); authenticated/anon fail-closed. Used by edge functions for idempotency replay protection — no tenant rows reachable from client.',
  NULL
)
ON CONFLICT (table_name) DO UPDATE SET reason = EXCLUDED.reason;