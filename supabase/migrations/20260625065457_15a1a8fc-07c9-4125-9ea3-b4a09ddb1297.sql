
-- ============================================================
-- P-5 Batch 3 Stage 3 — server-authoritative RPC layer
-- ============================================================

-- ---------- Helper: actor role (extends Stage 1 helpers) ----------
CREATE OR REPLACE FUNCTION public.p5b3_actor_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_funder_role public.p5_batch3_funder_role;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 'anonymous';
  END IF;
  IF public.has_role(v_uid, 'platform_admin'::public.app_role) THEN
    RETURN 'platform_admin';
  END IF;
  SELECT fu.role INTO v_funder_role
  FROM public.p5_batch3_funder_users fu
  WHERE fu.auth_user_id = v_uid AND fu.status = 'active'
  LIMIT 1;
  IF v_funder_role IS NOT NULL THEN
    RETURN v_funder_role::text;
  END IF;
  RETURN 'internal_other';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b3_actor_role() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.p5b3_actor_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.p5b3_actor_role() TO authenticated, service_role;

-- ---------- Internal audit writer ----------
CREATE OR REPLACE FUNCTION public.p5b3_audit(
  p_action text,
  p_funder_org uuid,
  p_funder_user uuid,
  p_role public.p5_batch3_funder_role,
  p_transaction_ref text,
  p_object_type text,
  p_object_id uuid,
  p_prior jsonb,
  p_new jsonb,
  p_reason_code text,
  p_note text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.p5_batch3_funder_audit_events(
    user_id, funder_organisation_id, funder_user_id, role, action,
    transaction_reference, object_type, object_id, prior_state, new_state,
    reason_code, note, source_channel
  ) VALUES (
    auth.uid(), p_funder_org, p_funder_user, p_role, p_action,
    p_transaction_ref, p_object_type, p_object_id, p_prior, p_new,
    p_reason_code, p_note, 'rpc'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b3_audit(text,uuid,uuid,public.p5_batch3_funder_role,text,text,uuid,jsonb,jsonb,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.p5b3_audit(text,uuid,uuid,public.p5_batch3_funder_role,text,text,uuid,jsonb,jsonb,text,text) FROM anon;
-- only service_role can call directly; admin/funder RPCs invoke it under SECURITY DEFINER
GRANT EXECUTE ON FUNCTION public.p5b3_audit(text,uuid,uuid,public.p5_batch3_funder_role,text,text,uuid,jsonb,jsonb,text,text) TO service_role;

-- ============================================================
-- Admin: funder organisations
-- ============================================================
CREATE OR REPLACE FUNCTION public.p5b3_admin_create_funder_org_v1(
  p_name text, p_registration_number text, p_jurisdiction text,
  p_contact_email text, p_notes_internal text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'p5b3.forbidden: platform_admin required';
  END IF;
  IF coalesce(trim(p_name),'') = '' THEN
    RAISE EXCEPTION 'p5b3.validation: name required';
  END IF;
  INSERT INTO public.p5_batch3_funder_organisations(
    name, registration_number, jurisdiction, contact_email, notes_internal, created_by
  ) VALUES (p_name, p_registration_number, p_jurisdiction, p_contact_email, p_notes_internal, auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.p5b3_audit('funder_org.created', v_id, NULL, NULL, NULL,
    'funder_organisation', v_id, NULL,
    jsonb_build_object('name', p_name, 'jurisdiction', p_jurisdiction),
    NULL, NULL);
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.p5b3_admin_update_funder_org_v1(
  p_org_id uuid, p_patch jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prior jsonb;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'p5b3.forbidden: platform_admin required';
  END IF;
  SELECT to_jsonb(o) INTO v_prior FROM public.p5_batch3_funder_organisations o WHERE o.id = p_org_id;
  IF v_prior IS NULL THEN RAISE EXCEPTION 'p5b3.not_found: funder organisation'; END IF;
  UPDATE public.p5_batch3_funder_organisations
     SET name = coalesce(p_patch->>'name', name),
         registration_number = coalesce(p_patch->>'registration_number', registration_number),
         jurisdiction = coalesce(p_patch->>'jurisdiction', jurisdiction),
         contact_email = coalesce(p_patch->>'contact_email', contact_email),
         status = coalesce((p_patch->>'status')::public.p5_batch3_funder_org_status, status),
         notes_internal = coalesce(p_patch->>'notes_internal', notes_internal)
   WHERE id = p_org_id;
  PERFORM public.p5b3_audit('funder_org.updated', p_org_id, NULL, NULL, NULL,
    'funder_organisation', p_org_id, v_prior, p_patch, NULL, NULL);
END; $$;

-- ============================================================
-- Admin: funder users
-- ============================================================
CREATE OR REPLACE FUNCTION public.p5b3_admin_invite_funder_user_v1(
  p_org_id uuid, p_email text, p_display_name text,
  p_role public.p5_batch3_funder_role
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'p5b3.forbidden: platform_admin required';
  END IF;
  IF coalesce(trim(p_email),'') = '' THEN
    RAISE EXCEPTION 'p5b3.validation: email required';
  END IF;
  INSERT INTO public.p5_batch3_funder_users(
    funder_organisation_id, email, display_name, role, status, invited_by
  ) VALUES (p_org_id, lower(p_email), p_display_name, p_role, 'invited', auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.p5b3_audit('funder_user.invited', p_org_id, v_id, p_role, NULL,
    'funder_user', v_id, NULL,
    jsonb_build_object('email', lower(p_email), 'role', p_role), NULL, NULL);
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.p5b3_admin_assign_funder_role_v1(
  p_user_id uuid, p_role public.p5_batch3_funder_role
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prior public.p5_batch3_funder_role; v_org uuid;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'p5b3.forbidden: platform_admin required';
  END IF;
  SELECT role, funder_organisation_id INTO v_prior, v_org
    FROM public.p5_batch3_funder_users WHERE id = p_user_id;
  IF v_prior IS NULL THEN RAISE EXCEPTION 'p5b3.not_found: funder user'; END IF;
  UPDATE public.p5_batch3_funder_users SET role = p_role WHERE id = p_user_id;
  PERFORM public.p5b3_audit('funder_user.role_changed', v_org, p_user_id, p_role, NULL,
    'funder_user', p_user_id,
    jsonb_build_object('role', v_prior),
    jsonb_build_object('role', p_role), NULL, NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.p5b3_admin_set_funder_user_status_v1(
  p_user_id uuid, p_status public.p5_batch3_funder_user_status, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_prior public.p5_batch3_funder_user_status;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'p5b3.forbidden: platform_admin required';
  END IF;
  SELECT funder_organisation_id, status INTO v_org, v_prior
    FROM public.p5_batch3_funder_users WHERE id = p_user_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'p5b3.not_found: funder user'; END IF;
  UPDATE public.p5_batch3_funder_users
     SET status = p_status,
         deactivated_at = CASE WHEN p_status = 'deactivated' THEN now() ELSE NULL END,
         accepted_at = CASE WHEN p_status = 'active' AND accepted_at IS NULL THEN now() ELSE accepted_at END
   WHERE id = p_user_id;
  -- cascade: deactivating user revokes their active grants
  IF p_status = 'deactivated' THEN
    UPDATE public.p5_batch3_funder_access_grants
       SET status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
           revocation_reason = coalesce(p_reason, 'funder_user_deactivated')
     WHERE funder_user_id = p_user_id AND status = 'active';
  END IF;
  PERFORM public.p5b3_audit('funder_user.status_changed', v_org, p_user_id, NULL, NULL,
    'funder_user', p_user_id,
    jsonb_build_object('status', v_prior),
    jsonb_build_object('status', p_status), p_reason, NULL);
END; $$;

-- ============================================================
-- Admin: access grants
-- ============================================================
CREATE OR REPLACE FUNCTION public.p5b3_admin_create_access_grant_v1(
  p_user_id uuid,
  p_transaction_reference text,
  p_deal_id uuid,
  p_evidence_pack_id uuid,
  p_evidence_pack_version text,
  p_role public.p5_batch3_funder_role,
  p_access_scope jsonb,
  p_permitted_categories text[],
  p_can_download boolean,
  p_can_view_raw_documents boolean,
  p_unmasked_bank_details boolean,
  p_release_reason text,
  p_nda_reference text,
  p_expiry_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_org uuid;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'p5b3.forbidden: only platform_admin may release funder access';
  END IF;
  IF p_expiry_at IS NULL THEN
    RAISE EXCEPTION 'p5b3.validation: expiry_at required for access grant';
  END IF;
  IF p_expiry_at <= now() THEN
    RAISE EXCEPTION 'p5b3.validation: expiry_at must be in the future';
  END IF;
  IF coalesce(trim(p_release_reason),'') = '' THEN
    RAISE EXCEPTION 'p5b3.validation: release_reason required';
  END IF;
  IF coalesce(trim(p_evidence_pack_version),'') = '' OR p_evidence_pack_id IS NULL THEN
    RAISE EXCEPTION 'p5b3.validation: released evidence_pack_id + version required';
  END IF;
  IF coalesce(trim(p_transaction_reference),'') = '' THEN
    RAISE EXCEPTION 'p5b3.validation: transaction_reference required';
  END IF;
  SELECT funder_organisation_id INTO v_org
    FROM public.p5_batch3_funder_users WHERE id = p_user_id AND status = 'active';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'p5b3.not_found: active funder user required for grant';
  END IF;

  INSERT INTO public.p5_batch3_funder_access_grants(
    funder_organisation_id, funder_user_id, transaction_reference, deal_id,
    evidence_pack_id, evidence_pack_version, role, access_scope, permitted_data_categories,
    can_download, can_view_raw_documents, unmasked_bank_details,
    release_reason, nda_reference, released_by, expiry_at
  ) VALUES (
    v_org, p_user_id, p_transaction_reference, p_deal_id,
    p_evidence_pack_id, p_evidence_pack_version, p_role,
    coalesce(p_access_scope,'{}'::jsonb), coalesce(p_permitted_categories, ARRAY[]::text[]),
    coalesce(p_can_download,false), coalesce(p_can_view_raw_documents,false),
    coalesce(p_unmasked_bank_details,false),
    p_release_reason, p_nda_reference, auth.uid(), p_expiry_at
  ) RETURNING id INTO v_id;

  PERFORM public.p5b3_audit('access_grant.created', v_org, p_user_id, p_role, p_transaction_reference,
    'access_grant', v_id, NULL,
    jsonb_build_object('evidence_pack_id', p_evidence_pack_id,
                       'evidence_pack_version', p_evidence_pack_version,
                       'expiry_at', p_expiry_at,
                       'release_reason', p_release_reason),
    NULL, NULL);
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.p5b3_admin_release_pack_version_v1(
  p_grant_id uuid, p_evidence_pack_id uuid, p_evidence_pack_version text, p_release_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'p5b3.forbidden';
  END IF;
  IF coalesce(trim(p_release_reason),'') = '' THEN
    RAISE EXCEPTION 'p5b3.validation: release_reason required';
  END IF;
  IF coalesce(trim(p_evidence_pack_version),'') = '' OR p_evidence_pack_id IS NULL THEN
    RAISE EXCEPTION 'p5b3.validation: evidence_pack_id + version required';
  END IF;
  SELECT to_jsonb(g) INTO v FROM public.p5_batch3_funder_access_grants g WHERE g.id = p_grant_id;
  IF v IS NULL THEN RAISE EXCEPTION 'p5b3.not_found: grant'; END IF;
  UPDATE public.p5_batch3_funder_access_grants
     SET evidence_pack_id = p_evidence_pack_id,
         evidence_pack_version = p_evidence_pack_version,
         release_reason = p_release_reason,
         released_by = auth.uid(),
         released_at = now()
   WHERE id = p_grant_id;
  PERFORM public.p5b3_audit('access_grant.pack_released',
    (v->>'funder_organisation_id')::uuid, (v->>'funder_user_id')::uuid,
    (v->>'role')::public.p5_batch3_funder_role, v->>'transaction_reference',
    'access_grant', p_grant_id, v,
    jsonb_build_object('evidence_pack_id', p_evidence_pack_id, 'evidence_pack_version', p_evidence_pack_version),
    p_release_reason, NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.p5b3_admin_change_grant_expiry_v1(
  p_grant_id uuid, p_new_expiry timestamptz, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN RAISE EXCEPTION 'p5b3.forbidden'; END IF;
  IF p_new_expiry IS NULL OR p_new_expiry <= now() THEN
    RAISE EXCEPTION 'p5b3.validation: new expiry must be in the future';
  END IF;
  IF coalesce(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'p5b3.validation: reason required';
  END IF;
  SELECT to_jsonb(g) INTO v FROM public.p5_batch3_funder_access_grants g WHERE g.id = p_grant_id;
  IF v IS NULL THEN RAISE EXCEPTION 'p5b3.not_found: grant'; END IF;
  UPDATE public.p5_batch3_funder_access_grants SET expiry_at = p_new_expiry WHERE id = p_grant_id;
  PERFORM public.p5b3_audit('access_grant.expiry_changed',
    (v->>'funder_organisation_id')::uuid, (v->>'funder_user_id')::uuid,
    (v->>'role')::public.p5_batch3_funder_role, v->>'transaction_reference',
    'access_grant', p_grant_id, v,
    jsonb_build_object('expiry_at', p_new_expiry), p_reason, NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.p5b3_admin_revoke_grant_v1(
  p_grant_id uuid, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN RAISE EXCEPTION 'p5b3.forbidden'; END IF;
  IF coalesce(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'p5b3.validation: revocation reason required';
  END IF;
  SELECT to_jsonb(g) INTO v FROM public.p5_batch3_funder_access_grants g WHERE g.id = p_grant_id;
  IF v IS NULL THEN RAISE EXCEPTION 'p5b3.not_found: grant'; END IF;
  UPDATE public.p5_batch3_funder_access_grants
     SET status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
         revocation_reason = p_reason
   WHERE id = p_grant_id;
  PERFORM public.p5b3_audit('access_grant.revoked',
    (v->>'funder_organisation_id')::uuid, (v->>'funder_user_id')::uuid,
    (v->>'role')::public.p5_batch3_funder_role, v->>'transaction_reference',
    'access_grant', p_grant_id, v,
    jsonb_build_object('status','revoked'), p_reason, NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.p5b3_admin_reactivate_grant_v1(
  p_grant_id uuid, p_new_expiry timestamptz, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN RAISE EXCEPTION 'p5b3.forbidden'; END IF;
  IF p_new_expiry IS NULL OR p_new_expiry <= now() THEN
    RAISE EXCEPTION 'p5b3.validation: new expiry required';
  END IF;
  IF coalesce(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'p5b3.validation: reactivation reason required';
  END IF;
  SELECT to_jsonb(g) INTO v FROM public.p5_batch3_funder_access_grants g WHERE g.id = p_grant_id;
  IF v IS NULL THEN RAISE EXCEPTION 'p5b3.not_found: grant'; END IF;
  UPDATE public.p5_batch3_funder_access_grants
     SET status = 'active', revoked_at = NULL, revoked_by = NULL, revocation_reason = NULL,
         expiry_at = p_new_expiry
   WHERE id = p_grant_id;
  PERFORM public.p5b3_audit('access_grant.reactivated',
    (v->>'funder_organisation_id')::uuid, (v->>'funder_user_id')::uuid,
    (v->>'role')::public.p5_batch3_funder_role, v->>'transaction_reference',
    'access_grant', p_grant_id, v,
    jsonb_build_object('status','active','expiry_at', p_new_expiry), p_reason, NULL);
END; $$;

-- ============================================================
-- Funder + admin: requests
-- ============================================================
CREATE OR REPLACE FUNCTION public.p5b3_funder_submit_request_v1(
  p_grant_id uuid, p_category public.p5_batch3_request_category, p_original_message text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_g record; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'p5b3.forbidden: auth required'; END IF;
  IF coalesce(trim(p_original_message),'') = '' THEN
    RAISE EXCEPTION 'p5b3.validation: original_message required';
  END IF;
  SELECT g.* INTO v_g FROM public.p5_batch3_funder_access_grants g
   JOIN public.p5_batch3_funder_users u ON u.id = g.funder_user_id
   WHERE g.id = p_grant_id
     AND u.auth_user_id = v_uid
     AND g.status = 'active' AND g.revoked_at IS NULL AND g.expiry_at > now();
  IF v_g.id IS NULL THEN
    RAISE EXCEPTION 'p5b3.forbidden: no active grant for current funder user';
  END IF;
  INSERT INTO public.p5_batch3_funder_requests(
    funder_organisation_id, funder_user_id, access_grant_id, transaction_reference,
    category, original_message, status
  ) VALUES (
    v_g.funder_organisation_id, v_g.funder_user_id, v_g.id, v_g.transaction_reference,
    p_category, p_original_message, 'submitted'
  ) RETURNING id INTO v_id;
  PERFORM public.p5b3_audit('request.submitted',
    v_g.funder_organisation_id, v_g.funder_user_id, v_g.role, v_g.transaction_reference,
    'funder_request', v_id, NULL,
    jsonb_build_object('category', p_category, 'status', 'submitted'), NULL, NULL);
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.p5b3_admin_edit_request_external_text_v1(
  p_request_id uuid, p_admin_external_message text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prior jsonb; v_req record;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN RAISE EXCEPTION 'p5b3.forbidden'; END IF;
  SELECT * INTO v_req FROM public.p5_batch3_funder_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'p5b3.not_found: request'; END IF;
  v_prior := jsonb_build_object('admin_external_message', v_req.admin_external_message);
  UPDATE public.p5_batch3_funder_requests
     SET admin_external_message = p_admin_external_message
   WHERE id = p_request_id;
  -- explicit invariant: original_message is never changed
  PERFORM public.p5b3_audit('request.external_text_edited',
    v_req.funder_organisation_id, v_req.funder_user_id, NULL, v_req.transaction_reference,
    'funder_request', p_request_id, v_prior,
    jsonb_build_object('admin_external_message', p_admin_external_message,
                       'original_message_preserved', true), NULL, NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.p5b3_admin_decide_request_v1(
  p_request_id uuid, p_decision text, p_assignee uuid, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req record; v_new_status public.p5_batch3_request_status;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN RAISE EXCEPTION 'p5b3.forbidden'; END IF;
  IF p_decision NOT IN ('approve','reject','assign','close') THEN
    RAISE EXCEPTION 'p5b3.validation: decision must be approve|reject|assign|close';
  END IF;
  SELECT * INTO v_req FROM public.p5_batch3_funder_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'p5b3.not_found: request'; END IF;
  v_new_status := CASE p_decision
    WHEN 'approve' THEN 'approved_to_company'::public.p5_batch3_request_status
    WHEN 'reject'  THEN 'rejected'::public.p5_batch3_request_status
    WHEN 'assign'  THEN 'assigned'::public.p5_batch3_request_status
    WHEN 'close'   THEN 'closed'::public.p5_batch3_request_status
  END;
  UPDATE public.p5_batch3_funder_requests
     SET status = v_new_status,
         admin_decision = p_decision,
         admin_reason = p_reason,
         assigned_to = CASE WHEN p_decision = 'assign' THEN p_assignee ELSE assigned_to END,
         closed_at = CASE WHEN p_decision IN ('reject','close') THEN now() ELSE closed_at END
   WHERE id = p_request_id;
  PERFORM public.p5b3_audit('request.' || p_decision,
    v_req.funder_organisation_id, v_req.funder_user_id, NULL, v_req.transaction_reference,
    'funder_request', p_request_id,
    jsonb_build_object('status', v_req.status),
    jsonb_build_object('status', v_new_status, 'assignee', p_assignee), p_reason, NULL);
END; $$;

-- ============================================================
-- Funder + admin: outcomes
-- ============================================================
CREATE OR REPLACE FUNCTION public.p5b3_funder_submit_outcome_v1(
  p_grant_id uuid,
  p_outcome_type public.p5_batch3_outcome_type,
  p_conditions text,
  p_term_sheet_document_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_g record; v_id uuid; v_funder_status public.p5_batch3_funder_status;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'p5b3.forbidden: auth required'; END IF;
  SELECT g.* INTO v_g FROM public.p5_batch3_funder_access_grants g
   JOIN public.p5_batch3_funder_users u ON u.id = g.funder_user_id
   WHERE g.id = p_grant_id AND u.auth_user_id = v_uid
     AND g.status = 'active' AND g.revoked_at IS NULL AND g.expiry_at > now();
  IF v_g.id IS NULL THEN RAISE EXCEPTION 'p5b3.forbidden: no active grant'; END IF;

  INSERT INTO public.p5_batch3_funder_outcomes(
    funder_organisation_id, funder_user_id, access_grant_id, transaction_reference,
    outcome_type, conditions, term_sheet_document_id
  ) VALUES (
    v_g.funder_organisation_id, v_g.funder_user_id, v_g.id, v_g.transaction_reference,
    p_outcome_type, p_conditions, p_term_sheet_document_id
  ) RETURNING id INTO v_id;

  v_funder_status := CASE p_outcome_type
    WHEN 'interested' THEN 'interested'
    WHEN 'not_interested' THEN 'declined'
    WHEN 'declined' THEN 'declined'
    WHEN 'credit_review_pending' THEN 'credit_review_pending'
    WHEN 'conditional_support' THEN 'conditional_support'
    WHEN 'term_sheet_requested' THEN 'term_sheet_requested'
    WHEN 'term_sheet_provided' THEN 'term_sheet_provided'
    WHEN 'funding_approved_subject_to_admin' THEN 'funding_decision_submitted'
  END::public.p5_batch3_funder_status;

  UPDATE public.p5_batch3_funder_access_grants
     SET funder_status = v_funder_status
   WHERE id = v_g.id;

  PERFORM public.p5b3_audit('outcome.submitted',
    v_g.funder_organisation_id, v_g.funder_user_id, v_g.role, v_g.transaction_reference,
    'funder_outcome', v_id, NULL,
    jsonb_build_object('outcome_type', p_outcome_type,
                       'funder_status', v_funder_status,
                       'finality_created', false), NULL, NULL);
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.p5b3_admin_review_outcome_v1(
  p_outcome_id uuid, p_status text, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out record;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN RAISE EXCEPTION 'p5b3.forbidden'; END IF;
  IF p_status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'p5b3.validation: status must be approved|rejected';
  END IF;
  SELECT * INTO v_out FROM public.p5_batch3_funder_outcomes WHERE id = p_outcome_id;
  IF v_out.id IS NULL THEN RAISE EXCEPTION 'p5b3.not_found: outcome'; END IF;
  UPDATE public.p5_batch3_funder_outcomes
     SET admin_review_status = p_status,
         admin_reviewed_by = auth.uid(),
         admin_reviewed_at = now()
   WHERE id = p_outcome_id;
  PERFORM public.p5b3_audit('outcome.admin_reviewed',
    v_out.funder_organisation_id, v_out.funder_user_id, NULL, v_out.transaction_reference,
    'funder_outcome', p_outcome_id,
    jsonb_build_object('admin_review_status', v_out.admin_review_status),
    jsonb_build_object('admin_review_status', p_status,
                       'finality_created', false), p_reason, NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.p5b3_admin_exit_review_v1(
  p_grant_id uuid, p_exit_reason public.p5_batch3_exit_reason, p_note text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN RAISE EXCEPTION 'p5b3.forbidden'; END IF;
  SELECT to_jsonb(g) INTO v FROM public.p5_batch3_funder_access_grants g WHERE g.id = p_grant_id;
  IF v IS NULL THEN RAISE EXCEPTION 'p5b3.not_found: grant'; END IF;
  UPDATE public.p5_batch3_funder_access_grants
     SET funder_status = 'exited',
         status = CASE WHEN status = 'active' THEN 'revoked' ELSE status END,
         revoked_at = CASE WHEN status = 'active' THEN now() ELSE revoked_at END,
         revoked_by = CASE WHEN status = 'active' THEN auth.uid() ELSE revoked_by END,
         revocation_reason = coalesce(revocation_reason, p_exit_reason::text)
   WHERE id = p_grant_id;
  PERFORM public.p5b3_audit('exit_review.applied',
    (v->>'funder_organisation_id')::uuid, (v->>'funder_user_id')::uuid,
    (v->>'role')::public.p5_batch3_funder_role, v->>'transaction_reference',
    'access_grant', p_grant_id, v,
    jsonb_build_object('exit_reason', p_exit_reason, 'funder_status','exited'),
    p_exit_reason::text, p_note);
END; $$;

-- ============================================================
-- Funder: download recording
-- ============================================================
CREATE OR REPLACE FUNCTION public.p5b3_funder_record_download_v1(
  p_grant_id uuid,
  p_evidence_pack_id uuid,
  p_evidence_pack_version text,
  p_file_name text,
  p_file_type text,
  p_link_ttl_seconds int
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_g record; v_id uuid; v_ttl int; v_watermark text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'p5b3.forbidden: auth required'; END IF;
  v_ttl := coalesce(p_link_ttl_seconds, 7*24*60*60);
  IF v_ttl <= 0 OR v_ttl > 7*24*60*60 THEN
    RAISE EXCEPTION 'p5b3.validation: link_ttl_seconds must be 1..604800 (7 days max)';
  END IF;
  IF lower(coalesce(p_file_type,'pdf')) <> 'pdf' THEN
    RAISE EXCEPTION 'p5b3.validation: only released PDF packs may be downloaded';
  END IF;

  SELECT g.* INTO v_g FROM public.p5_batch3_funder_access_grants g
   JOIN public.p5_batch3_funder_users u ON u.id = g.funder_user_id
   WHERE g.id = p_grant_id AND u.auth_user_id = v_uid
     AND g.status = 'active' AND g.revoked_at IS NULL AND g.expiry_at > now()
     AND g.can_download = true;
  IF v_g.id IS NULL THEN RAISE EXCEPTION 'p5b3.forbidden: no active download grant'; END IF;
  IF v_g.evidence_pack_id IS DISTINCT FROM p_evidence_pack_id
     OR v_g.evidence_pack_version IS DISTINCT FROM p_evidence_pack_version THEN
    RAISE EXCEPTION 'p5b3.validation: pack version does not match released grant';
  END IF;

  v_watermark := format('IZENZO • %s • %s • grant=%s • ts=%s',
    v_g.funder_organisation_id, v_uid, v_g.id, to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"'));

  INSERT INTO public.p5_batch3_funder_downloads(
    funder_organisation_id, funder_user_id, access_grant_id, transaction_reference,
    evidence_pack_id, evidence_pack_version, file_name, file_type,
    watermark_text, download_url_expires_at
  ) VALUES (
    v_g.funder_organisation_id, v_g.funder_user_id, v_g.id, v_g.transaction_reference,
    p_evidence_pack_id, p_evidence_pack_version, p_file_name, 'pdf',
    v_watermark, now() + make_interval(secs => v_ttl)
  ) RETURNING id INTO v_id;

  PERFORM public.p5b3_audit('download.recorded',
    v_g.funder_organisation_id, v_g.funder_user_id, v_g.role, v_g.transaction_reference,
    'funder_download', v_id, NULL,
    jsonb_build_object('evidence_pack_version', p_evidence_pack_version,
                       'file_type','pdf','watermarked', true,
                       'ttl_seconds', v_ttl), NULL, NULL);
  RETURN v_id;
END; $$;

-- ============================================================
-- EXECUTE grants (lockdown)
-- ============================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'p5b3_%_v1'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC', r.proname, r.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', r.proname, r.args);
  END LOOP;
END $$;
