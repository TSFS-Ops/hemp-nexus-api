-- DATA-004 Batch 7 — cold-storage-archive candidate discovery (read-only).
-- SECURITY DEFINER, locked to service_role EXECUTE. Mirrors the Phase 3.1
-- pattern used for discover_email_send_log_candidate_orgs:
--   * enumerate the universe the dry-run sweeper *would* consider
--   * pre-classify duplicate / missing-source candidates so evidence
--     can record them explicitly (never silent)
--   * never mutate, never delete, never call any sweeper
--
-- A "candidate" is a retention_flags row whose retention_status is
-- 'archived' or 'quarantined' AND whose archive_storage_path is NULL
-- (i.e. has not already been exported to cold storage). For each row
-- we surface enough metadata for the dry-run sweeper to bucket it
-- without re-querying.

CREATE OR REPLACE FUNCTION public.discover_cold_storage_archive_candidates(
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  flag_id uuid,
  table_name text,
  record_id uuid,
  org_id uuid,
  retention_status text,
  retention_action text,
  record_created_at timestamptz,
  retention_expires_at timestamptz,
  already_exported boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    rf.id          AS flag_id,
    rf.table_name,
    rf.record_id,
    rf.org_id,
    rf.retention_status,
    rf.retention_action,
    rf.record_created_at,
    rf.retention_expires_at,
    (rf.archive_storage_path IS NOT NULL) AS already_exported
  FROM public.retention_flags rf
  WHERE rf.retention_status IN ('archived','quarantined')
  ORDER BY rf.retention_expires_at ASC NULLS LAST
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

REVOKE ALL ON FUNCTION public.discover_cold_storage_archive_candidates(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.discover_cold_storage_archive_candidates(integer) FROM anon;
REVOKE ALL ON FUNCTION public.discover_cold_storage_archive_candidates(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.discover_cold_storage_archive_candidates(integer) TO service_role;

COMMENT ON FUNCTION public.discover_cold_storage_archive_candidates(integer) IS
  'DATA-004 Batch 7 — read-only candidate enumeration for the cold-storage-archive dry-run sweeper. service_role only. Never mutates.';