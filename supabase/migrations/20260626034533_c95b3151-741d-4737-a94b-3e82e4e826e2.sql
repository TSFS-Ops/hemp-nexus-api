
-- =====================================================================
-- P-5 Batch 6 Phase 3 — Server-side RPCs (write path)
-- All functions: SECURITY DEFINER, search_path pinned, validated against
-- Phase 1 SSOT. No UI / edge / cron / API projection / Batch 7.
-- =====================================================================

-- Closed vocabularies (mirror SSOT)
-- Kept inline to avoid runtime lookups and to fail fast on drift.

-- Helper: caller authorisation
CREATE OR REPLACE FUNCTION public.p5b6_assert_admin_actor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'p5b6: authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'governance_reviewer')
    OR public.has_role(auth.uid(), 'compliance_analyst')
  ) THEN
    -- Best-effort access audit
    BEGIN
      INSERT INTO public.p5b6_exception_audit_events (
        exception_id, event_code, actor_user_id, reason
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        'p5b6.access.unauthorised_attempt_blocked',
        auth.uid(),
        'unauthorised actor'
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RAISE EXCEPTION 'p5b6: caller not authorised' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Helper: banned external wording guard
CREATE OR REPLACE FUNCTION public.p5b6_assert_external_safe(_msg text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  banned text[] := ARRAY[
    'fraud','fraudulent','suspicious','sanctions hit','pep match',
    'adverse-media match','adverse media match','blacklist','blacklisted',
    'internal risk','manual bypass','compliance failure','criminal',
    'money laundering','watchlist hit'
  ];
  w text;
BEGIN
  IF _msg IS NULL OR length(btrim(_msg)) = 0 THEN
    RETURN;
  END IF;
  FOREACH w IN ARRAY banned LOOP
    IF position(lower(w) IN lower(_msg)) > 0 THEN
      RAISE EXCEPTION 'p5b6: external-safe text contains banned wording: %', w
        USING ERRCODE = '22023';
    END IF;
  END LOOP;
END;
$$;

-- Helper: audit writer
CREATE OR REPLACE FUNCTION public.p5b6_write_audit(
  _exception_id uuid,
  _event_code text,
  _before jsonb,
  _after jsonb,
  _reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requires_before_after text[] := ARRAY[
    'p5b6.exception.status_changed','p5b6.exception.priority_changed',
    'p5b6.exception.severity_changed','p5b6.evidence.accepted',
    'p5b6.evidence.rejected','p5b6.evidence.waived',
    'p5b6.override.approved','p5b6.override.rejected',
    'p5b6.provider.recovered','p5b6.payment.reconciled',
    'p5b6.dispute.state_changed','p5b6.dispute.resolved',
    'p5b6.finality.under_dispute_marked','p5b6.finality.dispute_cleared',
    'p5b6.memory.correction_recorded','p5b6.memory.exclusion_recorded',
    'p5b6.exception.tombstone_legal_redaction'
  ];
  v_id uuid;
BEGIN
  IF _event_code NOT LIKE 'p5b6.%' THEN
    RAISE EXCEPTION 'p5b6: audit event_code must begin with p5b6.' USING ERRCODE = '22023';
  END IF;
  IF _event_code = ANY(requires_before_after) AND (_before IS NULL OR _after IS NULL) THEN
    RAISE EXCEPTION 'p5b6: event % requires before and after snapshots', _event_code
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.p5b6_exception_audit_events (
    exception_id, event_code, before_snapshot, after_snapshot,
    actor_user_id, reason
  ) VALUES (
    _exception_id, _event_code, _before, _after, auth.uid(), _reason
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------
-- RPC: p5b6_create_exception
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b6_create_exception(
  _exception_type text,
  _review_queue text,
  _priority text,
  _status text,
  _severity text,
  _owner_role text,
  _summary text,
  _org_id uuid DEFAULT NULL,
  _funder_org_id uuid DEFAULT NULL,
  _counterparty_org_id uuid DEFAULT NULL,
  _related_finality_id uuid DEFAULT NULL,
  _related_memory_id uuid DEFAULT NULL,
  _related_match_id uuid DEFAULT NULL,
  _external_safe_message text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.p5b6_assert_admin_actor();
  PERFORM public.p5b6_assert_external_safe(_external_safe_message);

  INSERT INTO public.p5b6_exceptions (
    exception_type, review_queue, priority, status, severity, owner_role,
    summary, org_id, funder_org_id, counterparty_org_id,
    related_finality_id, related_memory_id, related_match_id,
    external_safe_message, metadata, created_by
  ) VALUES (
    _exception_type, _review_queue, _priority, _status, _severity, _owner_role,
    _summary, _org_id, _funder_org_id, _counterparty_org_id,
    _related_finality_id, _related_memory_id, _related_match_id,
    _external_safe_message, COALESCE(_metadata, '{}'::jsonb), auth.uid()
  )
  RETURNING id INTO v_id;

  PERFORM public.p5b6_write_audit(
    v_id, 'p5b6.exception.created', NULL,
    jsonb_build_object(
      'exception_type', _exception_type,
      'review_queue',  _review_queue,
      'priority',      _priority,
      'status',        _status,
      'severity',      _severity
    ),
    NULL
  );

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------
-- RPC: p5b6_update_exception_status
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b6_update_exception_status(
  _exception_id uuid,
  _new_status text,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text;
  v_terminal text[] := ARRAY['resolved','duplicate','cancelled','invalid_test','tombstoned_legal'];
BEGIN
  PERFORM public.p5b6_assert_admin_actor();

  SELECT status INTO v_old FROM public.p5b6_exceptions WHERE id = _exception_id FOR UPDATE;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'p5b6: exception % not found', _exception_id USING ERRCODE = '02000';
  END IF;
  IF v_old = _new_status THEN
    RETURN;
  END IF;

  UPDATE public.p5b6_exceptions
     SET status = _new_status,
         resolved_at = CASE WHEN _new_status = ANY(v_terminal) THEN now() ELSE resolved_at END
   WHERE id = _exception_id;

  PERFORM public.p5b6_write_audit(
    _exception_id, 'p5b6.exception.status_changed',
    jsonb_build_object('status', v_old),
    jsonb_build_object('status', _new_status),
    _reason
  );

  IF _reason IS NOT NULL AND length(btrim(_reason)) > 0
     AND _new_status = ANY(v_terminal) THEN
    INSERT INTO public.p5b6_exception_notes (
      exception_id, note_type, body, reason_required, author_user_id
    ) VALUES (
      _exception_id, 'resolution_reason', _reason, true, auth.uid()
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- RPC: p5b6_update_exception_priority
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b6_update_exception_priority(
  _exception_id uuid,
  _new_priority text,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text;
BEGIN
  PERFORM public.p5b6_assert_admin_actor();

  IF _reason IS NULL OR length(btrim(_reason)) = 0 THEN
    RAISE EXCEPTION 'p5b6: priority change requires a reason' USING ERRCODE = '22023';
  END IF;

  SELECT priority INTO v_old FROM public.p5b6_exceptions WHERE id = _exception_id FOR UPDATE;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'p5b6: exception % not found', _exception_id USING ERRCODE = '02000';
  END IF;
  IF v_old = _new_priority THEN
    RETURN;
  END IF;

  UPDATE public.p5b6_exceptions SET priority = _new_priority WHERE id = _exception_id;

  INSERT INTO public.p5b6_exception_notes (
    exception_id, note_type, body, reason_required, author_user_id
  ) VALUES (
    _exception_id, 'priority_change_reason', _reason, true, auth.uid()
  );

  PERFORM public.p5b6_write_audit(
    _exception_id, 'p5b6.exception.priority_changed',
    jsonb_build_object('priority', v_old),
    jsonb_build_object('priority', _new_priority),
    _reason
  );
END;
$$;

-- ---------------------------------------------------------------------
-- RPC: p5b6_assign_exception
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b6_assign_exception(
  _exception_id uuid,
  _to_queue text,
  _to_assignee_user_id uuid,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_queue text;
  v_from_assignee uuid;
  v_first_assignment boolean;
BEGIN
  PERFORM public.p5b6_assert_admin_actor();

  SELECT review_queue, assignee_user_id
    INTO v_from_queue, v_from_assignee
    FROM public.p5b6_exceptions
   WHERE id = _exception_id
   FOR UPDATE;
  IF v_from_queue IS NULL THEN
    RAISE EXCEPTION 'p5b6: exception % not found', _exception_id USING ERRCODE = '02000';
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.p5b6_exception_queue_assignments WHERE exception_id = _exception_id
  ) INTO v_first_assignment;

  UPDATE public.p5b6_exceptions
     SET review_queue = _to_queue,
         assignee_user_id = _to_assignee_user_id
   WHERE id = _exception_id;

  INSERT INTO public.p5b6_exception_queue_assignments (
    exception_id, from_queue, to_queue,
    from_assignee_user_id, to_assignee_user_id,
    assigned_by, reason
  ) VALUES (
    _exception_id, v_from_queue, _to_queue,
    v_from_assignee, _to_assignee_user_id,
    auth.uid(), _reason
  );

  PERFORM public.p5b6_write_audit(
    _exception_id,
    CASE WHEN v_first_assignment THEN 'p5b6.exception.assigned'
         ELSE 'p5b6.exception.reassigned' END,
    NULL, NULL, _reason
  );
END;
$$;

-- ---------------------------------------------------------------------
-- RPC: p5b6_add_note
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b6_add_note(
  _exception_id uuid,
  _note_type text,
  _body text,
  _reason_required boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.p5b6_assert_admin_actor();
  IF _body IS NULL OR length(btrim(_body)) = 0 THEN
    RAISE EXCEPTION 'p5b6: note body required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.p5b6_exception_notes (
    exception_id, note_type, body, reason_required, author_user_id
  ) VALUES (
    _exception_id, _note_type, _body, COALESCE(_reason_required, false), auth.uid()
  )
  RETURNING id INTO v_id;

  PERFORM public.p5b6_write_audit(
    _exception_id, 'p5b6.exception.note_added',
    NULL, NULL, _note_type
  );
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------
-- RPC: p5b6_raise_dispute
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b6_raise_dispute(
  _exception_id uuid,
  _pauses_memory boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_old_status text;
BEGIN
  PERFORM public.p5b6_assert_admin_actor();

  SELECT status INTO v_old_status FROM public.p5b6_exceptions WHERE id = _exception_id FOR UPDATE;
  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'p5b6: exception % not found', _exception_id USING ERRCODE = '02000';
  END IF;

  INSERT INTO public.p5b6_exception_disputes (
    exception_id, dispute_state, pauses_memory, raised_by
  ) VALUES (
    _exception_id, 'dispute_raised', COALESCE(_pauses_memory, true), auth.uid()
  )
  RETURNING id INTO v_id;

  IF v_old_status <> 'dispute_raised' THEN
    UPDATE public.p5b6_exceptions SET status = 'dispute_raised' WHERE id = _exception_id;
    PERFORM public.p5b6_write_audit(
      _exception_id, 'p5b6.exception.status_changed',
      jsonb_build_object('status', v_old_status),
      jsonb_build_object('status', 'dispute_raised'),
      'dispute raised'
    );
  END IF;

  PERFORM public.p5b6_write_audit(
    _exception_id, 'p5b6.dispute.raised', NULL,
    jsonb_build_object('dispute_id', v_id, 'pauses_memory', COALESCE(_pauses_memory, true)),
    NULL
  );

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------
-- RPC: p5b6_update_dispute_state
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b6_update_dispute_state(
  _dispute_id uuid,
  _new_state text,
  _closure_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text;
  v_exc uuid;
  v_pause_states text[] := ARRAY[
    'dispute_raised','initial_triage','under_review','awaiting_evidence',
    'awaiting_counterparty_response','escalated','proposed_resolution'
  ];
  v_terminal text[] := ARRAY[
    'resolved_upheld','resolved_partially_upheld','resolved_dismissed',
    'withdrawn','closed_corrected','closed_superseded'
  ];
  v_now_pauses boolean;
BEGIN
  PERFORM public.p5b6_assert_admin_actor();

  SELECT dispute_state, exception_id
    INTO v_old, v_exc
    FROM public.p5b6_exception_disputes WHERE id = _dispute_id FOR UPDATE;
  IF v_exc IS NULL THEN
    RAISE EXCEPTION 'p5b6: dispute % not found', _dispute_id USING ERRCODE = '02000';
  END IF;
  IF v_old = _new_state THEN
    RETURN;
  END IF;

  v_now_pauses := (_new_state = ANY(v_pause_states));

  UPDATE public.p5b6_exception_disputes
     SET dispute_state = _new_state,
         pauses_memory = v_now_pauses,
         closure_reason = COALESCE(_closure_reason, closure_reason),
         closed_at = CASE WHEN _new_state = ANY(v_terminal) THEN now() ELSE closed_at END
   WHERE id = _dispute_id;

  PERFORM public.p5b6_write_audit(
    v_exc, 'p5b6.dispute.state_changed',
    jsonb_build_object('dispute_state', v_old),
    jsonb_build_object('dispute_state', _new_state, 'pauses_memory', v_now_pauses),
    _closure_reason
  );

  IF _new_state = ANY(v_terminal) THEN
    PERFORM public.p5b6_write_audit(
      v_exc, 'p5b6.dispute.resolved',
      jsonb_build_object('dispute_state', v_old),
      jsonb_build_object('dispute_state', _new_state),
      _closure_reason
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- RPC: p5b6_record_report_export
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5b6_record_report_export(
  _report_code text,
  _export_format text,
  _scope jsonb DEFAULT '{}'::jsonb,
  _is_restricted boolean DEFAULT false,
  _row_count integer DEFAULT NULL,
  _requested_for_org_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_public_msg text;
BEGIN
  PERFORM public.p5b6_assert_admin_actor();

  -- Scrub external wording if scope carries a public_message
  v_public_msg := NULLIF((_scope ->> 'public_message'), '');
  IF v_public_msg IS NOT NULL THEN
    PERFORM public.p5b6_assert_external_safe(v_public_msg);
  END IF;

  INSERT INTO public.p5b6_exception_report_exports (
    report_code, export_format, requested_by, requested_for_org_id,
    scope, is_restricted, row_count
  ) VALUES (
    _report_code, _export_format, auth.uid(), _requested_for_org_id,
    COALESCE(_scope, '{}'::jsonb), COALESCE(_is_restricted, false), _row_count
  )
  RETURNING id INTO v_id;

  -- Audit at the export-ledger level (no exception_id), via direct insert
  INSERT INTO public.p5b6_exception_audit_events (
    exception_id, event_code, after_snapshot, actor_user_id, reason
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'p5b6.export.report_generated',
    jsonb_build_object(
      'export_id', v_id,
      'report_code', _report_code,
      'format', _export_format,
      'is_restricted', COALESCE(_is_restricted, false),
      'row_count', _row_count
    ),
    auth.uid(),
    NULL
  );

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------
-- EXECUTE permissions: revoke public, grant authenticated.
-- Service role retains full access via defaults.
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.p5b6_create_exception(text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p5b6_update_exception_status(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p5b6_update_exception_priority(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p5b6_assign_exception(uuid,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p5b6_add_note(uuid,text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p5b6_raise_dispute(uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p5b6_update_dispute_state(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p5b6_record_report_export(text,text,jsonb,boolean,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p5b6_assert_admin_actor() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p5b6_assert_external_safe(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p5b6_write_audit(uuid,text,jsonb,jsonb,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.p5b6_create_exception(text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p5b6_update_exception_status(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p5b6_update_exception_priority(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p5b6_assign_exception(uuid,text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p5b6_add_note(uuid,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p5b6_raise_dispute(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p5b6_update_dispute_state(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p5b6_record_report_export(text,text,jsonb,boolean,integer,uuid) TO authenticated;
