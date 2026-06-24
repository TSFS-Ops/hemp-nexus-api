
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

  -- Caller-supplied initial status is authoritative on create; subsequent
  -- actions trigger the recomputation. Skipping recompute here avoids
  -- jumping to internally_ready when no evidence rows exist yet.
  RETURN _id;
END;
$$;
