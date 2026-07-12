
-- ============================================================================
-- Batch 8 — Canonical deal linkage on funder_deal_releases
-- Additive only. Preserves V1 RPCs, columns, RLS, sealed packs.
-- ============================================================================

-- 1) Additive columns ---------------------------------------------------------
ALTER TABLE public.funder_deal_releases
  ADD COLUMN IF NOT EXISTS match_id uuid REFERENCES public.matches(id),
  ADD COLUMN IF NOT EXISTS deal_linkage_status text,
  ADD COLUMN IF NOT EXISTS deal_linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS deal_linked_by uuid,
  ADD COLUMN IF NOT EXISTS deal_linkage_reason text;

CREATE INDEX IF NOT EXISTS funder_deal_releases_match_id_idx
  ON public.funder_deal_releases(match_id);
CREATE INDEX IF NOT EXISTS funder_deal_releases_linkage_status_idx
  ON public.funder_deal_releases(deal_linkage_status);

-- 2) Idempotent legacy backfill ----------------------------------------------
-- Only backfill where deal_reference is a valid UUID resolving to matches.id.
UPDATE public.funder_deal_releases r
   SET match_id = r.deal_reference::uuid,
       deal_linkage_status = 'legacy_fallback',
       deal_linked_at = coalesce(r.deal_linked_at, now()),
       deal_linkage_reason = coalesce(r.deal_linkage_reason,
         'Batch 8 backfill: deal_reference resolved to canonical matches.id')
 WHERE r.match_id IS NULL
   AND r.deal_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND EXISTS (SELECT 1 FROM public.matches m WHERE m.id = r.deal_reference::uuid);

-- Everything still unlinked becomes an explicit legacy_unresolved row.
UPDATE public.funder_deal_releases
   SET deal_linkage_status = 'legacy_unresolved'
 WHERE match_id IS NULL
   AND deal_linkage_status IS NULL;

-- 3) V2 release RPC — requires a canonical match_id --------------------------
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

  -- Human-readable reference derived from the canonical deal.
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
    p_funder_organisation_id, v_deal_reference, p_evidence_pack_id, p_evidence_pack_version,
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
                       'evidence_pack_version', p_evidence_pack_version,
                       'match_id', p_match_id,
                       'deal_linkage_status','canonical'));
  RETURN v_id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.fw_admin_release_deal_v2(uuid,uuid,uuid,text,text,timestamptz,boolean,boolean,boolean,boolean,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fw_admin_release_deal_v2(uuid,uuid,uuid,text,text,timestamptz,boolean,boolean,boolean,boolean,text,text,text) TO authenticated, service_role;

-- 4) Admin-only searchable deal picker ---------------------------------------
CREATE OR REPLACE FUNCTION public.fw_admin_search_releasable_deals_v1(
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 25
) RETURNS TABLE(
  match_id uuid,
  display_reference text,
  buyer_org_name text,
  seller_org_name text,
  deal_status text,
  created_at timestamptz,
  evidence_document_count integer
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q text := trim(coalesce(p_query,''));
  v_limit integer := least(greatest(coalesce(p_limit,25), 1), 100);
  v_uuid uuid := NULL;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'fw.forbidden: platform_admin required';
  END IF;

  BEGIN
    IF v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_uuid := v_q::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN v_uuid := NULL; END;

  RETURN QUERY
  SELECT m.id AS match_id,
         coalesce(nullif(m.hash,''), m.id::text) AS display_reference,
         coalesce(bo.legal_name, bo.trading_name, m.buyer_name)  AS buyer_org_name,
         coalesce(so.legal_name, so.trading_name, m.seller_name) AS seller_org_name,
         coalesce(m.state, m.status, 'unknown') AS deal_status,
         m.created_at,
         (SELECT count(*)::int FROM public.match_documents d WHERE d.match_id = m.id) AS evidence_document_count
    FROM public.matches m
    LEFT JOIN public.organizations bo ON bo.id = m.buyer_org_id
    LEFT JOIN public.organizations so ON so.id = m.seller_org_id
   WHERE (v_uuid IS NOT NULL AND m.id = v_uuid)
      OR (v_uuid IS NULL AND (
            v_q = ''
            OR m.hash ILIKE '%'||v_q||'%'
            OR m.buyer_name  ILIKE '%'||v_q||'%'
            OR m.seller_name ILIKE '%'||v_q||'%'
            OR m.commodity   ILIKE '%'||v_q||'%'
            OR coalesce(bo.legal_name,'') ILIKE '%'||v_q||'%'
            OR coalesce(so.legal_name,'') ILIKE '%'||v_q||'%'
         ))
   ORDER BY m.created_at DESC
   LIMIT v_limit;
END; $$;

REVOKE EXECUTE ON FUNCTION public.fw_admin_search_releasable_deals_v1(text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fw_admin_search_releasable_deals_v1(text,integer) TO authenticated, service_role;

-- 5) Admin-only manual linkage of legacy release -----------------------------
CREATE OR REPLACE FUNCTION public.fw_admin_link_release_to_match_v1(
  p_release_id uuid,
  p_match_id uuid,
  p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_r public.funder_deal_releases;
  v_match record;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'fw.forbidden: platform_admin required';
  END IF;
  IF coalesce(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'fw.validation: linkage reason required';
  END IF;

  SELECT * INTO v_r FROM public.funder_deal_releases WHERE id = p_release_id FOR UPDATE;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'fw.not_found: release not found';
  END IF;
  IF v_r.deal_linkage_status = 'canonical' AND v_r.match_id IS NOT NULL THEN
    RAISE EXCEPTION 'fw.invalid_state: release already canonically linked (use a separately audited correction path)';
  END IF;

  SELECT id INTO v_match FROM public.matches WHERE id = p_match_id;
  IF v_match.id IS NULL THEN
    RAISE EXCEPTION 'fw.validation: canonical deal not found';
  END IF;

  UPDATE public.funder_deal_releases
     SET match_id = p_match_id,
         deal_linkage_status = 'legacy_fallback',
         deal_linked_at = now(),
         deal_linked_by = auth.uid(),
         deal_linkage_reason = p_reason
   WHERE id = p_release_id;

  PERFORM public.fw_audit('funder_deal.linked_to_match', v_r.funder_organisation_id,
    'funder_deal_release', p_release_id,
    jsonb_build_object('prior_match_id', v_r.match_id,
                       'prior_deal_linkage_status', v_r.deal_linkage_status),
    jsonb_build_object('match_id', p_match_id,
                       'deal_linkage_status','legacy_fallback'),
    p_reason);
  PERFORM public.fw_record_usage(v_r.funder_organisation_id, v_r.deal_reference, p_release_id, NULL,
    'deal_released',
    jsonb_build_object('linkage_action','link_to_match','match_id', p_match_id, 'reason', p_reason));
END; $$;

REVOKE EXECUTE ON FUNCTION public.fw_admin_link_release_to_match_v1(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fw_admin_link_release_to_match_v1(uuid,uuid,text) TO authenticated, service_role;

-- 6) Update pack-content projection to prefer canonical match_id -------------
CREATE OR REPLACE FUNCTION public.fw_admin_funder_pack_content_v1(
  p_release_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_r public.funder_deal_releases;
  v_match record;
  v_match_resolved boolean := false;
  v_linkage_mode text := 'unresolved';
  v_buyer_org record;
  v_seller_org record;
  v_wad record;
  v_wad_found boolean := false;
  v_buyer_summary jsonb;
  v_seller_summary jsonb;
  v_verification jsonb;
  v_idv_kyb jsonb;
  v_wad_status jsonb;
  v_evidence_register jsonb;
  v_missing_evidence jsonb;
  v_risk_exceptions jsonb;
  v_result jsonb;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'fw.forbidden: platform_admin required';
  END IF;

  SELECT * INTO v_r FROM public.funder_deal_releases WHERE id = p_release_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fw.not_found: release not found';
  END IF;

  -- Canonical match_id takes priority. Fall back to legacy free-text
  -- deal_reference (UUID-shaped) ONLY when no canonical link exists.
  IF v_r.match_id IS NOT NULL THEN
    SELECT * INTO v_match FROM public.matches WHERE id = v_r.match_id;
    IF FOUND THEN
      v_match_resolved := true;
      v_linkage_mode := CASE WHEN v_r.deal_linkage_status = 'canonical' THEN 'canonical' ELSE 'legacy_fallback' END;
    ELSE
      v_linkage_mode := 'invalid';
    END IF;
  ELSE
    BEGIN
      IF v_r.deal_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT * INTO v_match FROM public.matches WHERE id = v_r.deal_reference::uuid;
        IF FOUND THEN
          v_match_resolved := true;
          v_linkage_mode := 'legacy_fallback';
        ELSE
          v_linkage_mode := 'unresolved';
        END IF;
      ELSE
        v_linkage_mode := 'unresolved';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_match_resolved := false;
      v_linkage_mode := 'unresolved';
    END;
  END IF;

  IF v_match_resolved THEN
    SELECT id, legal_name, trading_name, registration_number, jurisdictions
      INTO v_buyer_org FROM public.organizations WHERE id = v_match.buyer_org_id;
    SELECT id, legal_name, trading_name, registration_number, jurisdictions
      INTO v_seller_org FROM public.organizations WHERE id = v_match.seller_org_id;

    v_buyer_summary := jsonb_build_object(
      'available', true, 'role', 'buyer',
      'legal_name', coalesce(v_buyer_org.legal_name, v_buyer_org.trading_name),
      'registration_number', v_buyer_org.registration_number,
      'jurisdictions', to_jsonb(coalesce(v_buyer_org.jurisdictions, ARRAY[]::text[]))
    );
    v_seller_summary := jsonb_build_object(
      'available', true, 'role', 'seller',
      'legal_name', coalesce(v_seller_org.legal_name, v_seller_org.trading_name),
      'registration_number', v_seller_org.registration_number,
      'jurisdictions', to_jsonb(coalesce(v_seller_org.jurisdictions, ARRAY[]::text[]))
    );

    SELECT jsonb_agg(jsonb_build_object(
      'party', CASE s.party_role WHEN 'buyer_company' THEN 'buyer' ELSE 'seller' END,
      'category', cs.category, 'state', cs.state,
      'decided_at', cs.decided_at, 'expires_at', cs.expires_at))
      INTO v_verification
      FROM public.p5scr_subjects s
      JOIN public.p5scr_check_state cs ON cs.subject_id = s.id
     WHERE s.party_role IN ('buyer_company','seller_company')
       AND s.organisation_id IN (v_match.buyer_org_id, v_match.seller_org_id)
       AND cs.category IN ('company_aml_sanctions','pep','watchlist_name','adverse_media_admin_triggered');

    SELECT jsonb_agg(jsonb_build_object(
      'party', CASE s.party_role WHEN 'buyer_company' THEN 'buyer' ELSE 'seller' END,
      'category', cs.category, 'state', cs.state, 'decided_at', cs.decided_at))
      INTO v_idv_kyb
      FROM public.p5scr_subjects s
      JOIN public.p5scr_check_state cs ON cs.subject_id = s.id
     WHERE s.party_role IN ('buyer_company','seller_company')
       AND s.organisation_id IN (v_match.buyer_org_id, v_match.seller_org_id)
       AND cs.category = 'idv_person';

    SELECT id, status, sealed_at, seal_hash, created_at INTO v_wad
      FROM public.wads WHERE poi_id = v_match.id
     ORDER BY created_at DESC LIMIT 1;
    v_wad_found := FOUND;

    IF v_wad_found THEN
      v_wad_status := jsonb_build_object(
        'available', true, 'exists', true, 'status', v_wad.status,
        'sealed', (v_wad.status = 'sealed'), 'reference', v_wad.id,
        'sealed_at', v_wad.sealed_at, 'has_seal_hash', (v_wad.seal_hash IS NOT NULL),
        'recorded_at', v_wad.created_at);
    ELSE
      v_wad_status := jsonb_build_object('available', true, 'exists', false, 'status', 'no_wad_recorded');
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
      'category', d.doc_type, 'label', d.filename, 'status', d.status,
      'has_hash', (d.sha256_hash IS NOT NULL), 'recorded_at', d.created_at) ORDER BY d.created_at)
      INTO v_evidence_register
      FROM public.match_documents d WHERE d.match_id = v_match.id;

    v_missing_evidence := jsonb_build_object(
      'available', false, 'status', 'not_configured',
      'reason', 'The platform lists evidence currently linked to this transaction. A complete required-evidence checklist has not been configured for this transaction.');

    BEGIN
      SELECT jsonb_agg(jsonb_build_object(
        'exception_type', e.exception_type, 'severity', e.priority, 'status', e.status,
        'external_safe_summary', e.external_safe_summary,
        'created_at', e.created_at, 'resolved_at', e.resolved_at))
        INTO v_risk_exceptions
        FROM public.p5b6_list_exceptions_safe(500, 0, NULL, NULL, NULL) e
       WHERE e.org_id IN (v_match.buyer_org_id, v_match.seller_org_id);
    EXCEPTION WHEN OTHERS THEN v_risk_exceptions := NULL; END;
  ELSE
    v_buyer_summary := jsonb_build_object('available', false, 'status', v_linkage_mode, 'reason', 'No canonical deal is linked to this release.');
    v_seller_summary := jsonb_build_object('available', false, 'status', v_linkage_mode, 'reason', 'No canonical deal is linked to this release.');
    v_verification := NULL;
    v_idv_kyb := NULL;
    v_wad_status := jsonb_build_object('available', false, 'status', v_linkage_mode, 'reason', 'No canonical deal is linked to this release.');
    v_evidence_register := NULL;
    v_missing_evidence := jsonb_build_object('available', false, 'status', 'not_configured',
      'reason', 'A complete required-evidence checklist has not been configured for this transaction.');
    v_risk_exceptions := NULL;
  END IF;

  v_result := jsonb_build_object(
    'deal_reference_resolved', v_match_resolved,
    'linkage_mode', v_linkage_mode,
    'match_id', CASE WHEN v_match_resolved THEN v_match.id ELSE NULL END,
    'buyer_summary', v_buyer_summary,
    'seller_summary', v_seller_summary,
    'verification_summary', coalesce(v_verification, '[]'::jsonb),
    'idv_kyb_summary', coalesce(v_idv_kyb, '[]'::jsonb),
    'wad_status', v_wad_status,
    'bank_confidence', jsonb_build_object(
      'available', false, 'status', 'not_applicable',
      'reason', 'No authoritative bank-confidence assessment is configured for this transaction.'),
    'evidence_register', coalesce(v_evidence_register, '[]'::jsonb),
    'missing_evidence', v_missing_evidence,
    'risk_exception_summary', coalesce(v_risk_exceptions, '[]'::jsonb),
    'risk_exception_scope', 'organisation',
    'finality_snapshot', jsonb_build_object(
      'available', false, 'status', 'not_configured',
      'reason', 'No finality record is linked to this transaction. A deterministic relationship between funder releases and P-5 Batch 4 finality records is not defined in this build.')
  );
  RETURN v_result;
END; $$;

REVOKE EXECUTE ON FUNCTION public.fw_admin_funder_pack_content_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fw_admin_funder_pack_content_v1(uuid) TO authenticated, service_role;
