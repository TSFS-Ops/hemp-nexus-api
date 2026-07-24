-- Institutional Funder Evidence Workspace -- Batch 5 (External Adviser)
-- Genuine gap closed: fw_funder_authorize_pack_download_v1 checked org
-- membership and the release's can_download_compiled_pack flag, but never
-- checked the caller's per-release V1 role. Per the V1 role matrix, the
-- External Adviser role is read-only and must never be able to download a
-- compiled pack, even when the release enables downloads for the org.
-- Additive only: same signature, same return shape, same audit/usage
-- logging calls; only a new fail-closed role check is inserted.

CREATE OR REPLACE FUNCTION public.fw_funder_authorize_pack_download_v1(
  p_pack_version_id uuid
  ) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
v_pv public.funder_pack_versions;
v_r public.funder_deal_releases;
v_org uuid;
v_now timestamptz := now();
BEGIN
IF auth.uid() IS NULL THEN
RAISE EXCEPTION 'fw.forbidden: authentication required';
END IF;

v_org := public.p5b3_current_funder_org();
IF v_org IS NULL THEN
RAISE EXCEPTION 'fw.forbidden: not a funder user';
END IF;

SELECT * INTO v_pv FROM public.funder_pack_versions WHERE id = p_pack_version_id;
IF NOT FOUND THEN
RAISE EXCEPTION 'fw.not_found: pack version not available';
END IF;

SELECT * INTO v_r FROM public.funder_deal_releases WHERE id = v_pv.release_id;
IF NOT FOUND OR v_r.funder_organisation_id <> v_org THEN
RAISE EXCEPTION 'fw.not_found: pack version not available';
END IF;

IF public.fw_v1_role_for_release(v_r.id) = 'external_adviser' THEN
RAISE EXCEPTION 'fw.forbidden: external_adviser role is read-only and may not download packs';
END IF;

IF v_r.release_status <> 'active' THEN
RAISE EXCEPTION 'fw.state: release is not active';
END IF;
IF v_r.expires_at IS NOT NULL AND v_r.expires_at <= v_now THEN
RAISE EXCEPTION 'fw.state: release has expired';
END IF;
IF NOT v_r.can_download_compiled_pack THEN
RAISE EXCEPTION 'fw.forbidden: compiled pack download is not enabled for this release';
END IF;
IF v_pv.status NOT IN ('generated','sealed') OR v_pv.storage_path IS NULL OR v_pv.storage_bucket IS NULL THEN
RAISE EXCEPTION 'fw.state: pack version is not available for download';
END IF;

PERFORM public.fw_audit(
  'funder_pack.download_authorized', v_r.funder_organisation_id,
  'funder_pack_version', v_pv.id,
  NULL,
  jsonb_build_object('version', v_pv.version, 'release_id', v_r.id),
  NULL
  );
PERFORM public.fw_record_usage(
  v_r.funder_organisation_id, v_r.deal_reference, v_r.id, v_pv.id,
  'pack_downloaded',
  jsonb_build_object('version', v_pv.version, 'file_sha256', v_pv.file_sha256)
  );

RETURN jsonb_build_object(
  'pack_version_id', v_pv.id,
  'release_id', v_r.id,
  'storage_bucket', v_pv.storage_bucket,
  'storage_path', v_pv.storage_path,
  'file_sha256', v_pv.file_sha256,
  'version', v_pv.version
  );
END; $$;

REVOKE EXECUTE ON FUNCTION public.fw_funder_authorize_pack_download_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fw_funder_authorize_pack_download_v1(uuid) TO authenticated, service_role;
