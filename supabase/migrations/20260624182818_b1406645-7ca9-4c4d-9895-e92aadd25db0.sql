
-- P-5 Batch 2 — Stage 3 — Server-authoritative RPCs (no UI, no Batch 1 wiring)
-- All functions: SECURITY DEFINER, SET search_path = public
-- Privileged role-set used throughout
-- Audit: every material RPC writes a row in p5_batch2_evidence_review_events
-- or p5_batch2_sensitive_access_log.

-- ---------------------------------------------------------------------------
-- 0. helper — resolve the caller's primary privileged role (or NULL)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b2_actor_role(_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role::text FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY CASE role::text
    WHEN 'platform_admin' THEN 1
    WHEN 'executive_approver' THEN 2
    WHEN 'compliance_analyst' THEN 3
    WHEN 'governance_reviewer' THEN 4
    WHEN 'operator_case_manager' THEN 5
    WHEN 'auditor' THEN 6
    WHEN 'auditor_read_only' THEN 7
    WHEN 'developer_technical_admin' THEN 8
    ELSE 99
  END
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 1. p5b2_create_kyc_record
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b2_create_kyc_record(
  p_record_type public.p5b2_kyc_record_type,
  p_display_name text,
  p_organization_id uuid DEFAULT NULL,
  p_counterparty_id uuid DEFAULT NULL,
  p_match_id uuid DEFAULT NULL,
  p_trade_request_id uuid DEFAULT NULL,
  p_programme_id uuid DEFAULT NULL,
  p_api_client_id uuid DEFAULT NULL,
  p_owner_user_id uuid DEFAULT NULL,
  p_jurisdiction text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_is_high_risk boolean DEFAULT false,
  p_notes_internal text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := public.p5b2_actor_role(auth.uid());
  v_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'p5b2_create_kyc_record: authentication required';
  END IF;
  IF NOT public.p5b2_has_any_role(v_actor, ARRAY[
    'platform_admin','compliance_analyst','operator_case_manager','governance_reviewer'])
  THEN
    RAISE EXCEPTION 'p5b2_create_kyc_record: actor_not_authorised';
  END IF;
  IF p_display_name IS NULL OR length(btrim(p_display_name)) = 0 THEN
    RAISE EXCEPTION 'p5b2_create_kyc_record: display_name required';
  END IF;
  IF p_organization_id IS NULL AND p_counterparty_id IS NULL
     AND p_match_id IS NULL AND p_trade_request_id IS NULL
     AND p_programme_id IS NULL AND p_api_client_id IS NULL
     AND p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'p5b2_create_kyc_record: at least one subject linkage required';
  END IF;

  INSERT INTO public.p5_batch2_kyc_records(
    record_type, display_name, jurisdiction, entity_type,
    organization_id, counterparty_id, match_id, trade_request_id,
    programme_id, api_client_id, owner_user_id, is_high_risk,
    notes_internal, created_by, updated_by
  ) VALUES (
    p_record_type, btrim(p_display_name), p_jurisdiction, p_entity_type,
    p_organization_id, p_counterparty_id, p_match_id, p_trade_request_id,
    p_programme_id, p_api_client_id, p_owner_user_id, COALESCE(p_is_high_risk,false),
    p_notes_internal, v_actor, v_actor
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'record_id', v_id,
    'record_type', p_record_type,
    'organization_id', p_organization_id,
    'is_high_risk', COALESCE(p_is_high_risk,false),
    'created_by_role', v_role,
    'correlation_id', p_correlation_id
  );
END $$;

-- ---------------------------------------------------------------------------
-- 2. p5b2_link_records
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b2_link_records(
  p_parent_record_id uuid,
  p_child_record_id uuid,
  p_link_type text,
  p_effective_from date DEFAULT NULL,
  p_effective_to date DEFAULT NULL,
  p_ownership_pct numeric DEFAULT NULL,
  p_notes_internal text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := public.p5b2_actor_role(auth.uid());
  v_parent_org uuid; v_child_org uuid; v_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'p5b2_link_records: authentication required';
  END IF;
  IF NOT public.p5b2_has_any_role(v_actor, ARRAY[
    'platform_admin','compliance_analyst','operator_case_manager','governance_reviewer'])
  THEN
    RAISE EXCEPTION 'p5b2_link_records: actor_not_authorised';
  END IF;
  IF p_parent_record_id IS NULL OR p_child_record_id IS NULL OR p_link_type IS NULL THEN
    RAISE EXCEPTION 'p5b2_link_records: parent, child and link_type required';
  END IF;
  IF p_parent_record_id = p_child_record_id THEN
    RAISE EXCEPTION 'p5b2_link_records: cannot link record to itself';
  END IF;

  SELECT organization_id INTO v_parent_org FROM public.p5_batch2_kyc_records WHERE id = p_parent_record_id;
  SELECT organization_id INTO v_child_org  FROM public.p5_batch2_kyc_records WHERE id = p_child_record_id;
  IF v_parent_org IS NOT NULL AND v_child_org IS NOT NULL AND v_parent_org <> v_child_org
     AND NOT public.p5b2_has_any_role(v_actor, ARRAY['platform_admin']) THEN
    RAISE EXCEPTION 'p5b2_link_records: cross_org_link_blocked';
  END IF;

  INSERT INTO public.p5_batch2_record_links(
    parent_record_id, child_record_id, link_type,
    effective_from, effective_to, ownership_pct, notes_internal, created_by
  ) VALUES (
    p_parent_record_id, p_child_record_id, p_link_type,
    p_effective_from, p_effective_to, p_ownership_pct, p_notes_internal, v_actor
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'link_id', v_id,
    'link_type', p_link_type,
    'parent_org', v_parent_org,
    'child_org', v_child_org,
    'created_by_role', v_role,
    'correlation_id', p_correlation_id
  );
END $$;

-- ---------------------------------------------------------------------------
-- 3. p5b2_generate_checklist  (read-only — returns segmented buckets)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b2_generate_checklist(p_record_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_now timestamptz := now();
  result jsonb := jsonb_build_object(
    'missing_mandatory', '[]'::jsonb,
    'missing_mandatory_before_finality', '[]'::jsonb,
    'missing_conditional', '[]'::jsonb,
    'optional_recommendations', '[]'::jsonb,
    'uploaded_unreviewed', '[]'::jsonb,
    'rejected', '[]'::jsonb,
    'expired', '[]'::jsonb,
    'provider_dependent', '[]'::jsonb
  );
  v_can_read boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'p5b2_generate_checklist: authentication required';
  END IF;
  -- RLS already enforces read scope when this RPC is called as a non-admin;
  -- we still gate explicitly to keep the error message stable.
  SELECT EXISTS (
    SELECT 1 FROM public.p5_batch2_kyc_records r
    WHERE r.id = p_record_id AND (
      public.p5b2_has_any_role(v_actor, ARRAY[
        'platform_admin','executive_approver','compliance_analyst','governance_reviewer',
        'operator_case_manager','auditor','auditor_read_only','developer_technical_admin'])
      OR (r.organization_id IS NOT NULL AND r.organization_id IN (
        SELECT p.org_id FROM public.profiles p WHERE p.id = v_actor))
      OR (r.owner_user_id IS NOT NULL AND r.owner_user_id = v_actor))
  ) INTO v_can_read;
  IF NOT v_can_read THEN
    RAISE EXCEPTION 'p5b2_generate_checklist: record_not_visible';
  END IF;

  WITH items AS (
    SELECT i.*, COALESCE(i.expiry_date < CURRENT_DATE, false) AS is_expired
    FROM public.p5_batch2_evidence_items i WHERE i.record_id = p_record_id
  ),
  segmented AS (
    SELECT
      jsonb_agg(jsonb_build_object('id',id,'category',category,'requirement_level',requirement_level))
        FILTER (WHERE status = 'missing' AND requirement_level = 'mandatory' AND is_waived = false) AS missing_mandatory,
      jsonb_agg(jsonb_build_object('id',id,'category',category))
        FILTER (WHERE status IN ('missing','requested') AND 'finality' = ANY(supports) AND is_waived = false) AS missing_before_finality,
      jsonb_agg(jsonb_build_object('id',id,'category',category))
        FILTER (WHERE status = 'missing' AND requirement_level = 'conditional' AND is_waived = false) AS missing_conditional,
      jsonb_agg(jsonb_build_object('id',id,'category',category))
        FILTER (WHERE status = 'missing' AND requirement_level = 'optional') AS optional_recommendations,
      jsonb_agg(jsonb_build_object('id',id,'category',category))
        FILTER (WHERE status IN ('uploaded','under_review')) AS uploaded_unreviewed,
      jsonb_agg(jsonb_build_object('id',id,'category',category,'reason',current_rejection_reason))
        FILTER (WHERE status = 'rejected') AS rejected,
      jsonb_agg(jsonb_build_object('id',id,'category',category,'expiry_date',expiry_date))
        FILTER (WHERE is_expired OR status = 'expired') AS expired,
      jsonb_agg(jsonb_build_object('id',id,'category',category,'provider_status',provider_status))
        FILTER (WHERE provider_dependency = true AND provider_live = false) AS provider_dependent
    FROM items
  )
  SELECT jsonb_build_object(
    'missing_mandatory', COALESCE(missing_mandatory,'[]'::jsonb),
    'missing_mandatory_before_finality', COALESCE(missing_before_finality,'[]'::jsonb),
    'missing_conditional', COALESCE(missing_conditional,'[]'::jsonb),
    'optional_recommendations', COALESCE(optional_recommendations,'[]'::jsonb),
    'uploaded_unreviewed', COALESCE(uploaded_unreviewed,'[]'::jsonb),
    'rejected', COALESCE(rejected,'[]'::jsonb),
    'expired', COALESCE(expired,'[]'::jsonb),
    'provider_dependent', COALESCE(provider_dependent,'[]'::jsonb)
  ) INTO result FROM segmented;

  RETURN result;
END $$;

-- ---------------------------------------------------------------------------
-- 4. p5b2_upload_evidence_version
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b2_upload_evidence_version(
  p_evidence_item_id uuid,
  p_file_storage_path text,
  p_file_hash text,
  p_file_size_bytes bigint DEFAULT NULL,
  p_mime_type text DEFAULT NULL,
  p_replacement_reason public.p5b2_replacement_reason DEFAULT NULL,
  p_replacement_note text DEFAULT NULL,
  p_audit_reference text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := public.p5b2_actor_role(auth.uid());
  v_prev_version uuid;
  v_prev_status public.p5b2_evidence_status;
  v_next_no integer;
  v_new_id uuid;
  v_has_existing boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'p5b2_upload_evidence_version: authentication required';
  END IF;
  IF p_evidence_item_id IS NULL OR p_file_hash IS NULL THEN
    RAISE EXCEPTION 'p5b2_upload_evidence_version: evidence_item_id and file_hash required';
  END IF;

  SELECT current_version_id, status INTO v_prev_version, v_prev_status
  FROM public.p5_batch2_evidence_items WHERE id = p_evidence_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'p5b2_upload_evidence_version: evidence item not found';
  END IF;

  v_has_existing := v_prev_version IS NOT NULL;
  IF v_has_existing AND p_replacement_reason IS NULL THEN
    RAISE EXCEPTION 'p5b2_upload_evidence_version: replacement_reason required when replacing existing evidence';
  END IF;

  SELECT COALESCE(MAX(version_number),0)+1 INTO v_next_no
  FROM public.p5_batch2_evidence_versions WHERE evidence_item_id = p_evidence_item_id;

  -- archive previous current (only mutable cols permitted by versions_guard)
  IF v_prev_version IS NOT NULL THEN
    UPDATE public.p5_batch2_evidence_versions
       SET is_current = false, archived_at = now()
     WHERE id = v_prev_version;
  END IF;

  INSERT INTO public.p5_batch2_evidence_versions(
    evidence_item_id, version_number, file_storage_path, file_hash,
    file_size_bytes, mime_type, uploaded_by, uploader_role,
    replacement_reason, replacement_note, is_current, audit_reference
  ) VALUES (
    p_evidence_item_id, v_next_no, p_file_storage_path, p_file_hash,
    p_file_size_bytes, p_mime_type, v_actor, v_role,
    p_replacement_reason, p_replacement_note, true, p_audit_reference
  ) RETURNING id INTO v_new_id;

  UPDATE public.p5_batch2_evidence_items
     SET current_version_id = v_new_id,
         status = 'uploaded',
         updated_by = v_actor
   WHERE id = p_evidence_item_id;

  INSERT INTO public.p5_batch2_evidence_review_events(
    evidence_item_id, version_id, action, previous_status, new_status,
    actor_user_id, actor_role, actor_type, metadata
  ) VALUES (
    p_evidence_item_id, v_new_id,
    CASE WHEN v_has_existing THEN 'replace' ELSE 'upload' END,
    v_prev_status, 'uploaded',
    v_actor, v_role, 'user',
    jsonb_build_object('replacement_reason', p_replacement_reason,
                       'version_number', v_next_no,
                       'audit_reference', p_audit_reference)
  );

  RETURN jsonb_build_object(
    'version_id', v_new_id,
    'version_number', v_next_no,
    'evidence_item_id', p_evidence_item_id,
    'replaced_previous', v_has_existing
  );
END $$;

-- ---------------------------------------------------------------------------
-- 5. p5b2_review_evidence  (accept / accept_with_warning / reject / request_correction)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b2_review_evidence(
  p_evidence_item_id uuid,
  p_action text,
  p_rejection_reason public.p5b2_rejection_reason DEFAULT NULL,
  p_reviewer_note_internal text DEFAULT NULL,
  p_customer_safe_note text DEFAULT NULL,
  p_new_rating public.p5b2_evidence_rating DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := public.p5b2_actor_role(auth.uid());
  v_prev_status public.p5b2_evidence_status;
  v_new_status public.p5b2_evidence_status;
  v_current_version uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'p5b2_review_evidence: authentication required';
  END IF;
  IF NOT public.p5b2_has_any_role(v_actor, ARRAY[
    'platform_admin','compliance_analyst','operator_case_manager','governance_reviewer','executive_approver'])
  THEN
    RAISE EXCEPTION 'p5b2_review_evidence: actor_not_authorised';
  END IF;
  IF p_action NOT IN ('accept','accept_with_warning','reject','request_correction') THEN
    RAISE EXCEPTION 'p5b2_review_evidence: illegal_action %', p_action;
  END IF;
  IF p_action IN ('reject','request_correction') AND p_rejection_reason IS NULL THEN
    RAISE EXCEPTION 'p5b2_review_evidence: reason_code required for % action', p_action;
  END IF;
  IF p_action IN ('accept','accept_with_warning') AND
     NOT public.p5b2_has_any_role(v_actor, ARRAY['platform_admin','compliance_analyst','executive_approver'])
  THEN
    RAISE EXCEPTION 'p5b2_review_evidence: only compliance_owner/platform_admin may accept';
  END IF;

  SELECT status, current_version_id INTO v_prev_status, v_current_version
  FROM public.p5_batch2_evidence_items WHERE id = p_evidence_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'p5b2_review_evidence: evidence_item_not_found';
  END IF;

  v_new_status := CASE p_action
    WHEN 'accept' THEN 'accepted'::public.p5b2_evidence_status
    WHEN 'accept_with_warning' THEN 'accepted_with_warning'::public.p5b2_evidence_status
    WHEN 'reject' THEN 'rejected'::public.p5b2_evidence_status
    WHEN 'request_correction' THEN 'rejected'::public.p5b2_evidence_status
  END;

  -- illegal transitions
  IF v_prev_status IN ('replaced','revoked') THEN
    RAISE EXCEPTION 'p5b2_review_evidence: illegal_status_transition from %', v_prev_status;
  END IF;
  IF p_action IN ('accept','accept_with_warning') AND v_prev_status NOT IN
       ('uploaded','under_review','provider_dependent','accepted_with_warning') THEN
    RAISE EXCEPTION 'p5b2_review_evidence: illegal_status_transition from % for %', v_prev_status, p_action;
  END IF;

  UPDATE public.p5_batch2_evidence_items
     SET status = v_new_status,
         rating = COALESCE(p_new_rating, rating),
         current_rejection_reason = CASE WHEN p_action IN ('reject','request_correction') THEN p_rejection_reason ELSE NULL END,
         customer_safe_note = COALESCE(p_customer_safe_note, customer_safe_note),
         reviewer_note_internal = COALESCE(p_reviewer_note_internal, reviewer_note_internal),
         reviewed_by = v_actor,
         reviewed_at = now(),
         updated_by = v_actor
   WHERE id = p_evidence_item_id;

  INSERT INTO public.p5_batch2_evidence_review_events(
    evidence_item_id, version_id, action, previous_status, new_status,
    rejection_reason, reviewer_note_internal, customer_safe_note,
    actor_user_id, actor_role, actor_type, metadata
  ) VALUES (
    p_evidence_item_id, v_current_version, p_action, v_prev_status, v_new_status,
    p_rejection_reason, p_reviewer_note_internal, p_customer_safe_note,
    v_actor, v_role, 'user',
    jsonb_build_object('new_rating', p_new_rating)
  );

  RETURN jsonb_build_object(
    'evidence_item_id', p_evidence_item_id,
    'previous_status', v_prev_status,
    'new_status', v_new_status,
    'action', p_action,
    'rejection_reason', p_rejection_reason
  );
END $$;

-- ---------------------------------------------------------------------------
-- 6. p5b2_set_provider_state
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b2_set_provider_state(
  p_evidence_item_id uuid,
  p_provider_status public.p5b2_provider_status,
  p_provider_name text DEFAULT NULL,
  p_provider_live boolean DEFAULT false,
  p_provider_result_reference text DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := public.p5b2_actor_role(auth.uid());
  v_prev_status public.p5b2_evidence_status;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'p5b2_set_provider_state: authentication required';
  END IF;
  IF NOT public.p5b2_has_any_role(v_actor, ARRAY['platform_admin','compliance_analyst','developer_technical_admin']) THEN
    RAISE EXCEPTION 'p5b2_set_provider_state: actor_not_authorised';
  END IF;
  IF p_provider_live = true AND (p_provider_result_reference IS NULL OR length(btrim(p_provider_result_reference))=0) THEN
    RAISE EXCEPTION 'p5b2_set_provider_state: provider_live=true requires provider_result_reference';
  END IF;

  SELECT status INTO v_prev_status FROM public.p5_batch2_evidence_items WHERE id = p_evidence_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'p5b2_set_provider_state: evidence_item_not_found';
  END IF;

  UPDATE public.p5_batch2_evidence_items
     SET provider_status = p_provider_status,
         provider_name = COALESCE(p_provider_name, provider_name),
         provider_live = COALESCE(p_provider_live,false),
         provider_result_reference = p_provider_result_reference,
         provider_dependency = true,
         last_provider_attempt_at = now(),
         status = CASE WHEN status IN ('missing','requested') THEN 'provider_dependent'::public.p5b2_evidence_status ELSE status END,
         updated_by = v_actor
   WHERE id = p_evidence_item_id;

  INSERT INTO public.p5_batch2_evidence_review_events(
    evidence_item_id, action, previous_status, new_status,
    actor_user_id, actor_role, actor_type, metadata
  ) VALUES (
    p_evidence_item_id, 'mark_provider_dependent', v_prev_status, NULL,
    v_actor, v_role, CASE WHEN v_role IS NULL THEN 'system' ELSE 'user' END,
    jsonb_build_object('provider_status', p_provider_status,
                       'provider_live', COALESCE(p_provider_live,false),
                       'provider_result_reference', p_provider_result_reference,
                       'reason', p_reason)
  );

  RETURN jsonb_build_object(
    'evidence_item_id', p_evidence_item_id,
    'provider_status', p_provider_status,
    'provider_live', COALESCE(p_provider_live,false)
  );
END $$;

-- ---------------------------------------------------------------------------
-- 7. p5b2_waive_evidence
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b2_waive_evidence(
  p_evidence_item_id uuid,
  p_scope text,
  p_reason text,
  p_expires_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := public.p5b2_actor_role(auth.uid());
  v_id uuid;
  v_prev_status public.p5b2_evidence_status;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'p5b2_waive_evidence: authentication required';
  END IF;
  IF NOT public.p5b2_has_any_role(v_actor, ARRAY['platform_admin','compliance_analyst','executive_approver']) THEN
    RAISE EXCEPTION 'p5b2_waive_evidence: actor_not_authorised';
  END IF;
  IF p_scope IS NULL OR length(btrim(p_scope))=0 THEN
    RAISE EXCEPTION 'p5b2_waive_evidence: scope required';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason))=0 THEN
    RAISE EXCEPTION 'p5b2_waive_evidence: reason required';
  END IF;

  SELECT status INTO v_prev_status FROM public.p5_batch2_evidence_items WHERE id = p_evidence_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'p5b2_waive_evidence: evidence_item_not_found';
  END IF;

  INSERT INTO public.p5_batch2_evidence_waivers(
    evidence_item_id, scope, reason_text, expires_at, approved_by, metadata
  ) VALUES (p_evidence_item_id, p_scope, p_reason, p_expires_at, v_actor,
            jsonb_build_object('approver_role', v_role))
  RETURNING id INTO v_id;

  UPDATE public.p5_batch2_evidence_items
     SET status = 'waived', is_waived = true, updated_by = v_actor
   WHERE id = p_evidence_item_id;

  INSERT INTO public.p5_batch2_evidence_review_events(
    evidence_item_id, action, previous_status, new_status,
    actor_user_id, actor_role, actor_type, metadata
  ) VALUES (
    p_evidence_item_id, 'waive', v_prev_status, 'waived',
    v_actor, v_role, 'user',
    jsonb_build_object('waiver_id', v_id, 'scope', p_scope,
                       'expires_at', p_expires_at, 'reason', p_reason)
  );

  RETURN jsonb_build_object('waiver_id', v_id, 'evidence_item_id', p_evidence_item_id, 'scope', p_scope);
END $$;

-- ---------------------------------------------------------------------------
-- 8. p5b2_withdraw_evidence  (supersede without deletion)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b2_withdraw_evidence(
  p_evidence_item_id uuid,
  p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := public.p5b2_actor_role(auth.uid());
  v_prev_status public.p5b2_evidence_status;
  v_current_version uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'p5b2_withdraw_evidence: authentication required';
  END IF;
  IF NOT public.p5b2_has_any_role(v_actor, ARRAY['platform_admin','compliance_analyst']) THEN
    RAISE EXCEPTION 'p5b2_withdraw_evidence: actor_not_authorised';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason))=0 THEN
    RAISE EXCEPTION 'p5b2_withdraw_evidence: reason required';
  END IF;

  SELECT status, current_version_id INTO v_prev_status, v_current_version
  FROM public.p5_batch2_evidence_items WHERE id = p_evidence_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'p5b2_withdraw_evidence: evidence_item_not_found';
  END IF;
  IF v_prev_status IN ('replaced','revoked') THEN
    RAISE EXCEPTION 'p5b2_withdraw_evidence: terminal_status %', v_prev_status;
  END IF;

  UPDATE public.p5_batch2_evidence_items
     SET status = 'revoked', updated_by = v_actor
   WHERE id = p_evidence_item_id;

  IF v_current_version IS NOT NULL THEN
    UPDATE public.p5_batch2_evidence_versions
       SET is_current = false, archived_at = COALESCE(archived_at, now())
     WHERE id = v_current_version;
  END IF;

  INSERT INTO public.p5_batch2_evidence_review_events(
    evidence_item_id, version_id, action, previous_status, new_status,
    actor_user_id, actor_role, actor_type, metadata
  ) VALUES (
    p_evidence_item_id, v_current_version, 'revoke', v_prev_status, 'revoked',
    v_actor, v_role, 'user', jsonb_build_object('reason', p_reason)
  );

  RETURN jsonb_build_object('evidence_item_id', p_evidence_item_id, 'new_status', 'revoked');
END $$;

-- ---------------------------------------------------------------------------
-- 9. p5b2_suspend_release
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b2_suspend_release(
  p_evidence_item_id uuid,
  p_action text,           -- 'suspend' | 'release'
  p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := public.p5b2_actor_role(auth.uid());
  v_prev_status public.p5b2_evidence_status;
  v_new_status public.p5b2_evidence_status;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'p5b2_suspend_release: authentication required';
  END IF;
  IF NOT public.p5b2_has_any_role(v_actor, ARRAY['platform_admin','compliance_analyst']) THEN
    RAISE EXCEPTION 'p5b2_suspend_release: actor_not_authorised';
  END IF;
  IF p_action NOT IN ('suspend','release') THEN
    RAISE EXCEPTION 'p5b2_suspend_release: illegal_action %', p_action;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason))=0 THEN
    RAISE EXCEPTION 'p5b2_suspend_release: reason required';
  END IF;

  SELECT status INTO v_prev_status FROM public.p5_batch2_evidence_items WHERE id = p_evidence_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'p5b2_suspend_release: evidence_item_not_found';
  END IF;

  IF p_action = 'suspend' THEN
    IF v_prev_status IN ('replaced','revoked') THEN
      RAISE EXCEPTION 'p5b2_suspend_release: illegal_status_transition from %', v_prev_status;
    END IF;
    v_new_status := 'suspended_hold';
  ELSE
    IF v_prev_status <> 'suspended_hold' THEN
      RAISE EXCEPTION 'p5b2_suspend_release: cannot release item not in suspended_hold';
    END IF;
    v_new_status := 'under_review';
  END IF;

  UPDATE public.p5_batch2_evidence_items
     SET status = v_new_status,
         is_suspended = (v_new_status = 'suspended_hold'),
         updated_by = v_actor
   WHERE id = p_evidence_item_id;

  INSERT INTO public.p5_batch2_evidence_review_events(
    evidence_item_id, action, previous_status, new_status,
    actor_user_id, actor_role, actor_type, metadata
  ) VALUES (
    p_evidence_item_id,
    CASE p_action WHEN 'suspend' THEN 'suspend_hold' ELSE 'resume' END,
    v_prev_status, v_new_status, v_actor, v_role, 'user',
    jsonb_build_object('reason', p_reason)
  );

  RETURN jsonb_build_object('evidence_item_id', p_evidence_item_id,
                            'previous_status', v_prev_status,
                            'new_status', v_new_status);
END $$;

-- ---------------------------------------------------------------------------
-- 10. p5b2_snapshot_finality_pack
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b2_snapshot_finality_pack(
  p_record_id uuid,
  p_pack_reason text,
  p_organization_id uuid DEFAULT NULL,
  p_match_id uuid DEFAULT NULL,
  p_trade_request_id uuid DEFAULT NULL,
  p_counterparty_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := public.p5b2_actor_role(auth.uid());
  v_pack_id uuid;
  v_item RECORD;
  v_count integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'p5b2_snapshot_finality_pack: authentication required';
  END IF;
  IF NOT public.p5b2_has_any_role(v_actor, ARRAY['platform_admin','compliance_analyst','executive_approver','governance_reviewer']) THEN
    RAISE EXCEPTION 'p5b2_snapshot_finality_pack: actor_not_authorised';
  END IF;
  IF p_pack_reason IS NULL OR length(btrim(p_pack_reason))=0 THEN
    RAISE EXCEPTION 'p5b2_snapshot_finality_pack: pack_reason required';
  END IF;

  INSERT INTO public.p5_batch2_evidence_packs(
    organization_id, counterparty_id, match_id, trade_request_id,
    pack_reason, pack_status, sealed_by, metadata
  ) VALUES (
    p_organization_id, p_counterparty_id, p_match_id, p_trade_request_id,
    p_pack_reason, 'sealed', v_actor,
    jsonb_build_object('record_id', p_record_id, 'sealed_by_role', v_role)
  ) RETURNING id INTO v_pack_id;

  FOR v_item IN
    SELECT i.id, i.status, i.rating, i.current_version_id, v.file_hash
    FROM public.p5_batch2_evidence_items i
    LEFT JOIN public.p5_batch2_evidence_versions v ON v.id = i.current_version_id
    WHERE i.record_id = p_record_id AND i.current_version_id IS NOT NULL
  LOOP
    INSERT INTO public.p5_batch2_evidence_pack_items(
      pack_id, evidence_item_id, version_id,
      snapshot_status, snapshot_rating, snapshot_file_hash
    ) VALUES (
      v_pack_id, v_item.id, v_item.current_version_id,
      v_item.status, v_item.rating, COALESCE(v_item.file_hash, 'no-hash')
    );
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.p5_batch2_evidence_review_events(
    evidence_item_id, action, actor_user_id, actor_role, actor_type, metadata
  )
  SELECT v_item.id, 'finality_pack_snapshot', v_actor, v_role, 'user',
         jsonb_build_object('pack_id', v_pack_id, 'pack_reason', p_pack_reason)
  FROM public.p5_batch2_evidence_items v_item
  WHERE v_item.record_id = p_record_id AND v_item.current_version_id IS NOT NULL
  LIMIT 1;  -- one audit row per snapshot (the pack itself); per-item linkage is in pack_items

  RETURN jsonb_build_object('pack_id', v_pack_id, 'item_count', v_count, 'pack_status', 'sealed');
END $$;

-- ---------------------------------------------------------------------------
-- 11. p5b2_log_sensitive_access
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b2_log_sensitive_access(
  p_access_kind text,
  p_reason text,
  p_evidence_item_id uuid DEFAULT NULL,
  p_version_id uuid DEFAULT NULL,
  p_record_id uuid DEFAULT NULL,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := public.p5b2_actor_role(auth.uid());
  v_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'p5b2_log_sensitive_access: authentication required';
  END IF;
  IF p_access_kind IS NULL OR length(btrim(p_access_kind))=0 THEN
    RAISE EXCEPTION 'p5b2_log_sensitive_access: access_kind required';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason))=0 THEN
    RAISE EXCEPTION 'p5b2_log_sensitive_access: reason required';
  END IF;

  INSERT INTO public.p5_batch2_sensitive_access_log(
    evidence_item_id, version_id, record_id, access_kind,
    actor_user_id, actor_role, reason_text, ip_address, user_agent
  ) VALUES (
    p_evidence_item_id, p_version_id, p_record_id, p_access_kind,
    v_actor, v_role, p_reason, p_ip_address, p_user_agent
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('log_id', v_id, 'access_kind', p_access_kind);
END $$;

-- ---------------------------------------------------------------------------
-- EXECUTE permissions
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.p5b2_actor_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p5b2_create_kyc_record(public.p5b2_kyc_record_type, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, boolean, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p5b2_link_records(uuid, uuid, text, date, date, numeric, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p5b2_generate_checklist(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p5b2_upload_evidence_version(uuid, text, text, bigint, text, public.p5b2_replacement_reason, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p5b2_review_evidence(uuid, text, public.p5b2_rejection_reason, text, text, public.p5b2_evidence_rating) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p5b2_set_provider_state(uuid, public.p5b2_provider_status, text, boolean, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p5b2_waive_evidence(uuid, text, text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p5b2_withdraw_evidence(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p5b2_suspend_release(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p5b2_snapshot_finality_pack(uuid, text, uuid, uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p5b2_log_sensitive_access(text, text, uuid, uuid, uuid, inet, text) TO authenticated, service_role;
