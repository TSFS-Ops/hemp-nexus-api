
-- ============================================================================
-- P-5 Screening & IDV — Phase 3 RPC check engine
-- Service-role / platform_admin write path. Append-only contracts intact.
-- ============================================================================

-- Deterministic uniqueness: one open manual review per (subject, category) ---
CREATE UNIQUE INDEX IF NOT EXISTS p5scr_manual_reviews_one_open
  ON public.p5scr_manual_reviews(subject_id, category)
  WHERE decided_at IS NULL;

-- Shared role guard helper (inline check in each RPC) ------------------------

-- 1) Upsert subject ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5scr_upsert_subject(
  p_party_role text,
  p_organisation_id uuid DEFAULT NULL,
  p_person_external_ref text DEFAULT NULL,
  p_display_label text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin') THEN
    RAISE EXCEPTION 'p5scr: platform_admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.p5scr_subjects(party_role, organisation_id, person_external_ref, display_label)
    VALUES (p_party_role, p_organisation_id, p_person_external_ref, p_display_label)
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.p5scr_upsert_subject(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5scr_upsert_subject(text, uuid, text, text) TO authenticated;

-- 2) Request check (transition to *_pending and audit) -----------------------
CREATE OR REPLACE FUNCTION public.p5scr_request_check(
  p_subject_id uuid,
  p_category text,
  p_pending_state text DEFAULT 'screening_pending'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin') THEN
    RAISE EXCEPTION 'p5scr: platform_admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_pending_state NOT IN ('screening_pending','idv_pending','provider_pending') THEN
    RAISE EXCEPTION 'p5scr: invalid pending state %', p_pending_state;
  END IF;
  INSERT INTO public.p5scr_check_state(subject_id, category, state)
    VALUES (p_subject_id, p_category, p_pending_state)
    ON CONFLICT (subject_id, category) DO UPDATE
      SET state = EXCLUDED.state, updated_at = now();
  INSERT INTO public.p5scr_audit_events(event, subject_id, category, actor_user_id)
    VALUES ('p5_screening.check_requested', p_subject_id, p_category, auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.p5scr_request_check(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5scr_request_check(uuid, text, text) TO authenticated;

-- 3) Record provider-pending -------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5scr_record_provider_pending(
  p_subject_id uuid,
  p_category text,
  p_provider_ref text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin') THEN
    RAISE EXCEPTION 'p5scr: platform_admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.p5scr_check_state(subject_id, category, state)
    VALUES (p_subject_id, p_category, 'provider_pending')
    ON CONFLICT (subject_id, category) DO UPDATE
      SET state = 'provider_pending', updated_at = now();
  INSERT INTO public.p5scr_audit_events(event, subject_id, category, actor_user_id, payload_admin_only)
    VALUES ('p5_screening.provider_pending_recorded', p_subject_id, p_category, auth.uid(),
            jsonb_build_object('provider_ref', p_provider_ref));
END $$;
REVOKE ALL ON FUNCTION public.p5scr_record_provider_pending(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5scr_record_provider_pending(uuid, text, text) TO authenticated;

-- 4) Record check result (append-only result + update state) -----------------
CREATE OR REPLACE FUNCTION public.p5scr_record_result(
  p_subject_id uuid,
  p_category text,
  p_state text,
  p_source text,
  p_provider_ref text DEFAULT NULL,
  p_provider_live_now boolean DEFAULT false,
  p_activation_signed_off_at timestamptz DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL,
  p_raw_provider_payload_admin_only jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin') THEN
    RAISE EXCEPTION 'p5scr: platform_admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.p5scr_check_results(
    subject_id, category, state, source, provider_ref,
    provider_live_now, activation_signed_off_at,
    decided_at, expires_at, raw_provider_payload_admin_only, recorded_by)
  VALUES (
    p_subject_id, p_category, p_state, p_source, p_provider_ref,
    p_provider_live_now, p_activation_signed_off_at,
    now(), p_expires_at, p_raw_provider_payload_admin_only, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.p5scr_check_state(subject_id, category, state, last_result_id, decided_at, expires_at)
    VALUES (p_subject_id, p_category, p_state, v_id, now(), p_expires_at)
    ON CONFLICT (subject_id, category) DO UPDATE
      SET state = EXCLUDED.state,
          last_result_id = EXCLUDED.last_result_id,
          decided_at = EXCLUDED.decided_at,
          expires_at = EXCLUDED.expires_at,
          updated_at = now();

  INSERT INTO public.p5scr_audit_events(event, subject_id, category, actor_user_id, payload_admin_only)
    VALUES ('p5_screening.result_recorded', p_subject_id, p_category, auth.uid(),
            jsonb_build_object('result_id', v_id, 'state', p_state, 'source', p_source));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.p5scr_record_result(uuid, text, text, text, text, boolean, timestamptz, timestamptz, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5scr_record_result(uuid, text, text, text, text, boolean, timestamptz, timestamptz, jsonb) TO authenticated;

-- 5) Reuse prior result ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5scr_reuse_result(
  p_subject_id uuid,
  p_category text,
  p_source_result_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_src public.p5scr_check_results%ROWTYPE; v_new uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin') THEN
    RAISE EXCEPTION 'p5scr: platform_admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_src FROM public.p5scr_check_results WHERE id = p_source_result_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'p5scr: source result not found'; END IF;
  IF v_src.decided_at < now() - INTERVAL '90 days' THEN
    RAISE EXCEPTION 'p5scr: source result outside 90-day reuse window';
  END IF;

  INSERT INTO public.p5scr_check_results(
    subject_id, category, state, source, provider_ref,
    provider_live_now, activation_signed_off_at,
    decided_at, expires_at, raw_provider_payload_admin_only, recorded_by)
  VALUES (
    p_subject_id, p_category, v_src.state, 'admin_reuse', v_src.provider_ref,
    false, NULL,
    now(), v_src.expires_at, NULL, auth.uid())
  RETURNING id INTO v_new;

  INSERT INTO public.p5scr_check_state(subject_id, category, state, last_result_id, decided_at, expires_at)
    VALUES (p_subject_id, p_category, v_src.state, v_new, now(), v_src.expires_at)
    ON CONFLICT (subject_id, category) DO UPDATE
      SET state = EXCLUDED.state, last_result_id = EXCLUDED.last_result_id,
          decided_at = EXCLUDED.decided_at, expires_at = EXCLUDED.expires_at,
          updated_at = now();

  INSERT INTO public.p5scr_audit_events(event, subject_id, category, actor_user_id, payload_admin_only)
    VALUES ('p5_screening.result_reused', p_subject_id, p_category, auth.uid(),
            jsonb_build_object('source_result_id', p_source_result_id, 'new_result_id', v_new));
  RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION public.p5scr_reuse_result(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5scr_reuse_result(uuid, text, uuid) TO authenticated;

-- 6) Open manual review ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5scr_open_manual_review(
  p_subject_id uuid,
  p_category text,
  p_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin') THEN
    RAISE EXCEPTION 'p5scr: platform_admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.p5scr_manual_reviews(subject_id, category, opened_by, reason)
    VALUES (p_subject_id, p_category, auth.uid(), p_reason) RETURNING id INTO v_id;
  INSERT INTO public.p5scr_check_state(subject_id, category, state)
    VALUES (p_subject_id, p_category, 'manual_review_required')
    ON CONFLICT (subject_id, category) DO UPDATE
      SET state = 'manual_review_required', updated_at = now();
  INSERT INTO public.p5scr_audit_events(event, subject_id, category, actor_user_id, payload_admin_only)
    VALUES ('p5_screening.manual_review_opened', p_subject_id, p_category, auth.uid(),
            jsonb_build_object('review_id', v_id));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.p5scr_open_manual_review(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5scr_open_manual_review(uuid, text, text) TO authenticated;

-- 7) Decide manual review ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5scr_decide_manual_review(
  p_review_id uuid,
  p_decision text,
  p_notes_admin_only text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_subject uuid; v_category text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin') THEN
    RAISE EXCEPTION 'p5scr: platform_admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_decision NOT IN ('cleared','cleared_with_conditions','failed','rejected') THEN
    RAISE EXCEPTION 'p5scr: invalid decision %', p_decision;
  END IF;
  UPDATE public.p5scr_manual_reviews
     SET decided_at = now(), decided_by = auth.uid(),
         decision = p_decision, notes_admin_only = p_notes_admin_only,
         updated_at = now()
   WHERE id = p_review_id AND decided_at IS NULL
   RETURNING subject_id, category INTO v_subject, v_category;
  IF NOT FOUND THEN RAISE EXCEPTION 'p5scr: review not found or already decided'; END IF;

  INSERT INTO public.p5scr_check_state(subject_id, category, state, decided_at)
    VALUES (v_subject, v_category, p_decision, now())
    ON CONFLICT (subject_id, category) DO UPDATE
      SET state = EXCLUDED.state, decided_at = EXCLUDED.decided_at, updated_at = now();

  INSERT INTO public.p5scr_audit_events(event, subject_id, category, actor_user_id, payload_admin_only)
    VALUES ('p5_screening.manual_review_decided', v_subject, v_category, auth.uid(),
            jsonb_build_object('review_id', p_review_id, 'decision', p_decision));
END $$;
REVOKE ALL ON FUNCTION public.p5scr_decide_manual_review(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5scr_decide_manual_review(uuid, text, text) TO authenticated;

-- 8) Record IDV --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5scr_record_idv(
  p_subject_id uuid,
  p_state text,
  p_provider_ref text DEFAULT NULL,
  p_provider_live_now boolean DEFAULT false,
  p_activation_signed_off_at timestamptz DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL,
  p_raw_provider_payload_admin_only jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_event text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin') THEN
    RAISE EXCEPTION 'p5scr: platform_admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.p5scr_idv_records(
    subject_id, state, provider_ref,
    provider_live_now, activation_signed_off_at,
    decided_at, expires_at, raw_provider_payload_admin_only, recorded_by)
  VALUES (
    p_subject_id, p_state, p_provider_ref,
    p_provider_live_now, p_activation_signed_off_at,
    now(), p_expires_at, p_raw_provider_payload_admin_only, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.p5scr_check_state(subject_id, category, state, decided_at, expires_at)
    VALUES (p_subject_id, 'idv_person', p_state, now(), p_expires_at)
    ON CONFLICT (subject_id, category) DO UPDATE
      SET state = EXCLUDED.state, decided_at = EXCLUDED.decided_at,
          expires_at = EXCLUDED.expires_at, updated_at = now();

  v_event := CASE
    WHEN p_state IN ('cleared','cleared_with_conditions') THEN 'p5_screening.idv_completed'
    WHEN p_state IN ('failed','rejected') THEN 'p5_screening.idv_failed'
    ELSE 'p5_screening.idv_required'
  END;
  INSERT INTO public.p5scr_audit_events(event, subject_id, category, actor_user_id, payload_admin_only)
    VALUES (v_event, p_subject_id, 'idv_person', auth.uid(),
            jsonb_build_object('idv_record_id', v_id, 'state', p_state));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.p5scr_record_idv(uuid, text, text, boolean, timestamptz, timestamptz, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5scr_record_idv(uuid, text, text, boolean, timestamptz, timestamptz, jsonb) TO authenticated;

-- 9) Invalidate prior screening ---------------------------------------------
CREATE OR REPLACE FUNCTION public.p5scr_invalidate(
  p_subject_id uuid,
  p_trigger text,
  p_category text DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin') THEN
    RAISE EXCEPTION 'p5scr: platform_admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.p5scr_invalidations(subject_id, category, trigger, reason, created_by)
    VALUES (p_subject_id, p_category, p_trigger, p_reason, auth.uid())
    RETURNING id INTO v_id;
  IF p_category IS NOT NULL THEN
    UPDATE public.p5scr_check_state
       SET state = 'screening_expired',
           active_invalidation_triggers =
             ARRAY(SELECT DISTINCT unnest(active_invalidation_triggers || ARRAY[p_trigger])),
           updated_at = now()
     WHERE subject_id = p_subject_id AND category = p_category;
  END IF;
  INSERT INTO public.p5scr_audit_events(event, subject_id, category, actor_user_id, payload_admin_only)
    VALUES ('p5_screening.result_expired', p_subject_id, p_category, auth.uid(),
            jsonb_build_object('invalidation_id', v_id, 'trigger', p_trigger));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.p5scr_invalidate(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5scr_invalidate(uuid, text, text, text) TO authenticated;

-- 10) Log inbound webhook ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.p5scr_log_webhook(
  p_event text,
  p_provider_ref text DEFAULT NULL,
  p_signature_hash text DEFAULT NULL,
  p_raw_webhook_payload_admin_only jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin') THEN
    RAISE EXCEPTION 'p5scr: platform_admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.p5scr_webhook_events_ledger(event, provider_ref, signature_hash, raw_webhook_payload_admin_only)
    VALUES (p_event, p_provider_ref, p_signature_hash, p_raw_webhook_payload_admin_only)
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.p5scr_log_webhook(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5scr_log_webhook(text, text, text, jsonb) TO authenticated;

-- 11) Link Memory/finality (link-only) --------------------------------------
CREATE OR REPLACE FUNCTION public.p5scr_link_memory_finality(
  p_subject_id uuid,
  p_kind text,
  p_memory_record_id uuid DEFAULT NULL,
  p_finality_record_id uuid DEFAULT NULL,
  p_link_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin') THEN
    RAISE EXCEPTION 'p5scr: platform_admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.p5scr_memory_finality_links(
    subject_id, kind, memory_record_id, finality_record_id, link_note, created_by)
    VALUES (p_subject_id, p_kind, p_memory_record_id, p_finality_record_id, p_link_note, auth.uid())
    RETURNING id INTO v_id;
  INSERT INTO public.p5scr_audit_events(event, subject_id, actor_user_id, payload_admin_only)
    VALUES ('p5_screening.memory_link_recorded', p_subject_id, auth.uid(),
            jsonb_build_object('link_id', v_id, 'kind', p_kind));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.p5scr_link_memory_finality(uuid, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5scr_link_memory_finality(uuid, text, uuid, uuid, text) TO authenticated;

-- 12) Evaluate gate (read-only) ---------------------------------------------
CREATE OR REPLACE FUNCTION public.p5scr_evaluate_gate(
  p_subject_id uuid,
  p_gate text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_blockers jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin') THEN
    RAISE EXCEPTION 'p5scr: platform_admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'category', category, 'state', state,
           'expires_at', expires_at, 'last_checked_at', decided_at)), '[]'::jsonb)
    INTO v_blockers
    FROM public.p5scr_check_state cs
   WHERE cs.subject_id = p_subject_id
     AND cs.state IN ('not_started','screening_pending','idv_pending','provider_pending',
                      'manual_review_required','screening_expired','failed','rejected')
     AND CASE
           WHEN p_gate IN ('poi_create','poi_accept','wad_create')
             THEN cs.state IN ('failed','rejected')
           ELSE true
         END;
  RETURN jsonb_build_object(
    'gate', p_gate,
    'ready', (jsonb_array_length(v_blockers) = 0),
    'blockers', v_blockers);
END $$;
REVOKE ALL ON FUNCTION public.p5scr_evaluate_gate(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5scr_evaluate_gate(uuid, text) TO authenticated;
