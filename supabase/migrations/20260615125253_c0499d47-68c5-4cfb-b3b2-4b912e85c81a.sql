CREATE OR REPLACE FUNCTION public.get_match_approved_ai_summary(_match_id uuid)
RETURNS TABLE (
  proposed_match_id uuid,
  match_id uuid,
  suggested_counterparty_name text,
  counterparty_role text,
  jurisdiction text,
  sector_or_product_fit text,
  short_summary text,
  status_label text,
  approved_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_allowed boolean := false;
  v_match record;
BEGIN
  IF v_uid IS NULL OR _match_id IS NULL THEN
    RETURN;
  END IF;

  SELECT p.org_id INTO v_org FROM public.profiles p WHERE p.id = v_uid;

  SELECT m.id, m.org_id, m.buyer_org_id, m.seller_org_id
    INTO v_match
    FROM public.matches m
   WHERE m.id = _match_id;

  IF v_match.id IS NULL THEN
    RETURN;
  END IF;

  IF public.is_admin(v_uid) THEN
    v_allowed := true;
  ELSIF v_org IS NOT NULL AND (
    v_org = v_match.org_id
    OR v_org = v_match.buyer_org_id
    OR v_org = v_match.seller_org_id
  ) THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    apm.id                                                              AS proposed_match_id,
    apm.match_id                                                        AS match_id,
    NULLIF(apm.approved_payload->>'suggested_counterparty_name','')     AS suggested_counterparty_name,
    NULLIF(apm.approved_payload->>'counterparty_role','')               AS counterparty_role,
    NULLIF(apm.approved_payload->>'jurisdiction','')                    AS jurisdiction,
    NULLIF(apm.approved_payload->>'sector_or_product_fit','')           AS sector_or_product_fit,
    NULLIF(
      COALESCE(
        apm.approved_payload->>'short_summary',
        apm.approved_payload->>'match_rationale'
      ),
      ''
    )                                                                   AS short_summary,
    'Approved summary available'::text                                  AS status_label,
    NULLIF(apm.approved_payload->>'approved_at','')::timestamptz        AS approved_at
  FROM public.ai_proposed_matches apm
  WHERE apm.match_id          = _match_id
    AND apm.client_visible    = true
    AND apm.status            = 'approved_client_view'
    AND apm.approved_payload IS NOT NULL
  ORDER BY apm.updated_at DESC NULLS LAST, apm.created_at DESC
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_match_approved_ai_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_match_approved_ai_summary(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_match_approved_ai_summary(uuid) IS
'Phase 4: returns ONLY safe approved AI summary fields (from approved_payload) for an originator-authorised user. Never exposes raw, original, edited, sources, notes, confidence, or risk flags.';