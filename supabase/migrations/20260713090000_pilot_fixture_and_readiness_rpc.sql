-- ============================================================
-- Institutional Funder Evidence Workspace — Controlled Pilot
-- Fixture creation + independent readiness-check RPC.
--
-- NOT YET EXECUTED. This migration has not been applied to any database.
-- It must be applied and verified by a terminal-capable environment
-- (Lovable) before this pull request may be merged. See PR description
-- for the exact verification commands required.
--
-- Creates, using fixed synthetic identifiers, the demo fixtures required
-- for the manual pilot walkthrough:
--   * Pilot Funder Bank / Isolation Test Fund (p5_batch3_funder_organisations)
--   * DEMO — Acacia Trading Test Pty Ltd / DEMO — Blue River Exports Test
--     Pty Ltd (organizations, buyer/seller)
--   * DEMO — Acacia–Blue River Pilot Trade (matches, canonical demo match)
--   * DEMO pro-forma invoice / DEMO bill of lading (match_documents)
--   * One eligible Batch-2 evidence pack + pack item linked to that match
--
-- All inserts are idempotent via ON CONFLICT (id) DO NOTHING. Existing rows
-- at these fixed ids are NEVER overwritten by this migration. If a row
-- already exists with unexpected relationships, fw_admin_check_pilot_
-- fixtures_v1() below reports that as "Incorrectly linked" instead of this
-- migration silently repairing it.
-- ============================================================

DO $do$
DECLARE
  c_funder_bank_id uuid := '00000000-0000-4000-a000-000000000001';
  c_funder_isolation_id uuid := '00000000-0000-4000-a000-000000000002';
  c_buyer_org_id uuid := '00000000-0000-4000-a000-000000000003';
  c_seller_org_id uuid := '00000000-0000-4000-a000-000000000004';
  c_match_id uuid := '00000000-0000-4000-a000-000000000005';
  c_doc_invoice_id uuid := '00000000-0000-4000-a000-000000000006';
  c_doc_bol_id uuid := '00000000-0000-4000-a000-000000000007';
  c_kyc_record_id uuid := '00000000-0000-4000-a000-000000000008';
  c_evidence_item_id uuid := '00000000-0000-4000-a000-000000000009';
  c_evidence_version_id uuid := '00000000-0000-4000-a000-00000000000a';
  c_evidence_pack_id uuid := '00000000-0000-4000-a000-00000000000b';
  c_evidence_pack_item_id uuid := '00000000-0000-4000-a000-00000000000c';
BEGIN

  -- 1. Funder organisations ---------------------------------------------
  INSERT INTO public.p5_batch3_funder_organisations
    (id, name, jurisdiction, contact_email, status, approval_status, api_enabled, notes_internal)
  VALUES
    (c_funder_bank_id, 'Pilot Funder Bank', 'ZA', 'pilot-funder-bank@izenzo.test',
       'active', 'admin_created', false,
       'Controlled-pilot fixture. Created by 20260713090000 migration. Do not use for real funder onboarding.')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.p5_batch3_funder_organisations
    (id, name, jurisdiction, contact_email, status, approval_status, api_enabled, notes_internal)
  VALUES
    (c_funder_isolation_id, 'Isolation Test Fund', 'ZA', 'isolation-test-fund@izenzo.test',
         'active', 'admin_created', false,
         'Controlled-pilot fixture used ONLY to prove tenant isolation. Must never be linked to the demo match.')
  ON CONFLICT (id) DO NOTHING;

  -- 2. Demo trading organisations -----------------------------------------
  INSERT INTO public.organizations
    (id, name, status, legal_name, trading_name, jurisdictions)
  VALUES
    (c_buyer_org_id, 'DEMO — Acacia Trading Test Pty Ltd', 'active',
         'DEMO — Acacia Trading Test Pty Ltd', 'Acacia Trading (Test)', ARRAY['ZA'])
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.organizations
    (id, name, status, legal_name, trading_name, jurisdictions)
  VALUES
    (c_seller_org_id, 'DEMO — Blue River Exports Test Pty Ltd', 'active',
         'DEMO — Blue River Exports Test Pty Ltd', 'Blue River Exports (Test)', ARRAY['ZA'])
  ON CONFLICT (id) DO NOTHING;

  -- 3. Canonical demo match ------------------------------------------------
  INSERT INTO public.matches
    (id, status, hash, buyer_id, buyer_name, seller_id, seller_name, commodity,
         quantity_amount, quantity_unit, price_amount, price_currency, terms,
         buyer_org_id, seller_org_id, metadata)
  VALUES
    (c_match_id, 'matched', 'DEMO-ACACIA-BLUERIVER-PILOT-TRADE',
         c_buyer_org_id::text, 'DEMO — Acacia Trading Test Pty Ltd',
         c_seller_org_id::text, 'DEMO — Blue River Exports Test Pty Ltd',
         'Industrial hemp fibre (controlled-pilot demo)',
         10, 'MT', 1000, 'USD', 'Controlled-pilot fixture — not a real trade.',
         c_buyer_org_id, c_seller_org_id,
         jsonb_build_object('demo_match_label', 'DEMO — Acacia–Blue River Pilot Trade', 'pilot_fixture', true))
  ON CONFLICT (id) DO NOTHING;

  -- 4. Demo documents -------------------------------------------------------
  INSERT INTO public.match_documents
    (id, match_id, org_id, doc_type, filename, storage_path, sha256_hash, status,
         title, visibility, version, uploader_org_id, notes)
  VALUES
    (c_doc_invoice_id, c_match_id, c_seller_org_id, 'pro_forma_invoice',
         'demo-acacia-blueriver-proforma-invoice.pdf',
         'pilot-fixtures/demo-acacia-blueriver-proforma-invoice.pdf',
         'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
         'accepted', 'DEMO pro-forma invoice', 'private', 1, c_seller_org_id,
         'Controlled-pilot fixture document.')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.match_documents
    (id, match_id, org_id, doc_type, filename, storage_path, sha256_hash, status,
         title, visibility, version, uploader_org_id, notes)
  VALUES
    (c_doc_bol_id, c_match_id, c_seller_org_id, 'bill_of_lading',
         'demo-acacia-blueriver-bill-of-lading.pdf',
         'pilot-fixtures/demo-acacia-blueriver-bill-of-lading.pdf',
         'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
         'accepted', 'DEMO bill of lading', 'private', 1, c_seller_org_id,
         'Controlled-pilot fixture document.')
  ON CONFLICT (id) DO NOTHING;

  -- 5. Evidence subject (KYC record whose subject is the demo match) -------
  INSERT INTO public.p5_batch2_kyc_records
    (id, record_type, display_name, jurisdiction, match_id, status_summary)
  VALUES
    (c_kyc_record_id, 'transaction_party',
         'DEMO — Acacia–Blue River Pilot Trade — Evidence Subject', 'ZA', c_match_id,
         'Controlled-pilot fixture.')
  ON CONFLICT (id) DO NOTHING;

  -- 6. Evidence item ---------------------------------------------------------
  INSERT INTO public.p5_batch2_evidence_items
    (id, record_id, category, requirement_level, status, rating, customer_safe_note)
  VALUES
    (c_evidence_item_id, c_kyc_record_id, 'trade_evidence_pack', 'mandatory',
         'accepted', 'strong', 'Controlled-pilot fixture evidence item.')
  ON CONFLICT (id) DO NOTHING;

  -- 7. Evidence version (append-only; current) --------------------------------
  INSERT INTO public.p5_batch2_evidence_versions
    (id, evidence_item_id, version_number, file_hash, mime_type, uploader_role, is_current, audit_reference)
  VALUES
    (c_evidence_version_id, c_evidence_item_id, 1,
         'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3',
         'application/pdf', 'platform_admin', true, 'pilot-fixture-v1')
  ON CONFLICT (id) DO NOTHING;

  -- Non-destructive fix-up: point the evidence item at its current version
  -- ONLY if it doesn't already point somewhere else. Never overwrite an
  -- existing, unexpected pointer — that case is reported as
  -- "Incorrectly linked" by the readiness RPC instead.
  UPDATE public.p5_batch2_evidence_items
  SET current_version_id = c_evidence_version_id
  WHERE id = c_evidence_item_id
    AND current_version_id IS NULL;

  -- 8. Evidence pack + pack item -----------------------------------------------
  INSERT INTO public.p5_batch2_evidence_packs
    (id, organization_id, match_id, pack_reason, pack_status, metadata)
  VALUES
    (c_evidence_pack_id, c_seller_org_id, c_match_id,
         'Controlled-pilot fixture evidence pack for the demo match.', 'sealed',
         jsonb_build_object('pilot_fixture', true))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.p5_batch2_evidence_pack_items
    (id, pack_id, evidence_item_id, version_id, snapshot_status, snapshot_rating, snapshot_file_hash)
  VALUES
    (c_evidence_pack_item_id, c_evidence_pack_id, c_evidence_item_id, c_evidence_version_id,
         'accepted', 'strong',
         'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3')
  ON CONFLICT (id) DO NOTHING;

END $do$;

-- ============================================================
-- Readiness RPC — independently verifies the fixtures above.
-- Reuses fw_admin_list_eligible_evidence_packs_v1 as the single source of
-- truth for evidence-pack eligibility instead of re-implementing its rules.
-- Returns exactly one of: 'Ready', 'Missing', 'Incorrectly linked'.
--
-- Check 9 (isolation_no_release) proves Isolation Test Fund has zero
-- funder_deal_releases rows linking it to the fixed demo match. This is
-- independent of whether the manual release has been created yet: with
-- no funder_deal_releases row at all this reads Ready, because the
-- absence of any link is exactly what isolation requires. It only reads
-- Missing if the Isolation Test Fund fixture or the demo match itself do
-- not exist yet (see checks 2 and 5). It never selects an arbitrary
-- "first" release and never infers the demo match from release data —
-- it always uses the fixed c_funder_isolation_id / c_match_id constants
-- and reads directly from public.funder_deal_releases, which links to
-- public.p5_batch3_funder_organisations via funder_organisation_id (NOT
-- public.organizations, which has no row for Isolation Test Fund).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fw_admin_check_pilot_fixtures_v1()
RETURNS TABLE(check_key text, label text, status text, detail text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c_funder_bank_id uuid := '00000000-0000-4000-a000-000000000001';
  c_funder_isolation_id uuid := '00000000-0000-4000-a000-000000000002';
  c_buyer_org_id uuid := '00000000-0000-4000-a000-000000000003';
  c_seller_org_id uuid := '00000000-0000-4000-a000-000000000004';
  c_match_id uuid := '00000000-0000-4000-a000-000000000005';
  c_doc_invoice_id uuid := '00000000-0000-4000-a000-000000000006';
  c_doc_bol_id uuid := '00000000-0000-4000-a000-000000000007';
  c_evidence_item_id uuid := '00000000-0000-4000-a000-000000000009';
  c_evidence_version_id uuid := '00000000-0000-4000-a000-00000000000a';
  c_evidence_pack_id uuid := '00000000-0000-4000-a000-00000000000b';
  c_pack_item_id uuid := '00000000-0000-4000-a000-00000000000c';

  r_bank record; r_iso record; r_buyer record; r_seller record;
  r_match record; r_inv record; r_bol record; r_item record;
  r_pack record; r_pack_item record; r_eligible record;

  s1 text; d1 text; s2 text; d2 text; s3 text; d3 text; s4 text; d4 text;
  s5 text; d5 text; s6 text; d6 text; s7 text; d7 text; s8 text; d8 text;
  s9 text; d9 text;
  v_isolation_release_count int;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'fw.forbidden: platform_admin required';
  END IF;

  -- 1. Pilot Funder Bank
  SELECT * INTO r_bank FROM public.p5_batch3_funder_organisations WHERE id = c_funder_bank_id;
  IF r_bank.id IS NULL THEN
    s1 := 'Missing'; d1 := 'No funder organisation row found for the fixed Pilot Funder Bank id.';
  ELSIF r_bank.name IS DISTINCT FROM 'Pilot Funder Bank'
     OR r_bank.status IS DISTINCT FROM 'active'::public.p5_batch3_funder_org_status
     OR NOT public.fw_is_funder_org_approved_v1(r_bank.id) THEN
    s1 := 'Incorrectly linked'; d1 := 'Row exists at the fixed id but name/status/approval do not match the expected pilot fixture.';
  ELSE
    s1 := 'Ready'; d1 := 'Pilot Funder Bank is active and approved.';
  END IF;

  -- 2. Isolation Test Fund
  SELECT * INTO r_iso FROM public.p5_batch3_funder_organisations WHERE id = c_funder_isolation_id;
  IF r_iso.id IS NULL THEN
    s2 := 'Missing'; d2 := 'No funder organisation row found for the fixed Isolation Test Fund id.';
  ELSIF r_iso.name IS DISTINCT FROM 'Isolation Test Fund'
     OR r_iso.status IS DISTINCT FROM 'active'::public.p5_batch3_funder_org_status
     OR NOT public.fw_is_funder_org_approved_v1(r_iso.id) THEN
    s2 := 'Incorrectly linked'; d2 := 'Row exists at the fixed id but name/status/approval do not match the expected pilot fixture.';
  ELSE
    s2 := 'Ready'; d2 := 'Isolation Test Fund is active and approved (must never be assigned the demo deal).';
  END IF;

  -- 3. Buyer organisation
  SELECT * INTO r_buyer FROM public.organizations WHERE id = c_buyer_org_id;
  IF r_buyer.id IS NULL THEN
    s3 := 'Missing'; d3 := 'No organisation row found for the fixed Acacia buyer id.';
  ELSIF r_buyer.name IS DISTINCT FROM 'DEMO — Acacia Trading Test Pty Ltd' THEN
    s3 := 'Incorrectly linked'; d3 := 'Row exists at the fixed id but its name does not match the expected demo buyer.';
  ELSIF NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.id = c_match_id AND m.buyer_org_id = c_buyer_org_id) THEN
    s3 := 'Incorrectly linked'; d3 := 'Buyer organisation exists but is not attached to the demo match as buyer_org_id.';
  ELSE
    s3 := 'Ready'; d3 := 'DEMO — Acacia Trading Test Pty Ltd exists and is attached to the demo match as buyer.';
  END IF;

  -- 4. Seller organisation
  SELECT * INTO r_seller FROM public.organizations WHERE id = c_seller_org_id;
  IF r_seller.id IS NULL THEN
    s4 := 'Missing'; d4 := 'No organisation row found for the fixed Blue River seller id.';
  ELSIF r_seller.name IS DISTINCT FROM 'DEMO — Blue River Exports Test Pty Ltd' THEN
    s4 := 'Incorrectly linked'; d4 := 'Row exists at the fixed id but its name does not match the expected demo seller.';
  ELSIF NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.id = c_match_id AND m.seller_org_id = c_seller_org_id) THEN
    s4 := 'Incorrectly linked'; d4 := 'Seller organisation exists but is not attached to the demo match as seller_org_id.';
  ELSE
    s4 := 'Ready'; d4 := 'DEMO — Blue River Exports Test Pty Ltd exists and is attached to the demo match as seller.';
  END IF;

  -- 5. Canonical demo match
  SELECT * INTO r_match FROM public.matches WHERE id = c_match_id;
  IF r_match.id IS NULL THEN
    s5 := 'Missing'; d5 := 'No match row found for the fixed demo-match id.';
  ELSIF r_match.buyer_org_id IS DISTINCT FROM c_buyer_org_id
     OR r_match.seller_org_id IS DISTINCT FROM c_seller_org_id
     OR r_match.buyer_name IS DISTINCT FROM 'DEMO — Acacia Trading Test Pty Ltd'
     OR r_match.seller_name IS DISTINCT FROM 'DEMO — Blue River Exports Test Pty Ltd' THEN
    s5 := 'Incorrectly linked'; d5 := 'Match row exists at the fixed id but buyer/seller linkage does not match the expected pilot fixture.';
  ELSE
    s5 := 'Ready'; d5 := 'DEMO — Acacia–Blue River Pilot Trade is present and correctly linked to both demo organisations.';
  END IF;

  -- 6. Demo pro-forma invoice
  SELECT * INTO r_inv FROM public.match_documents WHERE id = c_doc_invoice_id;
  IF r_inv.id IS NULL THEN
    s6 := 'Missing'; d6 := 'No document row found for the fixed demo pro-forma invoice id.';
  ELSIF r_inv.match_id IS DISTINCT FROM c_match_id OR r_inv.status IN ('rejected','revoked','archived','expired') THEN
    s6 := 'Incorrectly linked'; d6 := 'Invoice document exists but is not attached to the demo match or is not in a usable status.';
  ELSE
    s6 := 'Ready'; d6 := 'DEMO pro-forma invoice is attached to the demo match.';
  END IF;

  -- 7. Demo bill of lading
  SELECT * INTO r_bol FROM public.match_documents WHERE id = c_doc_bol_id;
  IF r_bol.id IS NULL THEN
    s7 := 'Missing'; d7 := 'No document row found for the fixed demo bill-of-lading id.';
  ELSIF r_bol.match_id IS DISTINCT FROM c_match_id OR r_bol.status IN ('rejected','revoked','archived','expired') THEN
    s7 := 'Incorrectly linked'; d7 := 'Bill of lading exists but is not attached to the demo match or is not in a usable status.';
  ELSE
    s7 := 'Ready'; d7 := 'DEMO bill of lading is attached to the demo match.';
  END IF;

  -- 8. Eligible evidence pack (delegates eligibility to fw_admin_list_eligible_evidence_packs_v1)
  SELECT * INTO r_pack FROM public.p5_batch2_evidence_packs WHERE id = c_evidence_pack_id;
  SELECT * INTO r_pack_item FROM public.p5_batch2_evidence_pack_items WHERE id = c_pack_item_id;
  SELECT * INTO r_item FROM public.p5_batch2_evidence_items WHERE id = c_evidence_item_id;

  IF r_pack.id IS NULL OR r_pack_item.id IS NULL OR r_item.id IS NULL THEN
    s8 := 'Missing'; d8 := 'The demo evidence pack, its pack item, or its evidence item has not been created.';
  ELSIF r_pack.match_id IS DISTINCT FROM c_match_id
     OR r_pack_item.pack_id IS DISTINCT FROM c_evidence_pack_id
     OR r_pack_item.evidence_item_id IS DISTINCT FROM c_evidence_item_id
     OR r_pack_item.version_id IS DISTINCT FROM c_evidence_version_id
     OR r_item.current_version_id IS DISTINCT FROM c_evidence_version_id THEN
    s8 := 'Incorrectly linked'; d8 := 'The evidence pack exists but its pack item does not point to the correct evidence item/version for the demo match.';
  ELSE
    SELECT * INTO r_eligible
    FROM public.fw_admin_list_eligible_evidence_packs_v1(c_match_id) ep
    WHERE ep.evidence_pack_id = c_evidence_pack_id;
    IF r_eligible.evidence_pack_id IS NULL THEN
      s8 := 'Incorrectly linked'; d8 := 'Pack/version links look correct, but fw_admin_list_eligible_evidence_packs_v1 does not consider this pack eligible for release yet.';
    ELSE
      s8 := 'Ready'; d8 := 'Eligible synthetic evidence pack — ' || r_eligible.label || ' is ready for the demo match.';
    END IF;
  END IF;

  -- 9. Isolation proof — Isolation Test Fund must have zero releases
  -- linking it to the demo match. Absence of any release is Ready; this
  -- never requires a release to already exist.
  IF r_iso.id IS NULL OR r_match.id IS NULL THEN
    s9 := 'Missing'; d9 := 'Cannot check isolation until the Isolation Test Fund and the demo match both exist (see checks above).';
  ELSE
    SELECT count(*) INTO v_isolation_release_count
    FROM public.funder_deal_releases
    WHERE match_id = c_match_id
      AND funder_organisation_id = c_funder_isolation_id;
    IF v_isolation_release_count > 0 THEN
      s9 := 'Incorrectly linked';
      d9 := v_isolation_release_count || ' release(s) incorrectly link the demo match to Isolation Test Fund. Investigate before the pilot proceeds.';
    ELSE
      s9 := 'Ready'; d9 := 'Isolation Test Fund has zero releases linked to the demo match.';
    END IF;
  END IF;

  RETURN QUERY VALUES
    ('funder_org_bank', 'Funder organisation — Pilot Funder Bank', s1, d1),
    ('funder_org_isolation', 'Funder organisation — Isolation Test Fund', s2, d2),
    ('buyer_org', 'Buyer trader — DEMO — Acacia Trading Test Pty Ltd', s3, d3),
    ('seller_org', 'Seller trader — DEMO — Blue River Exports Test Pty Ltd', s4, d4),
    ('demo_match', 'Canonical demo match — DEMO — Acacia–Blue River Pilot Trade', s5, d5),
    ('doc_invoice', 'DEMO pro-forma invoice', s6, d6),
    ('doc_bol', 'DEMO bill of lading', s7, d7),
    ('evidence_pack', 'Eligible synthetic evidence pack — Evidence Pack — Version 1', s8, d8),
    ('isolation_no_release', 'Isolation Test Fund — no release linked to the demo match', s9, d9);
END; $$;

REVOKE EXECUTE ON FUNCTION public.fw_admin_check_pilot_fixtures_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fw_admin_check_pilot_fixtures_v1() TO authenticated, service_role;
