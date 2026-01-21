
-- =============================================================
-- FIX: Recreate views with correct security_invoker syntax
-- =============================================================

-- 1. Drop and recreate api_keys_safe with security_invoker = true
DROP VIEW IF EXISTS public.api_keys_safe;

CREATE VIEW public.api_keys_safe 
WITH (security_invoker = true) AS
SELECT 
    id,
    org_id,
    name,
    scopes,
    status,
    created_by,
    created_at,
    last_used_at,
    expires_at,
    revoked_at,
    expiry_warning_sent,
    environment
FROM public.api_keys;

GRANT SELECT ON public.api_keys_safe TO authenticated;
REVOKE ALL ON public.api_keys_safe FROM anon;

COMMENT ON VIEW public.api_keys_safe IS 'Safe view of API keys excluding hash fields. Uses security_invoker to respect RLS.';

-- 2. Drop and recreate match_evidence ensuring security_invoker = true
DROP VIEW IF EXISTS public.match_evidence;

CREATE VIEW public.match_evidence 
WITH (security_invoker = true) AS
SELECT 
    m.id AS match_id,
    m.org_id,
    m.created_at AS match_created_at,
    m.settled_at,
    jsonb_build_object(
        'commodity', m.commodity,
        'quantity', jsonb_build_object('amount', m.quantity_amount, 'unit', m.quantity_unit),
        'price', jsonb_build_object('amount', m.price_amount, 'currency', m.price_currency),
        'buyer_id', m.buyer_id,
        'buyer_name', m.buyer_name,
        'seller_id', m.seller_id,
        'seller_name', m.seller_name,
        'terms', m.terms,
        'metadata', m.metadata
    ) AS match_data,
    (
        SELECT jsonb_agg(
            jsonb_build_object(
                'event_type', me.event_type,
                'created_at', me.created_at,
                'payload_hash', me.payload_hash
            ) ORDER BY me.created_at
        )
        FROM public.match_events me
        WHERE me.match_id = m.id
    ) AS event_timeline,
    m.hash AS match_hash,
    m.status
FROM public.matches m;

GRANT SELECT ON public.match_evidence TO authenticated;
REVOKE ALL ON public.match_evidence FROM anon;

COMMENT ON VIEW public.match_evidence IS 'Evidence pack view for matches. Uses security_invoker to respect RLS.';

-- 3. Update the check function to handle both =on and =true
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
        'View uses SECURITY DEFINER (default). Must use WITH (security_invoker = true).'::text AS violation
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
