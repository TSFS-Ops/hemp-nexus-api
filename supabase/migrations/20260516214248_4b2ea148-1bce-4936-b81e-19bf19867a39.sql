CREATE OR REPLACE FUNCTION public.admin_list_inconsistent_matches()
RETURNS TABLE (
  id uuid,
  commodity text,
  buyer_org_id uuid,
  seller_org_id uuid,
  org_id uuid,
  buyer_name text,
  seller_name text,
  status text,
  state text,
  poi_state text,
  settled_at timestamptz,
  buyer_committed_at timestamptz,
  seller_committed_at timestamptz,
  created_at timestamptz,
  metadata jsonb,
  inconsistency_reasons text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.commodity,
    m.buyer_org_id,
    m.seller_org_id,
    m.org_id,
    m.buyer_name,
    m.seller_name,
    m.status,
    m.state,
    m.poi_state,
    m.settled_at,
    m.buyer_committed_at,
    m.seller_committed_at,
    m.created_at,
    m.metadata,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN (m.metadata ->> 'legacy_repair_required') = 'true'
        THEN 'legacy_repair_required' END,
      CASE WHEN (m.metadata ->> 'state_reconciliation_required') = 'true'
        THEN 'state_reconciliation_required' END,
      CASE WHEN m.status = 'settled' AND m.poi_state = 'DRAFT'
        THEN 'settled_with_draft_poi' END,
      CASE WHEN m.state = 'completed'
        AND m.poi_state IS NOT NULL
        AND m.poi_state <> ''
        AND m.poi_state NOT IN ('EXPIRED','REJECTED','ANNULLED','CANCELLED','COMPLETED','SETTLED','ISSUED')
        THEN 'completed_state_with_open_poi' END,
      CASE WHEN m.settled_at IS NOT NULL
        AND m.status NOT IN ('settled','completed','cancelled','annulled')
        THEN 'settled_at_without_settled_status' END,
      CASE WHEN m.buyer_committed_at IS NOT NULL
        AND m.seller_committed_at IS NOT NULL
        AND m.state = 'discovery'
        THEN 'both_committed_but_still_discovery' END,
      CASE WHEN m.buyer_org_id IS NOT NULL
        AND m.seller_org_id IS NOT NULL
        AND m.buyer_org_id = m.seller_org_id
        THEN 'same_org_both_sides' END
    ], NULL) AS inconsistency_reasons
  FROM public.matches m
  WHERE
    (m.metadata ->> 'legacy_repair_required') = 'true'
    OR (m.metadata ->> 'state_reconciliation_required') = 'true'
    OR (m.status = 'settled' AND m.poi_state = 'DRAFT')
    OR (m.state = 'completed'
        AND m.poi_state IS NOT NULL
        AND m.poi_state <> ''
        AND m.poi_state NOT IN ('EXPIRED','REJECTED','ANNULLED','CANCELLED','COMPLETED','SETTLED','ISSUED'))
    OR (m.settled_at IS NOT NULL
        AND m.status NOT IN ('settled','completed','cancelled','annulled'))
    OR (m.buyer_committed_at IS NOT NULL
        AND m.seller_committed_at IS NOT NULL
        AND m.state = 'discovery')
    OR (m.buyer_org_id IS NOT NULL
        AND m.seller_org_id IS NOT NULL
        AND m.buyer_org_id = m.seller_org_id)
  ORDER BY m.created_at DESC
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_inconsistent_matches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_inconsistent_matches() TO authenticated;

COMMENT ON FUNCTION public.admin_list_inconsistent_matches() IS
  'MT-008 Legacy Repair queue: read-only platform-admin list of inconsistent matches. Uses public.is_admin(auth.uid()) and never calls a zero-argument is_admin helper.';