-- Deny anon by default + add automated grant/view guardrails

-- 0) Ensure schema usage remains (we are only revoking object privileges)
-- NOTE: We intentionally do NOT revoke USAGE on schema public so authenticated flows and explicit allowlists can still work.

-- 1) Revoke anon privileges on all existing objects in public schema
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- 2) Lock down default privileges so future objects are not accidentally exposed to anon
-- Apply for objects created by common owner roles (CURRENT_USER at migration time).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;

-- 3) Automated guardrail: detect any anon grants in public schema (outside an allowlist)
CREATE OR REPLACE FUNCTION public.check_anon_grants(p_allowlist text[] DEFAULT ARRAY[]::text[])
RETURNS TABLE(
  object_type text,
  schema_name text,
  object_name text,
  privileges text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  -- Only admins can run this check (prevents metadata leakage)
  SELECT public.has_role(auth.uid(), 'admin'::public.app_role) INTO v_is_admin;
  IF COALESCE(v_is_admin, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Tables + views
  RETURN QUERY
  WITH objs AS (
    SELECT
      CASE c.relkind
        WHEN 'r' THEN 'table'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized_view'
        WHEN 'S' THEN 'sequence'
        ELSE c.relkind::text
      END AS object_type,
      n.nspname::text AS schema_name,
      c.relname::text AS object_name,
      array_remove(ARRAY[
        CASE WHEN has_table_privilege('anon', format('%I.%I', n.nspname, c.relname), 'SELECT') THEN 'SELECT' END,
        CASE WHEN has_table_privilege('anon', format('%I.%I', n.nspname, c.relname), 'INSERT') THEN 'INSERT' END,
        CASE WHEN has_table_privilege('anon', format('%I.%I', n.nspname, c.relname), 'UPDATE') THEN 'UPDATE' END,
        CASE WHEN has_table_privilege('anon', format('%I.%I', n.nspname, c.relname), 'DELETE') THEN 'DELETE' END,
        CASE WHEN has_table_privilege('anon', format('%I.%I', n.nspname, c.relname), 'TRUNCATE') THEN 'TRUNCATE' END,
        CASE WHEN has_table_privilege('anon', format('%I.%I', n.nspname, c.relname), 'REFERENCES') THEN 'REFERENCES' END,
        CASE WHEN has_table_privilege('anon', format('%I.%I', n.nspname, c.relname), 'TRIGGER') THEN 'TRIGGER' END
      ], NULL) AS privs
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','v','m','S')
  )
  SELECT
    o.object_type,
    o.schema_name,
    o.object_name,
    array_to_string(o.privs, ',') AS privileges
  FROM objs o
  WHERE cardinality(o.privs) > 0
    AND NOT (format('%s:%s', o.object_type, o.object_name) = ANY(p_allowlist));

  -- Functions
  RETURN QUERY
  WITH fns AS (
    SELECT
      'function'::text AS object_type,
      n.nspname::text AS schema_name,
      p.proname::text AS object_name,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS has_exec
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  )
  SELECT
    f.object_type,
    f.schema_name,
    f.object_name,
    'EXECUTE'::text AS privileges
  FROM fns f
  WHERE f.has_exec
    AND NOT (format('%s:%s', f.object_type, f.object_name) = ANY(p_allowlist));
END;
$$;

REVOKE ALL ON FUNCTION public.check_anon_grants(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_anon_grants(text[]) TO authenticated;

COMMENT ON FUNCTION public.check_anon_grants(text[]) IS 'Admin-only guardrail: returns any public schema objects with privileges granted to anon (outside allowlist).';
