
-- Create a simpler database function to detect SECURITY DEFINER views
-- Uses array parsing instead of non-existent function
CREATE OR REPLACE FUNCTION public.check_security_definer_views()
RETURNS TABLE(
    schema_name text,
    view_name text,
    violation text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        n.nspname::text AS schema_name,
        c.relname::text AS view_name,
        'View uses SECURITY DEFINER (default). Must use WITH (security_invoker = on) or convert to RPC.'::text AS violation
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'v'
      AND n.nspname = 'public'
      AND NOT (
          c.reloptions IS NOT NULL 
          AND 'security_invoker=on' = ANY(c.reloptions)
      );
END;
$$;

COMMENT ON FUNCTION public.check_security_definer_views IS 'Returns any public views that do not have security_invoker=on. Use in CI/deployment to prevent SECURITY DEFINER views.';
