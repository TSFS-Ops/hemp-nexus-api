
-- =========================================================================
-- P-5 Batch 8 Phase 3 — Service-role RPC write path (additive only)
-- All functions: SECURITY DEFINER, SET search_path = public,
--                REVOKE EXECUTE FROM PUBLIC, GRANT EXECUTE TO authenticated,
--                in-body role check, SSOT-aligned validation.
-- =========================================================================

-- Shared role-check helper (SECURITY DEFINER).
CREATE OR REPLACE FUNCTION public.p5b8_assert_writer_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'p5b8: unauthenticated';
  END IF;
  IF NOT (
    has_role(auth.uid(), 'platform_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_analyst'::app_role)
  ) THEN
    RAISE EXCEPTION 'p5b8: caller lacks platform_admin or compliance_analyst role';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.p5b8_assert_writer_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_assert_writer_role() TO authenticated;

-- =========================================================================
-- 1. Upsert provider config (cannot flip live_now)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_rpc_upsert_provider_config(
  _provider_category text,
  _preferred_providers jsonb,
  _fallback text,
  _required_result_type text,
  _commercial_owner text,
  _technical_contact text,
  _credential_owner text,
  _approval_owner text,
  _activation_signoff_owner text,
  _hidden_until_live boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_existed boolean;
BEGIN
  PERFORM public.p5b8_assert_writer_role();

  SELECT id INTO v_id FROM public.p5b8_provider_configs
  WHERE provider_category = _provider_category;
  v_existed := v_id IS NOT NULL;

  INSERT INTO public.p5b8_provider_configs (
    provider_category, preferred_providers, fallback, required_result_type,
    commercial_owner, technical_contact, credential_owner, approval_owner,
    activation_signoff_owner, hidden_until_live, live_now
  ) VALUES (
    _provider_category, COALESCE(_preferred_providers, '[]'::jsonb), _fallback, _required_result_type,
    _commercial_owner, _technical_contact, _credential_owner, _approval_owner,
    _activation_signoff_owner, _hidden_until_live, false
  )
  ON CONFLICT (provider_category) DO UPDATE SET
    preferred_providers = EXCLUDED.preferred_providers,
    fallback = EXCLUDED.fallback,
    required_result_type = EXCLUDED.required_result_type,
    commercial_owner = EXCLUDED.commercial_owner,
    technical_contact = EXCLUDED.technical_contact,
    credential_owner = EXCLUDED.credential_owner,
    approval_owner = EXCLUDED.approval_owner,
    activation_signoff_owner = EXCLUDED.activation_signoff_owner,
    hidden_until_live = EXCLUDED.hidden_until_live
    -- NB: live_now intentionally NOT updated here
  RETURNING id INTO v_id;

  INSERT INTO public.p5b8_audit_events (event_code, provider_category, actor_id, details)
  VALUES (
    CASE WHEN v_existed THEN 'p5b8.provider_category.configured'
         ELSE 'p5b8.provider_category.enabled' END,
    _provider_category, auth.uid(),
    jsonb_build_object('config_id', v_id)
  );
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.p5b8_rpc_upsert_provider_config(text,jsonb,text,text,text,text,text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_rpc_upsert_provider_config(text,jsonb,text,text,text,text,text,text,text,boolean) TO authenticated;

-- =========================================================================
-- 2. Record activation sign-off (flips live_now only with evidence)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_rpc_record_activation_signoff(
  _provider_config_id uuid,
  _signed_off_role text,
  _note text,
  _evidence_reference text,
  _go_live boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_signoff_id uuid;
BEGIN
  PERFORM public.p5b8_assert_writer_role();

  IF _evidence_reference IS NULL OR length(trim(_evidence_reference)) = 0 THEN
    RAISE EXCEPTION 'p5b8: activation sign-off requires evidence_reference';
  END IF;

  INSERT INTO public.p5b8_provider_activation_signoffs (
    provider_config_id, signed_off_by, signed_off_role, note, evidence_reference
  ) VALUES (
    _provider_config_id, auth.uid(), _signed_off_role, _note, _evidence_reference
  )
  RETURNING id INTO v_signoff_id;

  IF _go_live THEN
    UPDATE public.p5b8_provider_configs
       SET live_now = true,
           activation_signed_off_at = now(),
           activation_signed_off_by = auth.uid()
     WHERE id = _provider_config_id;
  END IF;

  INSERT INTO public.p5b8_audit_events (event_code, actor_id, details)
  VALUES (
    'p5b8.provider_live.activation_signed_off',
    auth.uid(),
    jsonb_build_object(
      'provider_config_id', _provider_config_id,
      'signoff_id', v_signoff_id,
      'went_live', _go_live,
      'evidence_reference', _evidence_reference
    )
  );
  RETURN v_signoff_id;
END;
$$;
REVOKE ALL ON FUNCTION public.p5b8_rpc_record_activation_signoff(uuid,text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_rpc_record_activation_signoff(uuid,text,text,text,boolean) TO authenticated;

-- =========================================================================
-- 3. Set dependency status
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_rpc_set_dependency_status(
  _provider_category text,
  _state text,
  _environment text,
  _subject_id uuid DEFAULT NULL,
  _case_id uuid DEFAULT NULL,
  _reason text DEFAULT NULL,
  _stale_as_of timestamptz DEFAULT NULL,
  _is_stale boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.p5b8_assert_writer_role();
  INSERT INTO public.p5b8_provider_dependency_status (
    provider_category, state, environment, subject_id, case_id,
    last_transition_reason, last_transition_by, stale_as_of, is_stale
  ) VALUES (
    _provider_category, _state, _environment, _subject_id, _case_id,
    _reason, auth.uid(), _stale_as_of, _is_stale
  ) RETURNING id INTO v_id;

  INSERT INTO public.p5b8_audit_events (event_code, provider_category, subject_id, case_id, actor_id, details)
  VALUES (
    'p5b8.provider_ready.status_created', _provider_category, _subject_id, _case_id, auth.uid(),
    jsonb_build_object('state', _state, 'environment', _environment, 'dependency_id', v_id)
  );
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.p5b8_rpc_set_dependency_status(text,text,text,uuid,uuid,text,timestamptz,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_rpc_set_dependency_status(text,text,text,uuid,uuid,text,timestamptz,boolean) TO authenticated;

-- =========================================================================
-- 4. Create provider request (idempotent on (category, request_reference))
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_rpc_create_provider_request(
  _provider_category text,
  _environment text,
  _request_reference text,
  _subject_id uuid DEFAULT NULL,
  _case_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.p5b8_assert_writer_role();

  IF _environment = 'live' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.p5b8_provider_configs
       WHERE provider_category = _provider_category
         AND live_now = true
         AND activation_signed_off_at IS NOT NULL
    ) THEN
      INSERT INTO public.p5b8_audit_events (event_code, provider_category, actor_id, details)
      VALUES ('p5b8.live_check.blocked_attempt', _provider_category, auth.uid(),
              jsonb_build_object('request_reference', _request_reference));
      RAISE EXCEPTION 'p5b8: live request blocked — provider not live-activated';
    END IF;
  END IF;

  INSERT INTO public.p5b8_provider_requests (
    provider_category, environment, request_reference, subject_id, case_id, requested_by
  ) VALUES (
    _provider_category, _environment, _request_reference, _subject_id, _case_id, auth.uid()
  )
  ON CONFLICT (provider_category, request_reference)
    DO UPDATE SET status = public.p5b8_provider_requests.status
  RETURNING id INTO v_id;

  INSERT INTO public.p5b8_audit_events (event_code, provider_category, subject_id, case_id, actor_id, details)
  VALUES ('p5b8.provider_request.initiated', _provider_category, _subject_id, _case_id, auth.uid(),
          jsonb_build_object('request_id', v_id, 'request_reference', _request_reference, 'environment', _environment));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.p5b8_rpc_create_provider_request(text,text,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_rpc_create_provider_request(text,text,text,uuid,uuid) TO authenticated;

-- =========================================================================
-- 5. Record provider result (raw payload stored admin-only)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_rpc_record_provider_result(
  _provider_request_id uuid,
  _provider_reference text,
  _result_status text,
  _result_summary text,
  _raw_payload jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_category text;
  v_env text;
BEGIN
  PERFORM public.p5b8_assert_writer_role();
  SELECT provider_category, environment INTO v_category, v_env
    FROM public.p5b8_provider_requests WHERE id = _provider_request_id;
  IF v_category IS NULL THEN
    RAISE EXCEPTION 'p5b8: provider_request % not found', _provider_request_id;
  END IF;

  INSERT INTO public.p5b8_provider_results (
    provider_request_id, provider_category, environment, provider_reference,
    result_status, result_summary, raw_provider_payload_admin_only
  ) VALUES (
    _provider_request_id, v_category, v_env, _provider_reference,
    _result_status, _result_summary, _raw_payload
  ) RETURNING id INTO v_id;

  UPDATE public.p5b8_provider_requests SET status = 'responded' WHERE id = _provider_request_id;

  INSERT INTO public.p5b8_audit_events (event_code, provider_category, actor_id, details)
  VALUES ('p5b8.provider_response.received', v_category, auth.uid(),
          jsonb_build_object('result_id', v_id, 'request_id', _provider_request_id, 'environment', v_env));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.p5b8_rpc_record_provider_result(uuid,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_rpc_record_provider_result(uuid,text,text,text,jsonb) TO authenticated;

-- =========================================================================
-- 6. Record provider decision
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_rpc_record_provider_decision(
  _provider_result_id uuid,
  _decision_state text,
  _reason text,
  _evidence_reference text,
  _is_fallback boolean DEFAULT false,
  _is_final boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_category text;
  v_event text;
BEGIN
  PERFORM public.p5b8_assert_writer_role();
  SELECT provider_category INTO v_category FROM public.p5b8_provider_results WHERE id = _provider_result_id;
  IF v_category IS NULL THEN
    RAISE EXCEPTION 'p5b8: provider_result % not found', _provider_result_id;
  END IF;

  IF _decision_state IN ('clear','potential_match','confirmed_match','manual_review','blocked','incomplete')
     AND (_reason IS NULL OR length(trim(_reason)) = 0) THEN
    RAISE EXCEPTION 'p5b8: decision_state % requires a reason', _decision_state;
  END IF;
  IF _decision_state IN ('false_positive','waived')
     AND (_evidence_reference IS NULL OR length(trim(_evidence_reference)) = 0) THEN
    RAISE EXCEPTION 'p5b8: decision_state % requires evidence_reference', _decision_state;
  END IF;

  INSERT INTO public.p5b8_provider_decisions (
    provider_result_id, provider_category, decision_state, set_by, reason,
    evidence_reference, is_fallback, is_final
  ) VALUES (
    _provider_result_id, v_category, _decision_state, auth.uid(), _reason,
    _evidence_reference, _is_fallback, _is_final
  ) RETURNING id INTO v_id;

  v_event := CASE _decision_state
    WHEN 'waived' THEN 'p5b8.provider_decision.waiver'
    WHEN 'false_positive' THEN 'p5b8.provider_decision.false_positive'
    WHEN 'blocked' THEN 'p5b8.provider_decision.blocked'
    ELSE CASE WHEN _is_fallback THEN 'p5b8.provider_decision.fallback'
              ELSE 'p5b8.provider_decision.manual_set' END
  END;

  INSERT INTO public.p5b8_audit_events (event_code, provider_category, actor_id, details)
  VALUES (v_event, v_category, auth.uid(),
          jsonb_build_object('decision_id', v_id, 'result_id', _provider_result_id,
                             'state', _decision_state, 'is_fallback', _is_fallback, 'is_final', _is_final));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.p5b8_rpc_record_provider_decision(uuid,text,text,text,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_rpc_record_provider_decision(uuid,text,text,text,boolean,boolean) TO authenticated;

-- =========================================================================
-- 7. Record webhook event (append-only, idempotent)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_rpc_record_webhook_event(
  _provider_category text,
  _webhook_event text,
  _environment text,
  _idempotency_key text,
  _signature_status text,
  _raw_payload jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.p5b8_assert_writer_role();

  INSERT INTO public.p5b8_webhook_events_ledger (
    provider_category, webhook_event, environment, idempotency_key,
    signature_status, raw_webhook_payload_admin_only
  ) VALUES (
    _provider_category, _webhook_event, _environment, _idempotency_key,
    _signature_status, _raw_payload
  )
  ON CONFLICT (provider_category, idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO public.p5b8_audit_events (event_code, provider_category, actor_id, details)
    VALUES ('p5b8.webhook.duplicate_ignored', _provider_category, auth.uid(),
            jsonb_build_object('idempotency_key', _idempotency_key, 'event', _webhook_event));
    RETURN NULL;
  END IF;

  INSERT INTO public.p5b8_audit_events (event_code, provider_category, actor_id, details)
  VALUES (
    CASE
      WHEN _webhook_event = 'webhook.test' THEN 'p5b8.webhook.test_received'
      WHEN _signature_status = 'failed' THEN 'p5b8.webhook.signature_failed'
      ELSE 'p5b8.webhook.received'
    END,
    _provider_category, auth.uid(),
    jsonb_build_object('ledger_id', v_id, 'event', _webhook_event, 'environment', _environment)
  );
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.p5b8_rpc_record_webhook_event(text,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_rpc_record_webhook_event(text,text,text,text,text,jsonb) TO authenticated;

-- =========================================================================
-- 8. Append audit event
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_rpc_append_audit_event(
  _event_code text,
  _provider_category text DEFAULT NULL,
  _subject_id uuid DEFAULT NULL,
  _case_id uuid DEFAULT NULL,
  _details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.p5b8_assert_writer_role();
  INSERT INTO public.p5b8_audit_events (event_code, provider_category, subject_id, case_id, actor_id, details)
  VALUES (_event_code, _provider_category, _subject_id, _case_id, auth.uid(), COALESCE(_details, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.p5b8_rpc_append_audit_event(text,text,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_rpc_append_audit_event(text,text,uuid,uuid,jsonb) TO authenticated;

-- =========================================================================
-- 9. Record retry / failure / fallback state
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_rpc_record_retry_state(
  _provider_request_id uuid,
  _last_error_class text,
  _next_retry_at timestamptz,
  _fallback_route text,
  _exhausted boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_attempts integer;
  v_category text;
BEGIN
  PERFORM public.p5b8_assert_writer_role();
  SELECT provider_category INTO v_category FROM public.p5b8_provider_requests WHERE id = _provider_request_id;
  IF v_category IS NULL THEN
    RAISE EXCEPTION 'p5b8: provider_request % not found', _provider_request_id;
  END IF;

  INSERT INTO public.p5b8_provider_retry_state (
    provider_request_id, attempt_count, last_error_class, last_attempted_at,
    next_retry_at, fallback_route, exhausted
  ) VALUES (
    _provider_request_id, 1, _last_error_class, now(),
    _next_retry_at, _fallback_route, _exhausted
  )
  ON CONFLICT (provider_request_id) DO UPDATE SET
    attempt_count = public.p5b8_provider_retry_state.attempt_count + 1,
    last_error_class = EXCLUDED.last_error_class,
    last_attempted_at = now(),
    next_retry_at = EXCLUDED.next_retry_at,
    fallback_route = EXCLUDED.fallback_route,
    exhausted = EXCLUDED.exhausted
  RETURNING id, attempt_count INTO v_id, v_attempts;

  INSERT INTO public.p5b8_audit_events (event_code, provider_category, actor_id, details)
  VALUES (
    CASE WHEN _exhausted THEN 'p5b8.provider.retry_exhausted'
         WHEN _last_error_class = 'timeout' THEN 'p5b8.provider.timeout'
         ELSE 'p5b8.provider.retry_attempted' END,
    v_category, auth.uid(),
    jsonb_build_object('request_id', _provider_request_id, 'attempts', v_attempts,
                       'last_error_class', _last_error_class, 'exhausted', _exhausted)
  );
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.p5b8_rpc_record_retry_state(uuid,text,timestamptz,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_rpc_record_retry_state(uuid,text,timestamptz,text,boolean) TO authenticated;

-- retry_state needs a unique key on provider_request_id for ON CONFLICT
ALTER TABLE public.p5b8_provider_retry_state
  ADD CONSTRAINT p5b8_rs_request_unique UNIQUE (provider_request_id);

-- =========================================================================
-- 10. Create Memory/finality link (link-only; never mutates Batch 5 tables)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.p5b8_rpc_create_memory_finality_link(
  _provider_decision_id uuid,
  _link_type text,
  _memory_record_id uuid DEFAULT NULL,
  _finality_record_id uuid DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_state text;
  v_eligible boolean;
BEGIN
  PERFORM public.p5b8_assert_writer_role();

  SELECT decision_state INTO v_state FROM public.p5b8_provider_decisions WHERE id = _provider_decision_id;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'p5b8: provider_decision % not found', _provider_decision_id;
  END IF;
  v_eligible := v_state IN ('clear','confirmed_match','false_positive','waived','blocked');

  IF _link_type = 'memory_reference' AND NOT v_eligible THEN
    INSERT INTO public.p5b8_audit_events (event_code, actor_id, details)
    VALUES ('p5b8.memory.provider_write_blocked', auth.uid(),
            jsonb_build_object('decision_id', _provider_decision_id, 'state', v_state));
    RAISE EXCEPTION 'p5b8: decision_state % is not Memory-eligible', v_state;
  END IF;

  INSERT INTO public.p5b8_memory_finality_links (
    provider_decision_id, link_type, memory_record_id, finality_record_id, note
  ) VALUES (
    _provider_decision_id, _link_type, _memory_record_id, _finality_record_id, _note
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.p5b8_rpc_create_memory_finality_link(uuid,text,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b8_rpc_create_memory_finality_link(uuid,text,uuid,uuid,text) TO authenticated;
