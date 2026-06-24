
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
  _unstarted int := 0;
  _submitted_unreviewed int := 0;
  _expired int := 0;
  _rejected int := 0;
  _has_required_provider boolean := false;
  _provider_failed boolean := false;
BEGIN
  SELECT * INTO c FROM public.p5_governance_readiness_cases WHERE id = _case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P5_CASE_NOT_FOUND: %', _case_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT
    count(*) FILTER (WHERE ev.required AND ev.status IN ('not_started','incomplete')),
    count(*) FILTER (WHERE ev.required AND ev.status = 'submitted'),
    count(*) FILTER (WHERE ev.required AND ev.status = 'rejected'),
    count(*) FILTER (WHERE ev.required AND ev.expiry_date IS NOT NULL AND ev.expiry_date <= current_date)
  INTO _unstarted, _submitted_unreviewed, _rejected, _expired
  FROM public.p5_governance_evidence_items ev
  WHERE ev.case_id = _case_id;

  _has_required_provider := c.provider_dependency;
  IF _has_required_provider AND c.provider_status IS NOT NULL THEN
    _provider_failed := c.provider_status = 'failed';
  END IF;

  blocker_count := (CASE WHEN _rejected > 0 THEN 1 ELSE 0 END)
                 + (CASE WHEN _provider_failed THEN 1 ELSE 0 END)
                 + (CASE WHEN c.is_on_hold THEN 1 ELSE 0 END);
  warning_count := 0;
  provider_dependency := _has_required_provider;
  required_items_missing := _unstarted + _expired + _submitted_unreviewed;

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
  IF _unstarted > 0 THEN
    status := 'incomplete'; reason := 'missing_evidence'; RETURN NEXT; RETURN;
  END IF;
  IF c.governance_status = 'more_information_required'
     OR c.compliance_status = 'more_information_required'
     OR c.readiness_status = 'more_information_required' THEN
    status := 'more_information_required'; reason := 'manual_review_required'; RETURN NEXT; RETURN;
  END IF;
  IF _submitted_unreviewed > 0 THEN
    status := 'submitted'; reason := 'manual_review_required'; RETURN NEXT; RETURN;
  END IF;
  IF c.governance_status IN ('not_started','submitted','under_review') THEN
    status := 'under_review'; reason := 'manual_review_required'; RETURN NEXT; RETURN;
  END IF;
  IF _has_required_provider AND _provider_failed THEN
    status := 'blocked'; reason := 'provider_failed'; RETURN NEXT; RETURN;
  END IF;
  IF _has_required_provider AND c.provider_status = 'not_live' THEN
    status := 'provider_dependent'; reason := 'provider_not_live'; RETURN NEXT; RETURN;
  END IF;
  IF _has_required_provider AND c.provider_status = 'credentials_pending' THEN
    status := 'provider_dependent'; reason := 'provider_credentials_pending'; RETURN NEXT; RETURN;
  END IF;
  IF _has_required_provider AND c.provider_status = 'timeout' THEN
    status := 'provider_dependent'; reason := 'provider_timeout'; RETURN NEXT; RETURN;
  END IF;
  IF _has_required_provider AND c.provider_status = 'inconclusive' THEN
    status := 'provider_dependent'; reason := 'provider_inconclusive'; RETURN NEXT; RETURN;
  END IF;
  IF _has_required_provider AND c.provider_status = 'pending' THEN
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
