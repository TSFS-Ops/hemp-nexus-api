-- Institutional Funder Evidence Workspace — controlled-pilot pack resolution
-- Narrow correction: remove manual pack UUID/version dependence from the release flow.
-- No table creation. No enum renames. No existing RPC signature changes.

CREATE OR REPLACE FUNCTION public.fw_admin_list_eligible_evidence_packs_v1(
  p_match_id uuid
) RETURNS TABLE(
  evidence_pack_id uuid,
  evidence_pack_version text,
  label text,
  created_at timestamptz,
  item_count integer,
  pack_status text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'fw.forbidden: platform_admin required';
  END IF;
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'fw.validation: canonical deal required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.id = p_match_id) THEN
    RAISE EXCEPTION 'fw.validation: canonical deal not found';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT
      p.id,
      coalesce(nullif(p.metadata->>'evidence_pack_version',''), nullif(p.metadata->>'version',''), '1') AS version_label,
      p.created_at,
      p.pack_status,
      count(pi.id)::int AS item_count
    FROM public.p5_batch2_evidence_packs p
    JOIN public.p5_batch2_evidence_pack_items pi ON pi.pack_id = p.id
    WHERE p.match_id = p_match_id
      AND p.superseded_by IS NULL
      AND p.pack_status IN ('sealed', 'generated')
      AND pi.snapshot_status IN ('accepted', 'accepted_with_warning')
    GROUP BY p.id, version_label, p.created_at, p.pack_status
    HAVING count(pi.id) > 0
  )
  SELECT
    e.id AS evidence_pack_id,
    e.version_label AS evidence_pack_version,
    format('Evidence Pack — Version %s — Created %s', e.version_label, to_char(e.created_at, 'DD Mon YYYY')) AS label,
    e.created_at,
    e.item_count,
    e.pack_status
  FROM eligible e
  ORDER BY e.created_at DESC, e.version_label DESC;
END; $$;

REVOKE EXECUTE ON FUNCTION public.fw_admin_list_eligible_evidence_packs_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fw_admin_list_eligible_evidence_packs_v1(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fw_admin_release_deal_v2(
  p_funder_organisation_id uuid,
  p_match_id uuid,
  p_evidence_pack_id uuid,
  p_evidence_pack_version text,
  p_release_reason text,
  p_expires_at timestamptz,
  p_can_download_compiled_pack boolean,
  p_can_view_raw_documents boolean,
  p_can_download_raw_documents boolean,
  p_can_view_unmasked_sensitive_details boolean,
  p_buyer_consent_status text,
  p_seller_consent_status text,
  p_admin_override_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_match record;
  v_deal_reference text;
  v_buyer text;
  v_seller text;
  v_override text;
  v_pack record;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'fw.forbidden: only platform_admin may release funder deals';
  END IF;
  IF NOT public.fw_is_funder_org_approved_v1(p_funder_organisation_id) THEN
    RAISE EXCEPTION 'fw.forbidden: funder organisation not approved/active';
  END IF;
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'fw.validation: canonical deal (match_id) required';
  END IF;

  SELECT id, buyer_name, seller_name, commodity, hash
    INTO v_match FROM public.matches WHERE id = p_match_id;
  IF v_match.id IS NULL THEN
    RAISE EXCEPTION 'fw.validation: canonical deal not found';
  END IF;

  IF p_evidence_pack_id IS NULL THEN
    RAISE EXCEPTION 'fw.validation: evidence pack is required for this deal';
  END IF;
  IF coalesce(trim(p_evidence_pack_version),'') = '' THEN
    RAISE EXCEPTION 'fw.validation: evidence pack version is required';
  END IF;

  SELECT ep.evidence_pack_id, ep.evidence_pack_version, ep.item_count, ep.pack_status
    INTO v_pack
  FROM public.fw_admin_list_eligible_evidence_packs_v1(p_match_id) ep
  WHERE ep.evidence_pack_id = p_evidence_pack_id
    AND ep.evidence_pack_version = trim(p_evidence_pack_version);

  IF v_pack.evidence_pack_id IS NULL THEN
    RAISE EXCEPTION 'fw.validation: selected evidence pack is not available for this canonical deal';
  END IF;

  IF coalesce(trim(p_release_reason),'') = '' THEN
    RAISE EXCEPTION 'fw.validation: release_reason required';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'fw.validation: expires_at must be in the future';
  END IF;

  v_buyer    := coalesce(p_buyer_consent_status,'pending');
  v_seller   := coalesce(p_seller_consent_status,'pending');
  v_override := trim(coalesce(p_admin_override_reason,''));

  IF v_buyer  NOT IN ('not_required','pending','granted','declined','overridden')
     OR v_seller NOT IN ('not_required','pending','granted','declined','overridden') THEN
    RAISE EXCEPTION 'fw.validation: invalid consent status';
  END IF;

  IF NOT (v_buyer IN ('granted','not_required') AND v_seller IN ('granted','not_required')) THEN
    IF v_override = '' THEN
      RAISE EXCEPTION 'fw.consent_required: buyer/seller consent missing and no admin_override_reason';
    END IF;
    IF v_buyer  NOT IN ('granted','not_required') THEN v_buyer  := 'overridden'; END IF;
    IF v_seller NOT IN ('granted','not_required') THEN v_seller := 'overridden'; END IF;
  END IF;

  v_deal_reference := coalesce(
    nullif(v_match.hash, ''),
    p_match_id::text
  );

  INSERT INTO public.funder_deal_releases(
    funder_organisation_id, deal_reference, evidence_pack_id, evidence_pack_version,
    release_status, released_by, released_at, release_reason, expires_at,
    can_download_compiled_pack, can_view_raw_documents, can_download_raw_documents,
    can_view_unmasked_sensitive_details,
    buyer_consent_status, seller_consent_status, admin_override_reason,
    match_id, deal_linkage_status, deal_linked_at, deal_linked_by
  ) VALUES (
    p_funder_organisation_id, v_deal_reference, p_evidence_pack_id, trim(p_evidence_pack_version),
    'active', auth.uid(), now(), p_release_reason, p_expires_at,
    coalesce(p_can_download_compiled_pack,false), coalesce(p_can_view_raw_documents,false),
    coalesce(p_can_download_raw_documents,false), coalesce(p_can_view_unmasked_sensitive_details,false),
    v_buyer, v_seller, nullif(v_override,''),
    p_match_id, 'canonical', now(), auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO public.funder_release_consents(release_id, party_type, status, captured_by, captured_at, source, override_reason)
    VALUES (v_id, 'buyer',  v_buyer,  auth.uid(), now(), 'admin_release_rpc_v2',
            CASE WHEN v_buyer  = 'overridden' THEN nullif(v_override,'') END);
  INSERT INTO public.funder_release_consents(release_id, party_type, status, captured_by, captured_at, source, override_reason)
    VALUES (v_id, 'seller', v_seller, auth.uid(), now(), 'admin_release_rpc_v2',
            CASE WHEN v_seller = 'overridden' THEN nullif(v_override,'') END);

  PERFORM public.fw_audit('funder_deal.released', p_funder_organisation_id, 'funder_deal_release', v_id,
    NULL, jsonb_build_object(
      'match_id', p_match_id,
      'deal_reference', v_deal_reference,
      'deal_linkage_status','canonical',
      'evidence_pack_id', p_evidence_pack_id,
      'evidence_pack_version', trim(p_evidence_pack_version),
      'buyer_consent_status', v_buyer,
      'seller_consent_status', v_seller,
      'admin_override_reason', nullif(v_override,'')
    ), p_release_reason);
  IF v_override <> '' THEN
    PERFORM public.fw_audit('funder_deal.consent_overridden', p_funder_organisation_id,
      'funder_deal_release', v_id, NULL,
      jsonb_build_object('buyer', v_buyer, 'seller', v_seller), v_override);
  END IF;
  PERFORM public.fw_record_usage(p_funder_organisation_id, v_deal_reference, v_id, NULL,
    'deal_released',
    jsonb_build_object('evidence_pack_id', p_evidence_pack_id,
                       'evidence_pack_version', trim(p_evidence_pack_version),
                       'match_id', p_match_id,
                       'deal_linkage_status','canonical'));
  RETURN v_id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.fw_admin_release_deal_v2(uuid,uuid,uuid,text,text,timestamptz,boolean,boolean,boolean,boolean,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fw_admin_release_deal_v2(uuid,uuid,uuid,text,text,timestamptz,boolean,boolean,boolean,boolean,text,text,text) TO authenticated, service_role;