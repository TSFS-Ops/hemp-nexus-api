
-- =========================================================================
-- P-5 Batch 1 — Stage 3: Action RPCs + SQL readiness mirror
-- Migration: p5_batch1_action_rpcs
-- =========================================================================

-- ---------------------------------------------------------------------------
-- 1. Extra tracking columns required by Stage 3 server-side enforcement.
-- ---------------------------------------------------------------------------
ALTER TABLE public.p5_governance_readiness_cases
  ADD COLUMN IF NOT EXISTS minimum_pack_confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS minimum_pack_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS human_approval_recorded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS human_approval_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS human_approval_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_audit_event_id uuid;

-- ---------------------------------------------------------------------------
-- 2. Internal audit helper.
--    Inserts an immutable audit row + returns id. Same transaction as caller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._p5_audit(
  _case_id uuid,
  _event_type text,
  _actor_user_id uuid,
  _actor_type public.p5_actor_type,
  _previous_status public.p5_status,
  _new_status public.p5_status,
  _reason_code public.p5_reason_code,
  _note text,
  _evidence_item_id uuid,
  _provider_reference text,
  _correlation_id text,
  _api_request_id text,
  _metadata jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  INSERT INTO public.p5_governance_audit_events(
    case_id, event_type, actor_user_id, actor_type,
    previous_status, new_status, reason_code, note,
    evidence_item_id, provider_reference, correlation_id,
    api_request_id, metadata
  ) VALUES (
    _case_id, _event_type, _actor_user_id, _actor_type,
    _previous_status, _new_status, _reason_code, _note,
    _evidence_item_id, _provider_reference, _correlation_id,
    _api_request_id, COALESCE(_metadata, '{}'::jsonb)
  )
  RETURNING id INTO _id;

  UPDATE public.p5_governance_readiness_cases
  SET last_audit_event_id = _id
  WHERE id = _case_id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public._p5_audit(uuid,text,uuid,public.p5_actor_type,public.p5_status,public.p5_status,public.p5_reason_code,text,uuid,text,text,text,jsonb) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. Reason-code requirement helper.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._p5_require_reason(
  _action text,
  _reason_code public.p5_reason_code,
  _note text
) RETURNS void
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF _reason_code IS NULL THEN
    RAISE EXCEPTION 'P5_REASON_REQUIRED: action % requires reason_code', _action
      USING ERRCODE = 'check_violation';
  END IF;
  IF _note IS NULL OR length(btrim(_note)) = 0 THEN
    RAISE EXCEPTION 'P5_NOTE_REQUIRED: action % requires non-empty note', _action
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Role-gate helper (raises if caller lacks any of the required roles).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._p5_require_role(
  _action text,
  _roles text[]
) RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'P5_AUTH_REQUIRED: action % requires an authenticated caller', _action
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.p5_has_any_role(_uid, _roles) THEN
    RAISE EXCEPTION 'P5_FORBIDDEN: action % requires one of roles %', _action, _roles
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN _uid;
END;
$$;
REVOKE ALL ON FUNCTION public._p5_require_role(text,text[]) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 5. SQL readiness mirror.
--    Mirrors Stage 2 calculateReadiness(); returns worst-outstanding-issue.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5_calculate_readiness(_case_id uuid)
RETURNS TABLE(
  status public.p5_status,
  reason public.p5_reason_code,
  blocker_count integer,
  warning_count integer,
  provider_dependency boolean,
  required_items_missing integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.p5_governance_readiness_cases%ROWTYPE;
  _missing int := 0;
  _expired int := 0;
  _rejected int := 0;
  _has_required_provider boolean := false;
  _provider_failed boolean := false;
  _provider_not_live boolean := false;
  _provider_pending boolean := false;
  _provider_timeout boolean := false;
  _provider_inconclusive boolean := false;
  _provider_creds_pending boolean := false;
  _provider_passed_or_na boolean := false;
BEGIN
  SELECT * INTO c FROM public.p5_governance_readiness_cases WHERE id = _case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P5_CASE_NOT_FOUND: %', _case_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT
    count(*) FILTER (WHERE required AND status IN ('not_started','incomplete','submitted')),
    count(*) FILTER (WHERE required AND status = 'rejected'),
    count(*) FILTER (WHERE required AND expiry_date IS NOT NULL AND expiry_date <= current_date)
  INTO _missing, _rejected, _expired
  FROM public.p5_governance_evidence_items
  WHERE case_id = _case_id;

  -- Provider state is encoded on the case row in Stage 1 schema.
  _has_required_provider := c.provider_dependency;
  IF _has_required_provider AND c.provider_status IS NOT NULL THEN
    _provider_failed       := c.provider_status = 'failed';
    _provider_not_live     := c.provider_status = 'not_live';
    _provider_creds_pending:= c.provider_status = 'credentials_pending';
    _provider_pending      := c.provider_status = 'pending';
    _provider_timeout      := c.provider_status = 'timeout';
    _provider_inconclusive := c.provider_status = 'inconclusive';
    _provider_passed_or_na := c.provider_status IN ('passed','not_applicable');
  END IF;

  blocker_count := (CASE WHEN _rejected > 0 THEN 1 ELSE 0 END)
                 + (CASE WHEN _provider_failed THEN 1 ELSE 0 END)
                 + (CASE WHEN c.is_on_hold THEN 1 ELSE 0 END);
  warning_count := 0;
  provider_dependency := _has_required_provider;
  required_items_missing := _missing + _expired;

  -- Worst-outstanding-issue ordering, mirrors Stage 2.
  IF _rejected > 0 THEN
    status := 'blocked'; reason := 'rejected_by_reviewer'; RETURN NEXT; RETURN;
  END IF;

  IF c.is_on_hold THEN
    status := 'on_hold'; reason := COALESCE(c.hold_reason_code, 'compliance_hold_applied'); RETURN NEXT; RETURN;
  END IF;

  IF c.is_escalated THEN
    status := 'escalated'; reason := COALESCE(c.escalation_reason_code, 'overdue_sla'); RETURN NEXT; RETURN;
  END IF;

  IF _expired > 0 THEN
    status := 'incomplete'; reason := 'expired_evidence'; RETURN NEXT; RETURN;
  END IF;

  IF _missing > 0 THEN
    status := 'incomplete'; reason := 'missing_evidence'; RETURN NEXT; RETURN;
  END IF;

  IF c.governance_status = 'more_information_required'
     OR c.compliance_status = 'more_information_required'
     OR c.readiness_status = 'more_information_required' THEN
    status := 'more_information_required'; reason := 'manual_review_required'; RETURN NEXT; RETURN;
  END IF;

  IF c.governance_status IN ('not_started','submitted','under_review') THEN
    status := 'under_review'; reason := 'manual_review_required'; RETURN NEXT; RETURN;
  END IF;

  IF _has_required_provider AND _provider_failed THEN
    status := 'blocked'; reason := 'provider_failed'; RETURN NEXT; RETURN;
  END IF;
  IF _has_required_provider AND _provider_not_live THEN
    status := 'provider_dependent'; reason := 'provider_not_live'; RETURN NEXT; RETURN;
  END IF;
  IF _has_required_provider AND _provider_creds_pending THEN
    status := 'provider_dependent'; reason := 'provider_credentials_pending'; RETURN NEXT; RETURN;
  END IF;
  IF _has_required_provider AND _provider_timeout THEN
    status := 'provider_dependent'; reason := 'provider_timeout'; RETURN NEXT; RETURN;
  END IF;
  IF _has_required_provider AND _provider_inconclusive THEN
    status := 'provider_dependent'; reason := 'provider_inconclusive'; RETURN NEXT; RETURN;
  END IF;
  IF _has_required_provider AND _provider_pending THEN
    status := 'provider_dependent'; reason := 'provider_pending'; RETURN NEXT; RETURN;
  END IF;

  IF c.waiver_active OR c.override_active THEN
    status := 'conditional_ready'; reason := COALESCE(c.waiver_reason_code, c.override_reason_code, 'waiver_granted'); RETURN NEXT; RETURN;
  END IF;

  IF NOT c.human_approval_recorded THEN
    status := 'internally_ready'; reason := 'approved_by_reviewer'; RETURN NEXT; RETURN;
  END IF;

  status := 'ready_to_proceed'; reason := 'approved_by_admin'; RETURN NEXT; RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.p5_calculate_readiness(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_calculate_readiness(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Recompute helper - writes back status/reason/counters to the case.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._p5_recompute_case(_case_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  _prev public.p5_status;
BEGIN
  SELECT readiness_status INTO _prev
  FROM public.p5_governance_readiness_cases WHERE id = _case_id;

  SELECT * INTO r FROM public.p5_calculate_readiness(_case_id) LIMIT 1;

  UPDATE public.p5_governance_readiness_cases
  SET readiness_status   = r.status,
      reason_codes       = CASE WHEN r.reason IS NOT NULL
                                THEN ARRAY[r.reason::text]::public.p5_reason_code[]
                                ELSE '{}'::public.p5_reason_code[] END,
      blocker_count      = r.blocker_count,
      warning_count      = r.warning_count,
      provider_dependency= r.provider_dependency,
      last_updated_at    = now(),
      status_changed_at  = CASE WHEN _prev IS DISTINCT FROM r.status THEN now() ELSE status_changed_at END
  WHERE id = _case_id;
END;
$$;
REVOKE ALL ON FUNCTION public._p5_recompute_case(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 7. Role bundles used by the action RPCs.
-- ---------------------------------------------------------------------------
-- Reviewer-capable: routine intake/review actions.
-- Admin-capable: senior approvals, holds, overrides.
-- Evidence-reviewer-capable: evidence approve/reject/request-correction.

-- Defined inline per RPC for clarity.

-- ---------------------------------------------------------------------------
-- 8. ACTION RPCs
-- ---------------------------------------------------------------------------

-- 8.1 p5_create_case
CREATE OR REPLACE FUNCTION public.p5_create_case(
  _organization_id uuid,
  _entity_id uuid DEFAULT NULL,
  _counterparty_id uuid DEFAULT NULL,
  _match_id uuid DEFAULT NULL,
  _programme_id uuid DEFAULT NULL,
  _trade_request_id uuid DEFAULT NULL,
  _initial_status public.p5_status DEFAULT 'not_started',
  _correlation_id text DEFAULT NULL,
  _api_request_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _id uuid;
BEGIN
  _uid := public._p5_require_role('p5_create_case', ARRAY[
    'platform_admin','executive_approver','governance_reviewer',
    'operator_case_manager','compliance_analyst','customer_entity_owner'
  ]);

  IF _initial_status NOT IN ('not_started','incomplete','submitted') THEN
    RAISE EXCEPTION 'P5_INVALID_INITIAL_STATUS: %', _initial_status USING ERRCODE='check_violation';
  END IF;

  INSERT INTO public.p5_governance_readiness_cases(
    organization_id, entity_id, counterparty_id, match_id, programme_id, trade_request_id,
    governance_status, compliance_status, readiness_status, reason_codes,
    blocker_count, warning_count, provider_dependency, is_on_hold, is_escalated,
    waiver_active, override_active, last_updated_at, status_changed_at
  ) VALUES (
    _organization_id, _entity_id, _counterparty_id, _match_id, _programme_id, _trade_request_id,
    _initial_status, _initial_status, _initial_status, '{}'::public.p5_reason_code[],
    0, 0, false, false, false, false, false, now(), now()
  )
  RETURNING id INTO _id;

  PERFORM public._p5_audit(
    _id, 'create_case', _uid, 'user',
    NULL, _initial_status, NULL, 'case created',
    NULL, NULL, _correlation_id, _api_request_id, '{}'::jsonb
  );

  PERFORM public._p5_recompute_case(_id);
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.p5_create_case(uuid,uuid,uuid,uuid,uuid,uuid,public.p5_status,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_create_case(uuid,uuid,uuid,uuid,uuid,uuid,public.p5_status,text,text) TO authenticated;

-- 8.2 p5_submit_case
CREATE OR REPLACE FUNCTION public.p5_submit_case(
  _case_id uuid,
  _minimum_pack_complete boolean DEFAULT false,
  _correlation_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _missing int;
  _prev public.p5_status;
BEGIN
  _uid := public._p5_require_role('p5_submit_case', ARRAY[
    'platform_admin','executive_approver','governance_reviewer',
    'operator_case_manager','compliance_analyst','customer_entity_owner'
  ]);

  SELECT readiness_status INTO _prev FROM public.p5_governance_readiness_cases WHERE id=_case_id FOR UPDATE;
  IF _prev IS NULL THEN RAISE EXCEPTION 'P5_CASE_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;
  IF _prev NOT IN ('not_started','incomplete','more_information_required') THEN
    RAISE EXCEPTION 'P5_ILLEGAL_TRANSITION: % -> submitted', _prev USING ERRCODE='check_violation';
  END IF;

  SELECT count(*) INTO _missing
  FROM public.p5_governance_evidence_items
  WHERE case_id=_case_id AND required AND status IN ('not_started','incomplete');

  IF _missing > 0 AND NOT _minimum_pack_complete THEN
    RAISE EXCEPTION 'P5_MISSING_REQUIRED_EVIDENCE: % required items missing', _missing USING ERRCODE='check_violation';
  END IF;

  IF _minimum_pack_complete AND NOT public.p5_has_any_role(_uid, ARRAY['platform_admin','operator_case_manager','compliance_analyst']) THEN
    RAISE EXCEPTION 'P5_FORBIDDEN: minimum_pack override requires operator/admin' USING ERRCODE='insufficient_privilege';
  END IF;

  UPDATE public.p5_governance_readiness_cases
  SET governance_status='submitted', compliance_status='submitted', readiness_status='submitted',
      minimum_pack_confirmed_by = CASE WHEN _minimum_pack_complete THEN _uid ELSE minimum_pack_confirmed_by END,
      minimum_pack_confirmed_at = CASE WHEN _minimum_pack_complete THEN now() ELSE minimum_pack_confirmed_at END
  WHERE id=_case_id;

  PERFORM public._p5_audit(_case_id,'submit_case',_uid,'user',_prev,'submitted',NULL,
    'case submitted', NULL, NULL, _correlation_id, NULL,
    jsonb_build_object('minimum_pack_complete', _minimum_pack_complete));
  PERFORM public._p5_recompute_case(_case_id);
END;
$$;
REVOKE ALL ON FUNCTION public.p5_submit_case(uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_submit_case(uuid,boolean,text) TO authenticated;

-- 8.3 p5_start_review
CREATE OR REPLACE FUNCTION public.p5_start_review(
  _case_id uuid,
  _reviewer_id uuid,
  _correlation_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _prev public.p5_status;
BEGIN
  _uid := public._p5_require_role('p5_start_review', ARRAY[
    'platform_admin','executive_approver','governance_reviewer',
    'operator_case_manager','compliance_analyst'
  ]);

  SELECT readiness_status INTO _prev FROM public.p5_governance_readiness_cases WHERE id=_case_id FOR UPDATE;
  IF _prev IS NULL THEN RAISE EXCEPTION 'P5_CASE_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;
  IF _prev NOT IN ('submitted','more_information_required') THEN
    RAISE EXCEPTION 'P5_ILLEGAL_TRANSITION: % -> under_review', _prev USING ERRCODE='check_violation';
  END IF;

  UPDATE public.p5_governance_readiness_cases
  SET governance_status='under_review', compliance_status='under_review',
      readiness_status='under_review', assigned_reviewer_id=_reviewer_id
  WHERE id=_case_id;

  PERFORM public._p5_audit(_case_id,'start_review',_uid,'user',_prev,'under_review',NULL,
    'review started', NULL, NULL, _correlation_id, NULL,
    jsonb_build_object('reviewer_id', _reviewer_id));
  PERFORM public._p5_recompute_case(_case_id);
END;
$$;
REVOKE ALL ON FUNCTION public.p5_start_review(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_start_review(uuid,uuid,text) TO authenticated;

-- 8.4 p5_request_more_info
CREATE OR REPLACE FUNCTION public.p5_request_more_info(
  _case_id uuid,
  _reason_code public.p5_reason_code,
  _note text,
  _owner_user_id uuid DEFAULT NULL,
  _due_at timestamptz DEFAULT NULL,
  _correlation_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid; _prev public.p5_status;
BEGIN
  _uid := public._p5_require_role('p5_request_more_info', ARRAY[
    'platform_admin','executive_approver','governance_reviewer',
    'operator_case_manager','compliance_analyst'
  ]);
  PERFORM public._p5_require_reason('p5_request_more_info', _reason_code, _note);

  SELECT readiness_status INTO _prev FROM public.p5_governance_readiness_cases WHERE id=_case_id FOR UPDATE;
  IF _prev IS NULL THEN RAISE EXCEPTION 'P5_CASE_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;
  IF _prev NOT IN ('under_review','submitted') THEN
    RAISE EXCEPTION 'P5_ILLEGAL_TRANSITION: % -> more_information_required', _prev USING ERRCODE='check_violation';
  END IF;

  UPDATE public.p5_governance_readiness_cases
  SET governance_status='more_information_required',
      compliance_status='more_information_required',
      readiness_status='more_information_required',
      owner_user_id = COALESCE(_owner_user_id, owner_user_id),
      sla_due_at = COALESCE(_due_at, sla_due_at)
  WHERE id=_case_id;

  PERFORM public._p5_audit(_case_id,'request_more_information',_uid,'user',_prev,
    'more_information_required',_reason_code,_note,NULL,NULL,_correlation_id,NULL,
    jsonb_build_object('owner_user_id',_owner_user_id,'due_at',_due_at));
  PERFORM public._p5_recompute_case(_case_id);
END;
$$;
REVOKE ALL ON FUNCTION public.p5_request_more_info(uuid,public.p5_reason_code,text,uuid,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_request_more_info(uuid,public.p5_reason_code,text,uuid,timestamptz,text) TO authenticated;

-- 8.5 p5_approve_internally
CREATE OR REPLACE FUNCTION public.p5_approve_internally(
  _case_id uuid,
  _correlation_id text DEFAULT NULL
) RETURNS public.p5_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid; _prev public.p5_status; _new public.p5_status;
BEGIN
  _uid := public._p5_require_role('p5_approve_internally', ARRAY[
    'platform_admin','executive_approver','governance_reviewer','compliance_analyst'
  ]);
  SELECT readiness_status INTO _prev FROM public.p5_governance_readiness_cases WHERE id=_case_id FOR UPDATE;
  IF _prev IS NULL THEN RAISE EXCEPTION 'P5_CASE_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;
  IF _prev NOT IN ('under_review','provider_dependent','conditional_ready','internally_ready') THEN
    RAISE EXCEPTION 'P5_ILLEGAL_TRANSITION: % -> internally_ready', _prev USING ERRCODE='check_violation';
  END IF;

  UPDATE public.p5_governance_readiness_cases
  SET governance_status='internally_ready', compliance_status='internally_ready',
      readiness_status='internally_ready'
  WHERE id=_case_id;

  PERFORM public._p5_audit(_case_id,'approve_internally',_uid,'user',_prev,'internally_ready',
    'approved_by_reviewer','internal approval recorded',NULL,NULL,_correlation_id,NULL,'{}'::jsonb);
  PERFORM public._p5_recompute_case(_case_id);
  SELECT readiness_status INTO _new FROM public.p5_governance_readiness_cases WHERE id=_case_id;
  RETURN _new;
END;
$$;
REVOKE ALL ON FUNCTION public.p5_approve_internally(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_approve_internally(uuid,text) TO authenticated;

-- 8.6 p5_mark_provider_dependent
CREATE OR REPLACE FUNCTION public.p5_mark_provider_dependent(
  _case_id uuid,
  _provider_dependency_type text,
  _provider_status public.p5_provider_status,
  _correlation_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid; _prev public.p5_status;
BEGIN
  _uid := public._p5_require_role('p5_mark_provider_dependent', ARRAY[
    'platform_admin','executive_approver','governance_reviewer','compliance_analyst','operator_case_manager'
  ]);
  IF _provider_dependency_type IS NULL OR length(btrim(_provider_dependency_type))=0 THEN
    RAISE EXCEPTION 'P5_PROVIDER_TYPE_REQUIRED' USING ERRCODE='check_violation';
  END IF;
  SELECT readiness_status INTO _prev FROM public.p5_governance_readiness_cases WHERE id=_case_id FOR UPDATE;
  IF _prev IS NULL THEN RAISE EXCEPTION 'P5_CASE_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;

  UPDATE public.p5_governance_readiness_cases
  SET provider_dependency=true,
      provider_dependency_type=_provider_dependency_type,
      provider_status=_provider_status,
      provider_last_checked_at=now()
  WHERE id=_case_id;

  PERFORM public._p5_audit(_case_id,'mark_provider_dependent',_uid,'user',_prev,NULL,
    CASE _provider_status
      WHEN 'not_live' THEN 'provider_not_live'::public.p5_reason_code
      WHEN 'credentials_pending' THEN 'provider_credentials_pending'::public.p5_reason_code
      WHEN 'pending' THEN 'provider_pending'::public.p5_reason_code
      WHEN 'timeout' THEN 'provider_timeout'::public.p5_reason_code
      WHEN 'inconclusive' THEN 'provider_inconclusive'::public.p5_reason_code
      WHEN 'failed' THEN 'provider_failed'::public.p5_reason_code
      ELSE NULL
    END,
    'provider dependency recorded', NULL, NULL, _correlation_id, NULL,
    jsonb_build_object('provider_type',_provider_dependency_type,'provider_status',_provider_status));
  PERFORM public._p5_recompute_case(_case_id);
END;
$$;
REVOKE ALL ON FUNCTION public.p5_mark_provider_dependent(uuid,text,public.p5_provider_status,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_mark_provider_dependent(uuid,text,public.p5_provider_status,text) TO authenticated;

-- 8.7 p5_record_provider_result
CREATE OR REPLACE FUNCTION public.p5_record_provider_result(
  _case_id uuid,
  _provider_status public.p5_provider_status,
  _provider_reference text,
  _provider_checked_at timestamptz DEFAULT now(),
  _is_high_risk_domain boolean DEFAULT false,
  _correlation_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid; _prev public.p5_status;
BEGIN
  _uid := public._p5_require_role('p5_record_provider_result', ARRAY[
    'platform_admin','developer_technical_admin','operator_case_manager','compliance_analyst','governance_reviewer','executive_approver'
  ]);
  SELECT readiness_status INTO _prev FROM public.p5_governance_readiness_cases WHERE id=_case_id FOR UPDATE;
  IF _prev IS NULL THEN RAISE EXCEPTION 'P5_CASE_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;

  UPDATE public.p5_governance_readiness_cases
  SET provider_status=_provider_status,
      provider_last_checked_at=_provider_checked_at,
      -- High-risk results: revert to under_review and clear prior human approval.
      governance_status = CASE WHEN _is_high_risk_domain THEN 'under_review' ELSE governance_status END,
      compliance_status = CASE WHEN _is_high_risk_domain THEN 'under_review' ELSE compliance_status END,
      human_approval_recorded = CASE WHEN _is_high_risk_domain THEN false ELSE human_approval_recorded END,
      human_approval_by_user_id = CASE WHEN _is_high_risk_domain THEN NULL ELSE human_approval_by_user_id END,
      human_approval_recorded_at= CASE WHEN _is_high_risk_domain THEN NULL ELSE human_approval_recorded_at END
  WHERE id=_case_id;

  PERFORM public._p5_audit(_case_id,'record_provider_result',_uid,'provider',_prev,NULL,
    'provider_result_received','provider result recorded',NULL,_provider_reference,_correlation_id,NULL,
    jsonb_build_object('provider_status',_provider_status,'high_risk',_is_high_risk_domain,'checked_at',_provider_checked_at));
  PERFORM public._p5_recompute_case(_case_id);
END;
$$;
REVOKE ALL ON FUNCTION public.p5_record_provider_result(uuid,public.p5_provider_status,text,timestamptz,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_record_provider_result(uuid,public.p5_provider_status,text,timestamptz,boolean,text) TO authenticated;

-- 8.8 p5_approve_ready_to_proceed
CREATE OR REPLACE FUNCTION public.p5_approve_ready_to_proceed(
  _case_id uuid,
  _note text,
  _correlation_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid; c public.p5_governance_readiness_cases%ROWTYPE; r record;
BEGIN
  _uid := public._p5_require_role('p5_approve_ready_to_proceed', ARRAY['platform_admin','executive_approver']);
  IF _note IS NULL OR length(btrim(_note))=0 THEN
    RAISE EXCEPTION 'P5_NOTE_REQUIRED: approval note required' USING ERRCODE='check_violation';
  END IF;
  SELECT * INTO c FROM public.p5_governance_readiness_cases WHERE id=_case_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'P5_CASE_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;
  IF c.is_on_hold THEN
    RAISE EXCEPTION 'P5_HOLD_BLOCKS_READY: unreleased hold prevents ready_to_proceed' USING ERRCODE='check_violation';
  END IF;

  SELECT * INTO r FROM public.p5_calculate_readiness(_case_id) LIMIT 1;
  IF r.blocker_count > 0 THEN
    RAISE EXCEPTION 'P5_BLOCKER_PREVENTS_READY: % blocker(s) outstanding', r.blocker_count USING ERRCODE='check_violation';
  END IF;
  IF c.provider_dependency AND c.provider_status NOT IN ('passed','not_applicable') THEN
    RAISE EXCEPTION 'P5_PROVIDER_DEPENDENCY_BLOCKS_READY: provider_status=%', c.provider_status USING ERRCODE='check_violation';
  END IF;
  IF c.readiness_status NOT IN ('internally_ready','conditional_ready') THEN
    RAISE EXCEPTION 'P5_ILLEGAL_TRANSITION: % -> ready_to_proceed', c.readiness_status USING ERRCODE='check_violation';
  END IF;

  UPDATE public.p5_governance_readiness_cases
  SET governance_status='ready_to_proceed', compliance_status='ready_to_proceed',
      readiness_status='ready_to_proceed',
      human_approval_recorded=true,
      human_approval_by_user_id=_uid,
      human_approval_recorded_at=now(),
      decision_reference = COALESCE(decision_reference, gen_random_uuid()::text)
  WHERE id=_case_id;

  PERFORM public._p5_audit(_case_id,'approve_ready_to_proceed',_uid,'user',c.readiness_status,'ready_to_proceed',
    'approved_by_admin',_note,NULL,NULL,_correlation_id,NULL,'{}'::jsonb);
  PERFORM public._p5_recompute_case(_case_id);
END;
$$;
REVOKE ALL ON FUNCTION public.p5_approve_ready_to_proceed(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_approve_ready_to_proceed(uuid,text,text) TO authenticated;

-- 8.9 p5_apply_hold
CREATE OR REPLACE FUNCTION public.p5_apply_hold(
  _case_id uuid,
  _hold_type text,
  _reason_code public.p5_reason_code,
  _note text,
  _owner_user_id uuid DEFAULT NULL,
  _review_date date DEFAULT NULL,
  _correlation_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid; _prev public.p5_status;
BEGIN
  _uid := public._p5_require_role('p5_apply_hold', ARRAY[
    'platform_admin','executive_approver','compliance_analyst','governance_reviewer'
  ]);
  PERFORM public._p5_require_reason('p5_apply_hold',_reason_code,_note);
  IF _hold_type IS NULL OR length(btrim(_hold_type))=0 THEN
    RAISE EXCEPTION 'P5_HOLD_TYPE_REQUIRED' USING ERRCODE='check_violation';
  END IF;
  SELECT readiness_status INTO _prev FROM public.p5_governance_readiness_cases WHERE id=_case_id FOR UPDATE;
  IF _prev IS NULL THEN RAISE EXCEPTION 'P5_CASE_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;

  UPDATE public.p5_governance_readiness_cases
  SET is_on_hold=true, hold_type=_hold_type, hold_reason_code=_reason_code,
      hold_owner_user_id=_owner_user_id, hold_review_date=_review_date,
      governance_status='on_hold', compliance_status='on_hold', readiness_status='on_hold'
  WHERE id=_case_id;

  PERFORM public._p5_audit(_case_id,'apply_hold',_uid,'user',_prev,'on_hold',_reason_code,_note,
    NULL,NULL,_correlation_id,NULL,
    jsonb_build_object('hold_type',_hold_type,'owner_user_id',_owner_user_id,'review_date',_review_date));
  PERFORM public._p5_recompute_case(_case_id);
END;
$$;
REVOKE ALL ON FUNCTION public.p5_apply_hold(uuid,text,public.p5_reason_code,text,uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_apply_hold(uuid,text,public.p5_reason_code,text,uuid,date,text) TO authenticated;

-- 8.10 p5_release_hold
CREATE OR REPLACE FUNCTION public.p5_release_hold(
  _case_id uuid,
  _reason_code public.p5_reason_code,
  _note text,
  _correlation_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid; _prev public.p5_status;
BEGIN
  -- Release is NEVER automatic - always requires senior human action.
  _uid := public._p5_require_role('p5_release_hold', ARRAY[
    'platform_admin','executive_approver','compliance_analyst'
  ]);
  PERFORM public._p5_require_reason('p5_release_hold',_reason_code,_note);
  SELECT readiness_status INTO _prev FROM public.p5_governance_readiness_cases WHERE id=_case_id FOR UPDATE;
  IF _prev IS NULL THEN RAISE EXCEPTION 'P5_CASE_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.p5_governance_readiness_cases WHERE id=_case_id AND is_on_hold) THEN
    RAISE EXCEPTION 'P5_NOT_ON_HOLD' USING ERRCODE='check_violation';
  END IF;

  UPDATE public.p5_governance_readiness_cases
  SET is_on_hold=false, hold_type=NULL, hold_reason_code=NULL,
      hold_owner_user_id=NULL, hold_review_date=NULL,
      governance_status='under_review', compliance_status='under_review', readiness_status='under_review'
  WHERE id=_case_id;

  PERFORM public._p5_audit(_case_id,'release_hold',_uid,'user',_prev,'under_review','compliance_hold_released',_note,
    NULL,NULL,_correlation_id,NULL,'{}'::jsonb);
  PERFORM public._p5_recompute_case(_case_id);
END;
$$;
REVOKE ALL ON FUNCTION public.p5_release_hold(uuid,public.p5_reason_code,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_release_hold(uuid,public.p5_reason_code,text,text) TO authenticated;

-- 8.11 p5_reject
CREATE OR REPLACE FUNCTION public.p5_reject(
  _case_id uuid,
  _reason_code public.p5_reason_code,
  _note text,
  _evidence_item_id uuid DEFAULT NULL,
  _correlation_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid; _prev public.p5_status;
BEGIN
  _uid := public._p5_require_role('p5_reject', ARRAY[
    'platform_admin','executive_approver','governance_reviewer','compliance_analyst'
  ]);
  PERFORM public._p5_require_reason('p5_reject',_reason_code,_note);
  SELECT readiness_status INTO _prev FROM public.p5_governance_readiness_cases WHERE id=_case_id FOR UPDATE;
  IF _prev IS NULL THEN RAISE EXCEPTION 'P5_CASE_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;
  IF _prev NOT IN ('under_review','submitted','more_information_required','provider_dependent','conditional_ready','internally_ready') THEN
    RAISE EXCEPTION 'P5_ILLEGAL_TRANSITION: % -> rejected', _prev USING ERRCODE='check_violation';
  END IF;

  UPDATE public.p5_governance_readiness_cases
  SET governance_status='rejected', compliance_status='rejected', readiness_status='rejected'
  WHERE id=_case_id;

  PERFORM public._p5_audit(_case_id,'reject',_uid,'user',_prev,'rejected',_reason_code,_note,
    _evidence_item_id,NULL,_correlation_id,NULL,'{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.p5_reject(uuid,public.p5_reason_code,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_reject(uuid,public.p5_reason_code,text,uuid,text) TO authenticated;

-- 8.12 p5_escalate
CREATE OR REPLACE FUNCTION public.p5_escalate(
  _case_id uuid,
  _reason_code public.p5_reason_code,
  _note text,
  _owner_user_id uuid DEFAULT NULL,
  _due_at timestamptz DEFAULT NULL,
  _correlation_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid; _prev public.p5_status;
BEGIN
  _uid := public._p5_require_role('p5_escalate', ARRAY[
    'platform_admin','executive_approver','governance_reviewer','compliance_analyst','operator_case_manager'
  ]);
  PERFORM public._p5_require_reason('p5_escalate',_reason_code,_note);
  SELECT readiness_status INTO _prev FROM public.p5_governance_readiness_cases WHERE id=_case_id FOR UPDATE;
  IF _prev IS NULL THEN RAISE EXCEPTION 'P5_CASE_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;

  UPDATE public.p5_governance_readiness_cases
  SET is_escalated=true, escalation_reason_code=_reason_code,
      escalation_owner_user_id=_owner_user_id, escalated_at=now(),
      sla_due_at=COALESCE(_due_at, sla_due_at),
      readiness_status='escalated'
  WHERE id=_case_id;

  PERFORM public._p5_audit(_case_id,'escalate',_uid,'user',_prev,'escalated',_reason_code,_note,
    NULL,NULL,_correlation_id,NULL,jsonb_build_object('owner_user_id',_owner_user_id,'due_at',_due_at));
  PERFORM public._p5_recompute_case(_case_id);
END;
$$;
REVOKE ALL ON FUNCTION public.p5_escalate(uuid,public.p5_reason_code,text,uuid,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_escalate(uuid,public.p5_reason_code,text,uuid,timestamptz,text) TO authenticated;

-- 8.13 p5_waive
CREATE OR REPLACE FUNCTION public.p5_waive(
  _case_id uuid,
  _reason_code public.p5_reason_code,
  _note text,
  _scope text,
  _expires_at timestamptz DEFAULT NULL,
  _risk_acceptance_note text DEFAULT NULL,
  _correlation_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid; _prev public.p5_status;
BEGIN
  _uid := public._p5_require_role('p5_waive', ARRAY['platform_admin','executive_approver','compliance_analyst']);
  PERFORM public._p5_require_reason('p5_waive',_reason_code,_note);
  IF _scope IS NULL OR length(btrim(_scope))=0 THEN
    RAISE EXCEPTION 'P5_WAIVER_SCOPE_REQUIRED' USING ERRCODE='check_violation';
  END IF;
  IF _risk_acceptance_note IS NULL OR length(btrim(_risk_acceptance_note))=0 THEN
    RAISE EXCEPTION 'P5_RISK_ACCEPTANCE_REQUIRED' USING ERRCODE='check_violation';
  END IF;
  SELECT readiness_status INTO _prev FROM public.p5_governance_readiness_cases WHERE id=_case_id FOR UPDATE;
  IF _prev IS NULL THEN RAISE EXCEPTION 'P5_CASE_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;

  UPDATE public.p5_governance_readiness_cases
  SET waiver_active=true, waiver_reason_code=_reason_code, waiver_scope=_scope,
      waiver_expires_at=_expires_at, waiver_approved_by=_uid
  WHERE id=_case_id;

  PERFORM public._p5_audit(_case_id,'waive',_uid,'user',_prev,NULL,_reason_code,_note,
    NULL,NULL,_correlation_id,NULL,jsonb_build_object('scope',_scope,'expires_at',_expires_at,'risk_acceptance',_risk_acceptance_note));
  PERFORM public._p5_recompute_case(_case_id);
END;
$$;
REVOKE ALL ON FUNCTION public.p5_waive(uuid,public.p5_reason_code,text,text,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_waive(uuid,public.p5_reason_code,text,text,timestamptz,text,text) TO authenticated;

-- 8.14 p5_override
CREATE OR REPLACE FUNCTION public.p5_override(
  _case_id uuid,
  _reason_code public.p5_reason_code,
  _note text,
  _scope text,
  _expires_at timestamptz DEFAULT NULL,
  _risk_acceptance_note text DEFAULT NULL,
  _correlation_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid; _prev public.p5_status;
BEGIN
  _uid := public._p5_require_role('p5_override', ARRAY['platform_admin','executive_approver']);
  PERFORM public._p5_require_reason('p5_override',_reason_code,_note);
  IF _scope IS NULL OR length(btrim(_scope))=0 THEN
    RAISE EXCEPTION 'P5_OVERRIDE_SCOPE_REQUIRED' USING ERRCODE='check_violation';
  END IF;
  IF _risk_acceptance_note IS NULL OR length(btrim(_risk_acceptance_note))=0 THEN
    RAISE EXCEPTION 'P5_RISK_ACCEPTANCE_REQUIRED' USING ERRCODE='check_violation';
  END IF;
  SELECT readiness_status INTO _prev FROM public.p5_governance_readiness_cases WHERE id=_case_id FOR UPDATE;
  IF _prev IS NULL THEN RAISE EXCEPTION 'P5_CASE_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;

  UPDATE public.p5_governance_readiness_cases
  SET override_active=true, override_reason_code=_reason_code, override_scope=_scope,
      override_expires_at=_expires_at, override_approved_by=_uid
  WHERE id=_case_id;

  PERFORM public._p5_audit(_case_id,'override',_uid,'user',_prev,NULL,_reason_code,_note,
    NULL,NULL,_correlation_id,NULL,jsonb_build_object('scope',_scope,'expires_at',_expires_at,'risk_acceptance',_risk_acceptance_note));
  PERFORM public._p5_recompute_case(_case_id);
END;
$$;
REVOKE ALL ON FUNCTION public.p5_override(uuid,public.p5_reason_code,text,text,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_override(uuid,public.p5_reason_code,text,text,timestamptz,text,text) TO authenticated;

-- 8.15 p5_reopen
CREATE OR REPLACE FUNCTION public.p5_reopen(
  _case_id uuid,
  _reason_code public.p5_reason_code,
  _note text,
  _correlation_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid; _prev public.p5_status;
BEGIN
  _uid := public._p5_require_role('p5_reopen', ARRAY['platform_admin','executive_approver','compliance_analyst']);
  PERFORM public._p5_require_reason('p5_reopen',_reason_code,_note);
  SELECT readiness_status INTO _prev FROM public.p5_governance_readiness_cases WHERE id=_case_id FOR UPDATE;
  IF _prev IS NULL THEN RAISE EXCEPTION 'P5_CASE_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;
  IF _prev NOT IN ('rejected','ready_to_proceed','on_hold','archived_superseded','conditional_ready') THEN
    RAISE EXCEPTION 'P5_ILLEGAL_TRANSITION: % -> reopened', _prev USING ERRCODE='check_violation';
  END IF;

  UPDATE public.p5_governance_readiness_cases
  SET governance_status='reopened', compliance_status='reopened', readiness_status='reopened',
      human_approval_recorded=false, human_approval_by_user_id=NULL, human_approval_recorded_at=NULL
  WHERE id=_case_id;

  PERFORM public._p5_audit(_case_id,'reopen',_uid,'user',_prev,'reopened',_reason_code,_note,
    NULL,NULL,_correlation_id,NULL,'{}'::jsonb);
  PERFORM public._p5_recompute_case(_case_id);
END;
$$;
REVOKE ALL ON FUNCTION public.p5_reopen(uuid,public.p5_reason_code,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_reopen(uuid,public.p5_reason_code,text,text) TO authenticated;

-- 8.16 p5_archive_superseded
CREATE OR REPLACE FUNCTION public.p5_archive_superseded(
  _case_id uuid,
  _reason_code public.p5_reason_code,
  _note text,
  _correlation_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid; _prev public.p5_status;
BEGIN
  _uid := public._p5_require_role('p5_archive_superseded', ARRAY['platform_admin','executive_approver','compliance_analyst','operator_case_manager']);
  PERFORM public._p5_require_reason('p5_archive_superseded',_reason_code,_note);
  SELECT readiness_status INTO _prev FROM public.p5_governance_readiness_cases WHERE id=_case_id FOR UPDATE;
  IF _prev IS NULL THEN RAISE EXCEPTION 'P5_CASE_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;

  UPDATE public.p5_governance_readiness_cases
  SET governance_status='archived_superseded', compliance_status='archived_superseded',
      readiness_status='archived_superseded'
  WHERE id=_case_id;

  PERFORM public._p5_audit(_case_id,'archive_superseded',_uid,'user',_prev,'archived_superseded',_reason_code,_note,
    NULL,NULL,_correlation_id,NULL,'{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.p5_archive_superseded(uuid,public.p5_reason_code,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_archive_superseded(uuid,public.p5_reason_code,text,text) TO authenticated;

-- 8.17 p5_assign_owner
CREATE OR REPLACE FUNCTION public.p5_assign_owner(
  _case_id uuid,
  _new_owner_user_id uuid,
  _correlation_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid; _prev_owner uuid; _status public.p5_status;
BEGIN
  _uid := public._p5_require_role('p5_assign_owner', ARRAY[
    'platform_admin','executive_approver','operator_case_manager','governance_reviewer','compliance_analyst'
  ]);
  SELECT owner_user_id, readiness_status INTO _prev_owner, _status
    FROM public.p5_governance_readiness_cases WHERE id=_case_id FOR UPDATE;
  IF _status IS NULL THEN RAISE EXCEPTION 'P5_CASE_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;

  UPDATE public.p5_governance_readiness_cases SET owner_user_id=_new_owner_user_id WHERE id=_case_id;

  PERFORM public._p5_audit(_case_id,'assign_owner',_uid,'user',_status,_status,NULL,'owner reassigned',
    NULL,NULL,_correlation_id,NULL,
    jsonb_build_object('previous_owner_user_id',_prev_owner,'new_owner_user_id',_new_owner_user_id));
END;
$$;
REVOKE ALL ON FUNCTION public.p5_assign_owner(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_assign_owner(uuid,uuid,text) TO authenticated;

-- 8.18 p5_upload_evidence_meta
CREATE OR REPLACE FUNCTION public.p5_upload_evidence_meta(
  _case_id uuid,
  _evidence_type text,
  _required boolean,
  _uploaded_file_id uuid DEFAULT NULL,
  _expiry_date date DEFAULT NULL,
  _correlation_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid; _id uuid; _next_version int;
BEGIN
  _uid := public._p5_require_role('p5_upload_evidence_meta', ARRAY[
    'platform_admin','executive_approver','governance_reviewer','operator_case_manager',
    'compliance_analyst','customer_entity_owner'
  ]);
  IF _evidence_type IS NULL OR length(btrim(_evidence_type))=0 THEN
    RAISE EXCEPTION 'P5_EVIDENCE_TYPE_REQUIRED' USING ERRCODE='check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.p5_governance_readiness_cases WHERE id=_case_id) THEN
    RAISE EXCEPTION 'P5_CASE_NOT_FOUND' USING ERRCODE='no_data_found';
  END IF;

  SELECT COALESCE(MAX(evidence_version),0)+1 INTO _next_version
  FROM public.p5_governance_evidence_items
  WHERE case_id=_case_id AND evidence_type=_evidence_type;

  INSERT INTO public.p5_governance_evidence_items(
    case_id, evidence_type, required, status, uploaded_file_id,
    evidence_version, expiry_date
  ) VALUES (
    _case_id, _evidence_type, _required, 'submitted', _uploaded_file_id,
    _next_version, _expiry_date
  ) RETURNING id INTO _id;

  PERFORM public._p5_audit(_case_id,'upload_evidence_meta',_uid,'user',NULL,NULL,NULL,
    'evidence metadata recorded', _id, NULL, _correlation_id, NULL,
    jsonb_build_object('evidence_type',_evidence_type,'version',_next_version,'required',_required));
  PERFORM public._p5_recompute_case(_case_id);
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.p5_upload_evidence_meta(uuid,text,boolean,uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_upload_evidence_meta(uuid,text,boolean,uuid,date,text) TO authenticated;

-- 8.19 p5_review_evidence
CREATE OR REPLACE FUNCTION public.p5_review_evidence(
  _evidence_item_id uuid,
  _decision text,  -- 'approve' | 'reject' | 'request_correction'
  _reason_code public.p5_reason_code DEFAULT NULL,
  _note text DEFAULT NULL,
  _customer_safe_note text DEFAULT NULL,
  _correlation_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid; _case_id uuid; _required boolean; _new_status public.p5_status;
BEGIN
  _uid := public._p5_require_role('p5_review_evidence', ARRAY[
    'platform_admin','executive_approver','governance_reviewer','compliance_analyst'
  ]);
  IF _decision NOT IN ('approve','reject','request_correction') THEN
    RAISE EXCEPTION 'P5_INVALID_DECISION: %', _decision USING ERRCODE='check_violation';
  END IF;
  IF _decision IN ('reject','request_correction') THEN
    PERFORM public._p5_require_reason('p5_review_evidence',_reason_code,_note);
  END IF;

  SELECT case_id, required INTO _case_id, _required
  FROM public.p5_governance_evidence_items WHERE id=_evidence_item_id FOR UPDATE;
  IF _case_id IS NULL THEN RAISE EXCEPTION 'P5_EVIDENCE_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;

  _new_status := CASE _decision
    WHEN 'approve' THEN 'internally_ready'::public.p5_status
    WHEN 'reject' THEN 'rejected'::public.p5_status
    WHEN 'request_correction' THEN 'more_information_required'::public.p5_status
  END;

  UPDATE public.p5_governance_evidence_items
  SET status=_new_status,
      reviewed_by=_uid, reviewed_at=now(),
      rejection_reason_code = CASE WHEN _decision IN ('reject','request_correction') THEN _reason_code ELSE NULL END,
      reviewer_note=_note,
      customer_safe_note=_customer_safe_note
  WHERE id=_evidence_item_id;

  PERFORM public._p5_audit(_case_id,'review_evidence',_uid,'user',NULL,NULL,_reason_code,_note,
    _evidence_item_id,NULL,_correlation_id,NULL,
    jsonb_build_object('decision',_decision,'required',_required));
  PERFORM public._p5_recompute_case(_case_id);
END;
$$;
REVOKE ALL ON FUNCTION public.p5_review_evidence(uuid,text,public.p5_reason_code,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5_review_evidence(uuid,text,public.p5_reason_code,text,text,text) TO authenticated;
