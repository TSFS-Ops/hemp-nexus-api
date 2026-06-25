
-- ============================================================
-- P-5 Batch 4 Stage 3 — RPC wrappers + audit helper
-- All functions: SECURITY DEFINER, SET search_path = public.
-- Every material mutation writes an immutable audit row.
-- ============================================================

-- ---------- Audit helper (private; not exposed to PostgREST) ----------
CREATE OR REPLACE FUNCTION public.p5b4_write_audit(
  p_case_id        uuid,
  p_event_type     text,
  p_actor_role     public.p5_batch4_role_key,
  p_before         jsonb,
  p_after          jsonb,
  p_reason         text,
  p_external_safe  text,
  p_internal       text,
  p_linked_evidence  uuid DEFAULT NULL,
  p_linked_milestone uuid DEFAULT NULL,
  p_linked_blocker   uuid DEFAULT NULL,
  p_linked_release   uuid DEFAULT NULL,
  p_linked_finality  uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.p5_batch4_audit_events(
    case_id, event_type, actor_user_id, actor_role, source_channel,
    before_state, after_state, reason, external_safe_summary, internal_detail,
    linked_evidence_id, linked_milestone_id, linked_blocker_id,
    linked_funder_release_id, linked_finality_id
  ) VALUES (
    p_case_id, p_event_type, auth.uid(), p_actor_role, 'ui',
    p_before, p_after, p_reason, p_external_safe, p_internal,
    p_linked_evidence, p_linked_milestone, p_linked_blocker,
    p_linked_release, p_linked_finality
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.p5b4_write_audit(uuid,text,public.p5_batch4_role_key,jsonb,jsonb,text,text,text,uuid,uuid,uuid,uuid,uuid) FROM public, anon, authenticated;

-- ---------- Common reason guard ----------
CREATE OR REPLACE FUNCTION public.p5b4_require_reason(p_reason text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 4 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- ---------- Admin guard ----------
CREATE OR REPLACE FUNCTION public.p5b4_require_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.p5b4_is_platform_admin() THEN
    RAISE EXCEPTION 'platform_admin_required' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ============================================================
-- 1. Case lifecycle
-- ============================================================
CREATE OR REPLACE FUNCTION public.p5b4_open_case_v1(
  p_case_reference text,
  p_process_type   public.p5_batch4_process_type,
  p_owner_user_id  uuid,
  p_linked_company_id uuid DEFAULT NULL,
  p_linked_transaction_id uuid DEFAULT NULL,
  p_linked_project_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.p5b4_require_admin();
  INSERT INTO public.p5_batch4_execution_cases(
    case_reference, process_type, owner_user_id,
    linked_company_id, linked_transaction_id, linked_project_id,
    execution_status, readiness_status, current_milestone, created_by
  ) VALUES (
    p_case_reference, p_process_type, p_owner_user_id,
    p_linked_company_id, p_linked_transaction_id, p_linked_project_id,
    'opened', 'not_ready', 'case_opened', auth.uid()
  )
  RETURNING id INTO v_id;
  PERFORM public.p5b4_write_audit(v_id, 'case_opened', 'platform_admin',
    NULL, jsonb_build_object('case_reference', p_case_reference, 'process_type', p_process_type),
    NULL, 'Case opened.', NULL);
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.p5b4_confirm_scope_v1(p_case_id uuid, p_scope_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.p5b4_require_admin();
  UPDATE public.p5_batch4_execution_cases
    SET current_milestone = 'scope_confirmed',
        execution_status  = 'in_progress'
    WHERE id = p_case_id;
  PERFORM public.p5b4_write_audit(p_case_id, 'scope_confirmed', 'platform_admin',
    NULL, jsonb_build_object('scope_note', p_scope_note), NULL,
    'Scope confirmed.', p_scope_note);
END; $$;

CREATE OR REPLACE FUNCTION public.p5b4_close_case_v1(p_case_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.p5b4_require_admin();
  PERFORM public.p5b4_require_reason(p_reason);
  UPDATE public.p5_batch4_execution_cases
    SET execution_status = 'closed', closed_at = now()
    WHERE id = p_case_id;
  PERFORM public.p5b4_write_audit(p_case_id, 'case_closed', 'platform_admin',
    NULL, jsonb_build_object('closed_at', now()), p_reason, 'Case closed.', NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.p5b4_reopen_case_v1(p_case_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.p5b4_require_admin();
  PERFORM public.p5b4_require_reason(p_reason);
  UPDATE public.p5_batch4_execution_cases
    SET execution_status = 'in_progress',
        reopened_at = now(),
        reopen_reason = p_reason,
        closed_at = NULL
    WHERE id = p_case_id AND finality_status IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_not_reopenable' USING ERRCODE = '42501';
  END IF;
  PERFORM public.p5b4_write_audit(p_case_id, 'case_reopened', 'platform_admin',
    NULL, jsonb_build_object('reopened_at', now()), p_reason, 'Case reopened.', NULL);
END; $$;

-- ============================================================
-- 2. Evidence
-- ============================================================
CREATE OR REPLACE FUNCTION public.p5b4_generate_checklist_v1(p_case_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.p5b4_require_admin();
  UPDATE public.p5_batch4_execution_cases
    SET current_milestone = 'evidence_checklist_generated'
    WHERE id = p_case_id;
  PERFORM public.p5b4_write_audit(p_case_id, 'evidence_checklist_generated',
    'platform_admin', NULL, NULL, NULL, 'Evidence checklist generated.', NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.p5b4_request_evidence_v1(
  p_case_id uuid, p_evidence_type text, p_evidence_label text,
  p_requirement_type public.p5_batch4_mandatory_type
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.p5b4_require_admin();
  INSERT INTO public.p5_batch4_evidence_items(
    case_id, evidence_type, evidence_label, requirement_type, status
  ) VALUES (p_case_id, p_evidence_type, p_evidence_label, p_requirement_type, 'requested')
  RETURNING id INTO v_id;
  PERFORM public.p5b4_write_audit(p_case_id, 'evidence_requested', 'platform_admin',
    NULL, jsonb_build_object('evidence_type', p_evidence_type), NULL,
    'Evidence requested: ' || p_evidence_label, NULL,
    v_id, NULL, NULL, NULL, NULL);
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.p5b4_submit_evidence_v1(
  p_evidence_id uuid, p_file_reference text, p_file_hash text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.p5_batch4_evidence_items
    SET status = 'uploaded',
        file_reference = p_file_reference,
        file_hash = p_file_hash,
        uploaded_by = auth.uid()
    WHERE id = p_evidence_id
    RETURNING case_id INTO v_case;
  IF v_case IS NULL THEN
    RAISE EXCEPTION 'evidence_not_found' USING ERRCODE = '02000';
  END IF;
  PERFORM public.p5b4_write_audit(v_case, 'evidence_submitted', 'organisation_user',
    NULL, jsonb_build_object('file_hash', p_file_hash), NULL,
    'Evidence submitted.', NULL, p_evidence_id, NULL, NULL, NULL, NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.p5b4_review_evidence_v1(
  p_evidence_id uuid, p_decision public.p5_batch4_evidence_status, p_reason text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case uuid;
BEGIN
  PERFORM public.p5b4_require_admin();
  IF p_decision NOT IN ('accepted','rejected','expired','replaced','provider_dependent','under_review') THEN
    RAISE EXCEPTION 'invalid_review_decision' USING ERRCODE = '22023';
  END IF;
  IF p_decision IN ('rejected','expired') THEN
    PERFORM public.p5b4_require_reason(p_reason);
  END IF;
  UPDATE public.p5_batch4_evidence_items
    SET status = p_decision, reviewed_by = auth.uid(), review_reason = p_reason
    WHERE id = p_evidence_id
    RETURNING case_id INTO v_case;
  IF v_case IS NULL THEN RAISE EXCEPTION 'evidence_not_found' USING ERRCODE = '02000'; END IF;
  PERFORM public.p5b4_write_audit(v_case, 'evidence_reviewed', 'platform_admin',
    NULL, jsonb_build_object('decision', p_decision), p_reason,
    'Evidence reviewed.', NULL, p_evidence_id, NULL, NULL, NULL, NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.p5b4_waive_evidence_v1(p_evidence_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case uuid;
BEGIN
  PERFORM public.p5b4_require_admin();
  PERFORM public.p5b4_require_reason(p_reason);
  UPDATE public.p5_batch4_evidence_items
    SET status = 'waived', waived_by = auth.uid(), waiver_reason = p_reason
    WHERE id = p_evidence_id
    RETURNING case_id INTO v_case;
  IF v_case IS NULL THEN RAISE EXCEPTION 'evidence_not_found' USING ERRCODE = '02000'; END IF;
  PERFORM public.p5b4_write_audit(v_case, 'evidence_waived', 'platform_admin',
    NULL, NULL, p_reason, 'Evidence waived.', NULL, p_evidence_id, NULL, NULL, NULL, NULL);
END; $$;

-- ============================================================
-- 3. Blockers
-- ============================================================
CREATE OR REPLACE FUNCTION public.p5b4_open_blocker_v1(
  p_case_id uuid, p_blocker_key public.p5_batch4_blocker_key,
  p_blocker_name text, p_blocker_type public.p5_batch4_blocker_type,
  p_external_safe_label text, p_internal_detail text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.p5b4_require_admin();
  INSERT INTO public.p5_batch4_blockers(
    case_id, blocker_key, blocker_name, blocker_type,
    external_safe_label, internal_detail, status
  ) VALUES (p_case_id, p_blocker_key, p_blocker_name, p_blocker_type,
    p_external_safe_label, p_internal_detail, 'open')
  RETURNING id INTO v_id;
  UPDATE public.p5_batch4_execution_cases
    SET blocker_count = blocker_count + CASE WHEN p_blocker_type = 'hard' THEN 1 ELSE 0 END,
        warning_count = warning_count + CASE WHEN p_blocker_type = 'soft_warning' THEN 1 ELSE 0 END,
        execution_status = CASE WHEN p_blocker_type = 'hard' THEN 'blocked'::public.p5_batch4_execution_status ELSE execution_status END
    WHERE id = p_case_id;
  PERFORM public.p5b4_write_audit(p_case_id, 'blocker_opened', 'platform_admin',
    NULL, jsonb_build_object('blocker_key', p_blocker_key, 'type', p_blocker_type),
    NULL, p_external_safe_label, p_internal_detail, NULL, NULL, v_id, NULL, NULL);
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.p5b4_resolve_blocker_v1(p_blocker_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case uuid; v_type public.p5_batch4_blocker_type;
BEGIN
  PERFORM public.p5b4_require_admin();
  PERFORM public.p5b4_require_reason(p_reason);
  UPDATE public.p5_batch4_blockers
    SET status = 'resolved', resolved_by = auth.uid(),
        resolved_reason = p_reason, resolved_at = now()
    WHERE id = p_blocker_id AND status = 'open'
    RETURNING case_id, blocker_type INTO v_case, v_type;
  IF v_case IS NULL THEN RAISE EXCEPTION 'blocker_not_open' USING ERRCODE = '42501'; END IF;
  UPDATE public.p5_batch4_execution_cases
    SET blocker_count = GREATEST(blocker_count - CASE WHEN v_type = 'hard' THEN 1 ELSE 0 END, 0),
        warning_count = GREATEST(warning_count - CASE WHEN v_type = 'soft_warning' THEN 1 ELSE 0 END, 0)
    WHERE id = v_case;
  PERFORM public.p5b4_write_audit(v_case, 'blocker_resolved', 'platform_admin',
    NULL, NULL, p_reason, 'Blocker resolved.', NULL, NULL, NULL, p_blocker_id, NULL, NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.p5b4_override_blocker_v1(p_blocker_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case uuid; v_can_override boolean;
BEGIN
  PERFORM public.p5b4_require_admin();
  PERFORM public.p5b4_require_reason(p_reason);
  SELECT case_id, can_override INTO v_case, v_can_override
    FROM public.p5_batch4_blockers WHERE id = p_blocker_id;
  IF v_case IS NULL THEN RAISE EXCEPTION 'blocker_not_found' USING ERRCODE = '02000'; END IF;
  IF NOT v_can_override THEN RAISE EXCEPTION 'blocker_not_overridable' USING ERRCODE = '42501'; END IF;
  UPDATE public.p5_batch4_blockers
    SET status = 'overridden', overridden_by = auth.uid(),
        override_reason = p_reason, resolved_at = now()
    WHERE id = p_blocker_id;
  UPDATE public.p5_batch4_execution_cases
    SET blocker_count = GREATEST(blocker_count - 1, 0)
    WHERE id = v_case;
  PERFORM public.p5b4_write_audit(v_case, 'blocker_overridden', 'platform_admin',
    NULL, NULL, p_reason, 'Blocker overridden.', NULL, NULL, NULL, p_blocker_id, NULL, NULL);
END; $$;

-- ============================================================
-- 4. Milestone & governance / compliance decisions
-- ============================================================
CREATE OR REPLACE FUNCTION public.p5b4_complete_milestone_v1(
  p_case_id uuid, p_milestone_key public.p5_batch4_milestone_key
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.p5b4_require_admin();
  IF p_milestone_key IN ('final_approval','finality_recorded') THEN
    RAISE EXCEPTION 'use_finality_rpc_for_terminal_milestones' USING ERRCODE = '42501';
  END IF;
  UPDATE public.p5_batch4_execution_milestones
    SET status = 'complete', completed_at = now(), completed_by = auth.uid()
    WHERE case_id = p_case_id AND milestone_key = p_milestone_key;
  UPDATE public.p5_batch4_execution_cases
    SET current_milestone = p_milestone_key
    WHERE id = p_case_id;
  PERFORM public.p5b4_write_audit(p_case_id, 'milestone_completed', 'platform_admin',
    NULL, jsonb_build_object('milestone_key', p_milestone_key), NULL,
    'Milestone completed.', NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.p5b4_record_governance_decision_v1(
  p_case_id uuid, p_decision text, p_reason text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.p5b4_require_admin();
  IF p_decision NOT IN ('approved','rejected','more_information_requested') THEN
    RAISE EXCEPTION 'invalid_governance_decision' USING ERRCODE = '22023';
  END IF;
  IF p_decision <> 'approved' THEN PERFORM public.p5b4_require_reason(p_reason); END IF;
  UPDATE public.p5_batch4_execution_milestones
    SET status = CASE WHEN p_decision = 'approved' THEN 'complete'::public.p5_batch4_milestone_status ELSE 'blocked'::public.p5_batch4_milestone_status END,
        completed_at = CASE WHEN p_decision = 'approved' THEN now() ELSE NULL END,
        completed_by = CASE WHEN p_decision = 'approved' THEN auth.uid() ELSE NULL END
    WHERE case_id = p_case_id AND milestone_key = 'governance_review_complete';
  PERFORM public.p5b4_write_audit(p_case_id, 'governance_decision_recorded',
    'platform_admin', NULL, jsonb_build_object('decision', p_decision), p_reason,
    'Governance decision recorded.', NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.p5b4_record_compliance_decision_v1(
  p_case_id uuid, p_decision text, p_reason text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.p5b4_require_admin();
  IF p_decision NOT IN ('approved','rejected','more_information_requested') THEN
    RAISE EXCEPTION 'invalid_compliance_decision' USING ERRCODE = '22023';
  END IF;
  IF p_decision <> 'approved' THEN PERFORM public.p5b4_require_reason(p_reason); END IF;
  UPDATE public.p5_batch4_execution_milestones
    SET status = CASE WHEN p_decision = 'approved' THEN 'complete'::public.p5_batch4_milestone_status ELSE 'blocked'::public.p5_batch4_milestone_status END,
        completed_at = CASE WHEN p_decision = 'approved' THEN now() ELSE NULL END,
        completed_by = CASE WHEN p_decision = 'approved' THEN auth.uid() ELSE NULL END
    WHERE case_id = p_case_id AND milestone_key = 'compliance_review_complete';
  PERFORM public.p5b4_write_audit(p_case_id, 'compliance_decision_recorded',
    'platform_admin', NULL, jsonb_build_object('decision', p_decision), p_reason,
    'Compliance decision recorded.', NULL);
END; $$;

-- ============================================================
-- 5. Funder release / revocation / decision
-- ============================================================
CREATE OR REPLACE FUNCTION public.p5b4_release_funder_pack_v1(
  p_case_id uuid, p_funder_org_id uuid, p_pack_reference text,
  p_access_expires_at timestamptz, p_download_allowed boolean,
  p_nda_required boolean, p_release_scope jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.p5b4_require_admin();
  IF p_access_expires_at <= now() THEN
    RAISE EXCEPTION 'access_expiry_must_be_future' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.p5_batch4_funder_releases(
    case_id, funder_org_id, released_by, release_scope, pack_reference,
    access_expires_at, download_allowed, nda_required, status
  ) VALUES (p_case_id, p_funder_org_id, auth.uid(), COALESCE(p_release_scope, '{}'::jsonb),
    p_pack_reference, p_access_expires_at, p_download_allowed, p_nda_required, 'released')
  RETURNING id INTO v_id;
  UPDATE public.p5_batch4_execution_cases
    SET funder_status = 'released', current_milestone = 'funder_release',
        execution_status = 'funder_review'
    WHERE id = p_case_id;
  PERFORM public.p5b4_write_audit(p_case_id, 'funder_pack_released', 'platform_admin',
    NULL, jsonb_build_object('funder_org_id', p_funder_org_id, 'pack_reference', p_pack_reference),
    NULL, 'Funder pack released.', NULL, NULL, NULL, NULL, v_id, NULL);
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.p5b4_revoke_funder_access_v1(p_release_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case uuid;
BEGIN
  PERFORM public.p5b4_require_admin();
  PERFORM public.p5b4_require_reason(p_reason);
  UPDATE public.p5_batch4_funder_releases
    SET status = 'revoked', decision_at = now(),
        decision_by = auth.uid(), decision_note = p_reason
    WHERE id = p_release_id
    RETURNING case_id INTO v_case;
  IF v_case IS NULL THEN RAISE EXCEPTION 'release_not_found' USING ERRCODE = '02000'; END IF;
  UPDATE public.p5_batch4_execution_cases SET funder_status = 'revoked' WHERE id = v_case;
  PERFORM public.p5b4_write_audit(v_case, 'funder_access_revoked', 'platform_admin',
    NULL, NULL, p_reason, 'Funder access revoked.', NULL, NULL, NULL, NULL, p_release_id, NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.p5b4_record_funder_decision_v1(
  p_release_id uuid, p_status public.p5_batch4_funder_release_status, p_note text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case uuid; v_funder uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('viewed','more_information_requested','interested','not_interested',
                       'approved_internally','declined','exited') THEN
    RAISE EXCEPTION 'invalid_funder_status' USING ERRCODE = '22023';
  END IF;
  SELECT case_id, funder_org_id INTO v_case, v_funder
    FROM public.p5_batch4_funder_releases WHERE id = p_release_id;
  IF v_case IS NULL THEN RAISE EXCEPTION 'release_not_found' USING ERRCODE = '02000'; END IF;
  -- Funder caller must belong to the release's funder org (or be platform admin).
  IF NOT public.p5b4_is_platform_admin()
     AND public.p5b4_current_funder_org() IS DISTINCT FROM v_funder THEN
    RAISE EXCEPTION 'funder_org_mismatch' USING ERRCODE = '42501';
  END IF;
  UPDATE public.p5_batch4_funder_releases
    SET status = p_status, decision_at = now(),
        decision_by = auth.uid(), decision_note = p_note,
        last_viewed_at = CASE WHEN p_status = 'viewed' THEN now() ELSE last_viewed_at END
    WHERE id = p_release_id;
  UPDATE public.p5_batch4_execution_cases SET funder_status = p_status WHERE id = v_case;
  PERFORM public.p5b4_write_audit(v_case, 'funder_decision_recorded', 'funder_approver',
    NULL, jsonb_build_object('status', p_status), p_note,
    'Funder decision recorded.', NULL, NULL, NULL, NULL, p_release_id, NULL);
END; $$;

-- ============================================================
-- 6. Final approval & finality (platform-admin only, reason required)
-- ============================================================
CREATE OR REPLACE FUNCTION public.p5b4_record_final_approval_v1(p_case_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.p5b4_require_admin();
  PERFORM public.p5b4_require_reason(p_reason);
  UPDATE public.p5_batch4_execution_milestones
    SET status = 'complete', completed_at = now(), completed_by = auth.uid()
    WHERE case_id = p_case_id AND milestone_key = 'final_approval';
  UPDATE public.p5_batch4_execution_cases
    SET execution_status = 'final_approval_pending',
        current_milestone = 'final_approval'
    WHERE id = p_case_id;
  PERFORM public.p5b4_write_audit(p_case_id, 'final_approval_recorded',
    'platform_admin', NULL, NULL, p_reason, 'Final approval recorded.', NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.p5b4_record_finality_v1(
  p_case_id uuid, p_final_outcome public.p5_batch4_finality_outcome,
  p_finality_summary text, p_reason text,
  p_evidence_pack_reference text DEFAULT NULL,
  p_approval_reference text DEFAULT NULL,
  p_memory_summary jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_audit uuid; v_id uuid;
BEGIN
  PERFORM public.p5b4_require_admin();
  PERFORM public.p5b4_require_reason(p_reason);
  IF p_finality_summary IS NULL OR length(btrim(p_finality_summary)) < 4 THEN
    RAISE EXCEPTION 'finality_summary_required' USING ERRCODE = '22023';
  END IF;
  v_audit := public.p5b4_write_audit(p_case_id, 'finality_recorded',
    'platform_admin', NULL,
    jsonb_build_object('final_outcome', p_final_outcome),
    p_reason, 'Finality recorded.', NULL);
  INSERT INTO public.p5_batch4_finality_records(
    case_id, final_outcome, finality_summary, evidence_pack_reference,
    approval_reference, memory_summary, audit_reference, recorded_by
  ) VALUES (p_case_id, p_final_outcome, p_finality_summary,
            p_evidence_pack_reference, p_approval_reference,
            COALESCE(p_memory_summary, '{}'::jsonb), v_audit, auth.uid())
  RETURNING id INTO v_id;
  UPDATE public.p5_batch4_execution_cases
    SET execution_status = 'finality_recorded',
        finality_status  = p_final_outcome,
        current_milestone = 'finality_recorded'
    WHERE id = p_case_id;
  RETURN v_id;
END; $$;

-- ============================================================
-- 7. Explicit audit record (system / integration use)
-- ============================================================
CREATE OR REPLACE FUNCTION public.p5b4_record_audit_event_v1(
  p_case_id uuid, p_event_type text, p_external_safe text, p_internal text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.p5b4_require_admin();
  RETURN public.p5b4_write_audit(p_case_id, p_event_type, 'platform_admin',
    NULL, NULL, NULL, p_external_safe, p_internal);
END; $$;

-- ============================================================
-- 8. GRANT EXECUTE on the public RPCs (admin/funder/system).
-- All gates are inside the function bodies.
-- ============================================================
GRANT EXECUTE ON FUNCTION
  public.p5b4_open_case_v1(text,public.p5_batch4_process_type,uuid,uuid,uuid,uuid),
  public.p5b4_confirm_scope_v1(uuid,text),
  public.p5b4_close_case_v1(uuid,text),
  public.p5b4_reopen_case_v1(uuid,text),
  public.p5b4_generate_checklist_v1(uuid),
  public.p5b4_request_evidence_v1(uuid,text,text,public.p5_batch4_mandatory_type),
  public.p5b4_submit_evidence_v1(uuid,text,text),
  public.p5b4_review_evidence_v1(uuid,public.p5_batch4_evidence_status,text),
  public.p5b4_waive_evidence_v1(uuid,text),
  public.p5b4_open_blocker_v1(uuid,public.p5_batch4_blocker_key,text,public.p5_batch4_blocker_type,text,text),
  public.p5b4_resolve_blocker_v1(uuid,text),
  public.p5b4_override_blocker_v1(uuid,text),
  public.p5b4_complete_milestone_v1(uuid,public.p5_batch4_milestone_key),
  public.p5b4_record_governance_decision_v1(uuid,text,text),
  public.p5b4_record_compliance_decision_v1(uuid,text,text),
  public.p5b4_release_funder_pack_v1(uuid,uuid,text,timestamptz,boolean,boolean,jsonb),
  public.p5b4_revoke_funder_access_v1(uuid,text),
  public.p5b4_record_funder_decision_v1(uuid,public.p5_batch4_funder_release_status,text),
  public.p5b4_record_final_approval_v1(uuid,text),
  public.p5b4_record_finality_v1(uuid,public.p5_batch4_finality_outcome,text,text,text,text,jsonb),
  public.p5b4_record_audit_event_v1(uuid,text,text,text)
TO authenticated;
