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
    -- Restrict to actual base tables (relkind='r'), not views/matviews.
    SELECT DISTINCT cls.relname::text AS tname
    FROM pg_attribute a
    JOIN pg_class cls   ON cls.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = cls.relnamespace
    WHERE n.nspname = 'public'
      AND cls.relkind = 'r'
      AND a.attname = 'org_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
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
