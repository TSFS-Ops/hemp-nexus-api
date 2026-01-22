-- Security hardening: lock down match_evidence (backend-only) + add match_evidence_public (public demo)

-- 1) Ensure match_evidence view respects caller RLS (defense-in-depth)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'match_evidence' AND c.relkind = 'v'
  ) THEN
    EXECUTE 'ALTER VIEW public.match_evidence SET (security_invoker = true)';
  END IF;
END $$;

-- 2) Backend-only: remove direct client access to real evidence view
REVOKE ALL ON public.match_evidence FROM anon;
REVOKE ALL ON public.match_evidence FROM authenticated;
GRANT SELECT ON public.match_evidence TO service_role;

-- 3) Backend-only: lock down the evidence accessor RPC as well (prevents bypass via SECURITY DEFINER)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_match_evidence'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_match_evidence(uuid, uuid) FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_match_evidence(uuid, uuid) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_match_evidence(uuid, uuid) FROM authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_match_evidence(uuid, uuid) TO service_role';
  END IF;
END $$;

-- 4) Public demo evidence view: synthetic, non-sensitive, safe for anon
-- NOTE: This view intentionally contains NO real org/match data.
DROP VIEW IF EXISTS public.match_evidence_public;
CREATE VIEW public.match_evidence_public
WITH (security_invoker = true) AS
SELECT
  '11111111-1111-1111-1111-111111111111'::uuid AS match_id,
  NULL::uuid AS org_id,
  now() - interval '2 days' AS match_created_at,
  NULL::timestamptz AS settled_at,
  jsonb_build_object(
    'commodity', 'Demo Commodity',
    'quantity', jsonb_build_object('amount', 1000, 'unit', 'MT'),
    'price', jsonb_build_object('amount', 50000, 'currency', 'USD'),
    'buyer_id', '[DEMO]',
    'buyer_name', 'Demo Buyer',
    'seller_id', '[DEMO]',
    'seller_name', 'Demo Seller',
    'terms', 'Demo terms only',
    'metadata', jsonb_build_object('demo', true)
  ) AS match_data,
  jsonb_build_array(
    jsonb_build_object('event_type', 'created', 'created_at', now() - interval '2 days', 'payload_hash', 'demo_hash_1'),
    jsonb_build_object('event_type', 'matched', 'created_at', now() - interval '1 day', 'payload_hash', 'demo_hash_2')
  ) AS event_timeline,
  'demo_match_hash'::text AS match_hash,
  'matched'::text AS status
UNION ALL
SELECT
  '22222222-2222-2222-2222-222222222222'::uuid AS match_id,
  NULL::uuid AS org_id,
  now() - interval '7 days' AS match_created_at,
  now() - interval '6 days' AS settled_at,
  jsonb_build_object(
    'commodity', 'Demo Commodity 2',
    'quantity', jsonb_build_object('amount', 250, 'unit', 'MT'),
    'price', jsonb_build_object('amount', 12000, 'currency', 'USD'),
    'buyer_id', '[DEMO]',
    'buyer_name', 'Demo Buyer 2',
    'seller_id', '[DEMO]',
    'seller_name', 'Demo Seller 2',
    'terms', 'Demo terms only',
    'metadata', jsonb_build_object('demo', true)
  ) AS match_data,
  jsonb_build_array(
    jsonb_build_object('event_type', 'created', 'created_at', now() - interval '7 days', 'payload_hash', 'demo_hash_a'),
    jsonb_build_object('event_type', 'settled', 'created_at', now() - interval '6 days', 'payload_hash', 'demo_hash_b')
  ) AS event_timeline,
  'demo_match_hash_2'::text AS match_hash,
  'settled'::text AS status;

GRANT SELECT ON public.match_evidence_public TO anon;
GRANT SELECT ON public.match_evidence_public TO authenticated;

COMMENT ON VIEW public.match_evidence_public IS 'Public demo-safe evidence view (synthetic only).';


-- 5) Guardrail functions (service_role-only) for continuous regression detection

CREATE OR REPLACE FUNCTION public.check_view_security_invoker()
RETURNS TABLE(
  schema_name text,
  view_name text,
  violation text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT
    n.nspname::text AS schema_name,
    c.relname::text AS view_name,
    'View missing security_invoker (would bypass RLS)'::text AS violation
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'v'
    AND n.nspname = 'public'
    AND NOT (
      c.reloptions IS NOT NULL
      AND (
        'security_invoker=on' = ANY(c.reloptions)
        OR 'security_invoker=true' = ANY(c.reloptions)
      )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.check_view_security_invoker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_view_security_invoker() TO service_role;


CREATE OR REPLACE FUNCTION public.check_public_exposure(p_allowlist text[] DEFAULT ARRAY[]::text[])
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
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Tables + views + materialized views + sequences
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

REVOKE ALL ON FUNCTION public.check_public_exposure(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_public_exposure(text[]) TO service_role;


CREATE OR REPLACE FUNCTION public.check_backend_only_views(p_view_names text[])
RETURNS TABLE(
  view_name text,
  violation text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT
    v.view_name,
    'View is readable by authenticated role (should be backend-only)'::text AS violation
  FROM unnest(p_view_names) AS v(view_name)
  WHERE has_table_privilege('authenticated', format('public.%I', v.view_name), 'SELECT');
END;
$$;

REVOKE ALL ON FUNCTION public.check_backend_only_views(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_backend_only_views(text[]) TO service_role;
