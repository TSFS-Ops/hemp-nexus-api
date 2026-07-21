-- Funder Workspace: audited release-permission amendment (Platform Admin only)
-- Additive; no schema changes; reuses existing fw_audit event framework.

CREATE OR REPLACE FUNCTION public.fw_admin_update_release_permissions_v1(
  p_release_id uuid,
  p_can_view_evidence_summary boolean,
  p_can_view_evidence_room boolean,
  p_can_download_compiled_pack boolean,
  p_can_view_raw_documents boolean,
  p_can_download_raw_documents boolean,
  p_can_view_unmasked_sensitive_details boolean,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r      public.funder_deal_releases;
  v_reason text;
  v_old    jsonb;
  v_new    jsonb;
  v_changed boolean;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'fw.forbidden: only platform_admin may amend release permissions';
  END IF;

  IF p_release_id IS NULL THEN
    RAISE EXCEPTION 'fw.validation: release_id required';
  END IF;

  v_reason := trim(coalesce(p_reason,''));
  IF v_reason = '' THEN
    RAISE EXCEPTION 'fw.validation: reason required';
  END IF;

  IF p_can_view_evidence_summary IS NULL
     OR p_can_view_evidence_room IS NULL
     OR p_can_download_compiled_pack IS NULL
     OR p_can_view_raw_documents IS NULL
     OR p_can_download_raw_documents IS NULL
     OR p_can_view_unmasked_sensitive_details IS NULL THEN
    RAISE EXCEPTION 'fw.validation: all six permission flags are required';
  END IF;

  -- Raw-download consistency: cannot download raw docs without permission to view them.
  IF p_can_download_raw_documents = true AND p_can_view_raw_documents = false THEN
    RAISE EXCEPTION 'fw.validation: raw-document download requires raw-document view';
  END IF;

  SELECT * INTO v_r FROM public.funder_deal_releases WHERE id = p_release_id FOR UPDATE;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'fw.not_found: release';
  END IF;
  IF v_r.release_status = 'revoked' THEN
    RAISE EXCEPTION 'fw.invalid_state: cannot amend permissions on a revoked release';
  END IF;

  v_old := jsonb_build_object(
    'can_view_evidence_summary',            v_r.can_view_evidence_summary,
    'can_view_evidence_room',               v_r.can_view_evidence_room,
    'can_download_compiled_pack',           v_r.can_download_compiled_pack,
    'can_view_raw_documents',               v_r.can_view_raw_documents,
    'can_download_raw_documents',           v_r.can_download_raw_documents,
    'can_view_unmasked_sensitive_details',  v_r.can_view_unmasked_sensitive_details
  );
  v_new := jsonb_build_object(
    'can_view_evidence_summary',            p_can_view_evidence_summary,
    'can_view_evidence_room',               p_can_view_evidence_room,
    'can_download_compiled_pack',           p_can_download_compiled_pack,
    'can_view_raw_documents',               p_can_view_raw_documents,
    'can_download_raw_documents',           p_can_download_raw_documents,
    'can_view_unmasked_sensitive_details',  p_can_view_unmasked_sensitive_details
  );

  v_changed := v_old <> v_new;

  IF v_changed THEN
    UPDATE public.funder_deal_releases
       SET can_view_evidence_summary           = p_can_view_evidence_summary,
           can_view_evidence_room              = p_can_view_evidence_room,
           can_download_compiled_pack          = p_can_download_compiled_pack,
           can_view_raw_documents              = p_can_view_raw_documents,
           can_download_raw_documents          = p_can_download_raw_documents,
           can_view_unmasked_sensitive_details = p_can_view_unmasked_sensitive_details
     WHERE id = p_release_id;

    PERFORM public.fw_audit(
      'funder_deal.permissions_updated',
      v_r.funder_organisation_id,
      'funder_deal_release',
      p_release_id,
      v_old,
      v_new,
      v_reason
    );
  END IF;

  RETURN jsonb_build_object(
    'release_id', p_release_id,
    'changed', v_changed,
    'old', v_old,
    'new', v_new
  );
END;
$$;

-- Lock down execute: only authenticated + service_role (Platform-Admin gate lives inside the function).
REVOKE EXECUTE ON FUNCTION public.fw_admin_update_release_permissions_v1(
  uuid, boolean, boolean, boolean, boolean, boolean, boolean, text
) FROM PUBLIC;
DO $$ BEGIN
  BEGIN
    REVOKE EXECUTE ON FUNCTION public.fw_admin_update_release_permissions_v1(
      uuid, boolean, boolean, boolean, boolean, boolean, boolean, text
    ) FROM anon;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;
GRANT EXECUTE ON FUNCTION public.fw_admin_update_release_permissions_v1(
  uuid, boolean, boolean, boolean, boolean, boolean, boolean, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fw_admin_update_release_permissions_v1(
  uuid, boolean, boolean, boolean, boolean, boolean, boolean, text
) TO service_role;

COMMENT ON FUNCTION public.fw_admin_update_release_permissions_v1(
  uuid, boolean, boolean, boolean, boolean, boolean, boolean, text
) IS
'Platform-Admin-only. Amends the six permission flags on an existing non-revoked funder_deal_release. Rejects blank reason, non-admin callers, revoked releases, and raw-download without raw-view. Emits funder_deal.permissions_updated audit event with old/new values and reason. Never changes organisation, deal, evidence pack, consent, status, released_by, released_at or history.';
