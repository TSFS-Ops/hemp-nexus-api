-- =========================================================================
-- Tenant-Boundary Evidence Pack (Batch 5 · Stage 1)
-- =========================================================================
-- Purpose: prove org_id isolation via reproducible, signed evidence runs.
-- Append-only; HQ platform_admin read-only; writes only via service-role
-- edge functions (tenant-boundary-probe).
-- =========================================================================

-- ── tenant_boundary_allowlist ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_boundary_allowlist (
  table_name   TEXT PRIMARY KEY,
  reason       TEXT NOT NULL,
  added_by     UUID NULL,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tenant_boundary_allowlist TO authenticated;
GRANT ALL    ON public.tenant_boundary_allowlist TO service_role;

ALTER TABLE public.tenant_boundary_allowlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tba_platform_admin_read"
  ON public.tenant_boundary_allowlist
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));

-- ── tenant_boundary_evidence ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_boundary_evidence (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID NOT NULL UNIQUE,
  run_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  run_by              UUID NULL,
  schema_hash         TEXT NOT NULL,
  tables_total        INTEGER NOT NULL DEFAULT 0,
  tables_passed       INTEGER NOT NULL DEFAULT 0,
  tables_failed       INTEGER NOT NULL DEFAULT 0,
  tables_allowlisted  INTEGER NOT NULL DEFAULT 0,
  critical_count      INTEGER NOT NULL DEFAULT 0,
  high_count          INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL CHECK (status IN ('pass','fail','partial')),
  results             JSONB NOT NULL,
  manifest_sha256     TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tbe_run_at ON public.tenant_boundary_evidence (run_at DESC);

GRANT SELECT ON public.tenant_boundary_evidence TO authenticated;
GRANT ALL    ON public.tenant_boundary_evidence TO service_role;

ALTER TABLE public.tenant_boundary_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tbe_platform_admin_read"
  ON public.tenant_boundary_evidence
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));

-- Block UPDATE/DELETE entirely (append-only). No policies for those ops on
-- authenticated; service_role bypasses RLS so administrative correction
-- remains possible through edge functions if ever required.

-- ── Inventory helper: per-table RLS / policy snapshot ────────────────────
-- Returns one row per public table that has an org_id column, with the
-- signals needed to assert tenant isolation:
--   * rls_enabled
--   * per-op policy counts (select/insert/update/delete/all)
--   * any "USING (true)" or "WITH CHECK (true)" policy (red flag)
--   * any policy references to auth.uid() / has_role / org_id (good signal)
CREATE OR REPLACE FUNCTION public.tenant_boundary_inventory()
RETURNS TABLE (
  table_name              TEXT,
  rls_enabled             BOOLEAN,
  policy_count            INTEGER,
  select_policies         INTEGER,
  insert_policies         INTEGER,
  update_policies         INTEGER,
  delete_policies         INTEGER,
  all_policies            INTEGER,
  has_permissive_true     BOOLEAN,
  references_auth_uid     BOOLEAN,
  references_has_role     BOOLEAN,
  references_org_id       BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH org_tables AS (
    SELECT DISTINCT c.table_name::text AS tname
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'org_id'
  ),
  rls_state AS (
    SELECT cls.relname::text AS tname,
           cls.relrowsecurity AS rls_enabled
    FROM pg_class cls
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = 'public'
      AND cls.relkind = 'r'
  ),
  policy_agg AS (
    SELECT p.tablename::text AS tname,
           COUNT(*)::int AS policy_count,
           COUNT(*) FILTER (WHERE p.cmd = 'SELECT')::int AS select_policies,
           COUNT(*) FILTER (WHERE p.cmd = 'INSERT')::int AS insert_policies,
           COUNT(*) FILTER (WHERE p.cmd = 'UPDATE')::int AS update_policies,
           COUNT(*) FILTER (WHERE p.cmd = 'DELETE')::int AS delete_policies,
           COUNT(*) FILTER (WHERE p.cmd = 'ALL')::int AS all_policies,
           BOOL_OR(
             COALESCE(p.qual, '') ~* '^\s*true\s*$'
             OR COALESCE(p.with_check, '') ~* '^\s*true\s*$'
           ) AS has_permissive_true,
           BOOL_OR(
             COALESCE(p.qual, '') ~* 'auth\.uid\(\)'
             OR COALESCE(p.with_check, '') ~* 'auth\.uid\(\)'
           ) AS references_auth_uid,
           BOOL_OR(
             COALESCE(p.qual, '') ~* 'has_role'
             OR COALESCE(p.with_check, '') ~* 'has_role'
           ) AS references_has_role,
           BOOL_OR(
             COALESCE(p.qual, '') ~* '\morg_id\M'
             OR COALESCE(p.with_check, '') ~* '\morg_id\M'
           ) AS references_org_id
    FROM pg_policies p
    WHERE p.schemaname = 'public'
    GROUP BY p.tablename
  )
  SELECT
    ot.tname AS table_name,
    COALESCE(rs.rls_enabled, false) AS rls_enabled,
    COALESCE(pa.policy_count, 0) AS policy_count,
    COALESCE(pa.select_policies, 0) AS select_policies,
    COALESCE(pa.insert_policies, 0) AS insert_policies,
    COALESCE(pa.update_policies, 0) AS update_policies,
    COALESCE(pa.delete_policies, 0) AS delete_policies,
    COALESCE(pa.all_policies, 0) AS all_policies,
    COALESCE(pa.has_permissive_true, false) AS has_permissive_true,
    COALESCE(pa.references_auth_uid, false) AS references_auth_uid,
    COALESCE(pa.references_has_role, false) AS references_has_role,
    COALESCE(pa.references_org_id, false) AS references_org_id
  FROM org_tables ot
  LEFT JOIN rls_state rs ON rs.tname = ot.tname
  LEFT JOIN policy_agg pa ON pa.tname = ot.tname
  ORDER BY ot.tname;
$$;

REVOKE ALL ON FUNCTION public.tenant_boundary_inventory() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tenant_boundary_inventory() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_boundary_inventory() TO service_role;

-- ── Seed allowlist with confirmed cross-org / platform-wide tables ───────
INSERT INTO public.tenant_boundary_allowlist (table_name, reason) VALUES
  ('admin_settings',              'Platform-wide configuration; admin-only.'),
  ('signing_keys',                'Platform cryptographic key registry; admin-only.'),
  ('brd_constraints',             'Locked business-rule constants; read-mostly, admin-write.'),
  ('approval_thresholds',         'Per-org thresholds administered platform-side.'),
  ('ai_provider_state',           'Platform AI gateway state.'),
  ('ai_call_meter',               'Platform-wide AI usage meter.'),
  ('rate_limits',                 'Cross-cutting rate-limit ledger.'),
  ('provider_retry_state',        'Platform provider retry ledger.'),
  ('data_sources',                'Platform data source registry.'),
  ('data_source_performance',     'Platform data source telemetry.'),
  ('data_source_registrations',   'Platform data source registrations.'),
  ('admin_risk_items',            'HQ-only risk inbox.')
ON CONFLICT (table_name) DO NOTHING;
