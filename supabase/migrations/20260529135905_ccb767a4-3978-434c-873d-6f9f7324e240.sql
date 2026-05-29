-- Batch 5 · Stage 1 follow-up: refine tenant_boundary_inventory() so that
-- USING(true) / WITH CHECK(true) policies that are scoped to service_role only
-- are NOT counted as "permissive_true" — service_role bypasses RLS by definition,
-- so such policies have no tenant-boundary impact. Also seed allowlist entries
-- for token_purchases (fail-closed, edge-function-only) and sdk_examples
-- (intentional public catalogue).

CREATE OR REPLACE FUNCTION public.tenant_boundary_inventory()
RETURNS TABLE (
  table_name text,
  rls_enabled boolean,
  policy_count integer,
  select_policies integer,
  insert_policies integer,
  update_policies integer,
  delete_policies integer,
  all_policies integer,
  has_permissive_true boolean,
  references_auth_uid boolean,
  references_has_role boolean,
  references_org_id boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH org_tables AS (
    SELECT c.relname AS tname, c.oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attname = 'org_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ),
  pol AS (
    SELECT
      p.polname,
      p.polrelid,
      p.polcmd,
      p.polroles,
      pg_get_expr(p.polqual, p.polrelid)      AS qual_src,
      pg_get_expr(p.polwithcheck, p.polrelid) AS wc_src,
      -- A policy is "tenant-relevant permissive-true" only if it applies to a
      -- role OTHER than service_role. service_role bypasses RLS regardless,
      -- so `USING (true)` scoped to {service_role} carries no tenant risk.
      EXISTS (
        SELECT 1 FROM unnest(p.polroles) r
        WHERE r <> 0  -- 0 = PUBLIC
          AND COALESCE((SELECT rolname FROM pg_roles WHERE oid = r), '') <> 'service_role'
      ) OR (array_length(p.polroles, 1) = 1 AND p.polroles[1] = 0) AS counts_for_permissive
    FROM pg_policy p
  )
  SELECT
    ot.tname AS table_name,
    c.relrowsecurity AS rls_enabled,
    COALESCE(COUNT(pol.polname), 0)::int AS policy_count,
    COALESCE(SUM(CASE WHEN pol.polcmd = 'r' THEN 1 ELSE 0 END), 0)::int AS select_policies,
    COALESCE(SUM(CASE WHEN pol.polcmd = 'a' THEN 1 ELSE 0 END), 0)::int AS insert_policies,
    COALESCE(SUM(CASE WHEN pol.polcmd = 'w' THEN 1 ELSE 0 END), 0)::int AS update_policies,
    COALESCE(SUM(CASE WHEN pol.polcmd = 'd' THEN 1 ELSE 0 END), 0)::int AS delete_policies,
    COALESCE(SUM(CASE WHEN pol.polcmd = '*' THEN 1 ELSE 0 END), 0)::int AS all_policies,
    COALESCE(bool_or(
      pol.counts_for_permissive AND (
        btrim(COALESCE(pol.qual_src, '')) = 'true'
        OR btrim(COALESCE(pol.wc_src, '')) = 'true'
      )
    ), false) AS has_permissive_true,
    COALESCE(bool_or(COALESCE(pol.qual_src,'') ILIKE '%auth.uid()%' OR COALESCE(pol.wc_src,'') ILIKE '%auth.uid()%'), false) AS references_auth_uid,
    COALESCE(bool_or(COALESCE(pol.qual_src,'') ILIKE '%has_role(%' OR COALESCE(pol.wc_src,'') ILIKE '%has_role(%' OR COALESCE(pol.qual_src,'') ILIKE '%is_admin(%' OR COALESCE(pol.wc_src,'') ILIKE '%is_admin(%' OR COALESCE(pol.qual_src,'') ILIKE '%is_org_admin(%' OR COALESCE(pol.wc_src,'') ILIKE '%is_org_admin(%'), false) AS references_has_role,
    COALESCE(bool_or(COALESCE(pol.qual_src,'') ILIKE '%org_id%' OR COALESCE(pol.wc_src,'') ILIKE '%org_id%'), false) AS references_org_id
  FROM org_tables ot
  JOIN pg_class c ON c.oid = ot.oid
  LEFT JOIN pol ON pol.polrelid = ot.oid
  GROUP BY ot.tname, c.relrowsecurity
  ORDER BY ot.tname;
$$;

REVOKE ALL ON FUNCTION public.tenant_boundary_inventory() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_boundary_inventory() TO service_role;

-- Seed remaining intentional cross-org / fail-closed tables.
INSERT INTO public.tenant_boundary_allowlist (table_name, reason) VALUES
  ('token_purchases', 'Fail-closed: RLS on, zero Data API grants; only service_role (billing edge functions) can read/write. Intentional architectural posture.'),
  ('sdk_examples', 'Intentional public SDK example catalogue; admin-write, anyone-read by design.')
ON CONFLICT (table_name) DO UPDATE SET reason = EXCLUDED.reason;