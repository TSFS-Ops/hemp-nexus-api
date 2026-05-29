-- DATA-004 Phase 3.1 — read-only candidate-org discovery for email_send_log.
-- SECURITY DEFINER but locked to service_role EXECUTE so only the wired
-- sweeper (and ops via service role) can call it. Read-only.
CREATE OR REPLACE FUNCTION public.discover_email_send_log_candidate_orgs(
  p_limit integer DEFAULT 200
)
RETURNS TABLE (
  org_id uuid,
  row_count bigint,
  oldest_created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    NULLIF(metadata->>'org_id','')::uuid AS org_id,
    count(*)::bigint AS row_count,
    min(created_at) AS oldest_created_at
  FROM public.email_send_log
  WHERE NULLIF(metadata->>'org_id','') IS NOT NULL
  GROUP BY NULLIF(metadata->>'org_id','')::uuid
  ORDER BY min(created_at) ASC
  LIMIT GREATEST(1, LEAST(p_limit, 1000));
$$;

REVOKE ALL ON FUNCTION public.discover_email_send_log_candidate_orgs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.discover_email_send_log_candidate_orgs(integer) FROM anon;
REVOKE ALL ON FUNCTION public.discover_email_send_log_candidate_orgs(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.discover_email_send_log_candidate_orgs(integer) TO service_role;