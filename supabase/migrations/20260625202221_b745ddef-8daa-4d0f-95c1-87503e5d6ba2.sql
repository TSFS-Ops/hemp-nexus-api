
-- ============================================================
-- P-5 Batch 5 — Phase 3
-- Memory writer + exclusion rules (DB layer)
-- ============================================================

-- ---------- Forbidden-field stripper ----------
CREATE OR REPLACE FUNCTION public.p5b5_strip_forbidden_fields(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_out jsonb;
  v_key text;
  v_forbidden text[] := ARRAY[
    -- raw provider / bank
    'raw_payload','raw_provider_payload','provider_raw',
    'raw_bank_details','bank_account_number','account_number','iban','swift','sort_code','routing_number','bic',
    -- credentials / secrets / tokens
    'password','password_hash','credentials',
    'api_key','api_secret','secret_key','secret','private_key',
    'access_token','refresh_token','bearer_token','token',
    'webhook_secret','encryption_key','pepper','salt',
    'key_hash','key_history','secret_hash',
    -- pii not required for business purpose
    'email','email_address','contact_email',
    'phone','phone_number','mobile','contact_phone',
    'date_of_birth','dob','id_number','passport_number','social_security','tax_number','vat_number',
    -- internal commentary / draft ai
    'private_notes','internal_notes','internal_commentary','internal_reasoning','support_notes',
    'ai_draft','ai_suggestion','draft_suggestion','draft_ai',
    -- unverified / scraped
    'scraped_claim','media_rumour','unverified_third_party',
    -- duplicated notification / test payment / sandbox
    'duplicated_notification','test_payment','sandbox_payload'
  ];
BEGIN
  IF p_input IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(p_input) = 'object' THEN
    v_out := p_input;
    FOREACH v_key IN ARRAY v_forbidden LOOP
      v_out := v_out - v_key;
    END LOOP;
    -- recursively strip nested objects/arrays
    SELECT jsonb_object_agg(k,
             CASE
               WHEN jsonb_typeof(val) IN ('object','array')
                 THEN public.p5b5_strip_forbidden_fields(val)
               ELSE val
             END)
      INTO v_out
      FROM jsonb_each(v_out) AS t(k, val);
    RETURN COALESCE(v_out, '{}'::jsonb);
  ELSIF jsonb_typeof(p_input) = 'array' THEN
    SELECT jsonb_agg(
             CASE
               WHEN jsonb_typeof(elem) IN ('object','array')
                 THEN public.p5b5_strip_forbidden_fields(elem)
               ELSE elem
             END)
      INTO v_out
      FROM jsonb_array_elements(p_input) AS t(elem);
    RETURN COALESCE(v_out, '[]'::jsonb);
  ELSE
    RETURN p_input;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.p5b5_strip_forbidden_fields(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b5_strip_forbidden_fields(jsonb) TO authenticated, service_role;


-- ---------- Repeated-pattern detector ----------
-- Returns true when EITHER:
--   * the counterparty has >= 2 finality-backed events of the given outcome_type, OR
--   * the counterparty has >= 1 compliance-approved material event
--     (a correction or supersession touching one of its finality records).
CREATE OR REPLACE FUNCTION public.p5b5_detect_repeated_pattern(
  p_case_id uuid,
  p_outcome_type text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_finality_count integer;
  v_material_count integer;
  v_codes text[];
BEGIN
  IF p_case_id IS NULL OR p_outcome_type IS NULL THEN
    RETURN false;
  END IF;

  -- Map outcome_type → concrete outcome codes (mirrors P5B5_OUTCOME_TYPE in TS SSOT)
  v_codes := CASE p_outcome_type
    WHEN 'positive'  THEN ARRAY['COMPLETED']
    WHEN 'qualified' THEN ARRAY['COMPLETED_WITH_EXCEPTION']
    WHEN 'negative'  THEN ARRAY['REJECTED']
    WHEN 'neutral'   THEN ARRAY['APPROVED_NOT_EXECUTED','WITHDRAWN_BY_USER','EXPIRED','CANCELLED','DISPUTED','SUPERSEDED']
    ELSE ARRAY[]::text[]
  END;

  IF array_length(v_codes, 1) IS NULL THEN
    RETURN false;
  END IF;

  SELECT count(*) INTO v_finality_count
  FROM public.p5_batch4_finality_records r
  WHERE r.case_id = p_case_id
    AND r.p5b5_finality_status = 'final'
    AND r.p5b5_final_outcome_code::text = ANY(v_codes)
    AND COALESCE(r.is_current_effective_record, true) = true;

  IF v_finality_count >= 2 THEN
    RETURN true;
  END IF;

  SELECT count(*) INTO v_material_count
  FROM public.finality_corrections fc
  JOIN public.p5_batch4_finality_records r ON r.id = fc.finality_record_id
  WHERE r.case_id = p_case_id;

  IF v_material_count >= 1 THEN
    RETURN true;
  END IF;

  SELECT count(*) INTO v_material_count
  FROM public.finality_supersessions fs
  JOIN public.p5_batch4_finality_records r ON r.id = fs.original_finality_record_id
  WHERE r.case_id = p_case_id;

  RETURN v_material_count >= 1;
END;
$$;

REVOKE ALL ON FUNCTION public.p5b5_detect_repeated_pattern(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b5_detect_repeated_pattern(uuid, text) TO authenticated, service_role;


-- ---------- Main writer ----------
-- Idempotent on finality_record_id.
-- NEVER writes:
--   - non-final finality
--   - TEST_OR_INVALID outcome
--   - unresolved dispute (writes a paused marker instead)
-- Emits a p5_batch4_audit_events row in every code path.
CREATE OR REPLACE FUNCTION public.p5b5_write_memory_from_finality(
  p_finality_record_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_reason text DEFAULT 'memory_writer_from_finality'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fr          public.p5_batch4_finality_records%ROWTYPE;
  v_existing_id uuid;
  v_new_id      uuid;
  v_safe_facts  jsonb;
  v_reliance    text;
  v_status      text;
  v_trigger     text := 'finality.recorded';
  v_outcome_typ text;
  v_is_provider boolean;
BEGIN
  IF p_finality_record_id IS NULL THEN
    RAISE EXCEPTION 'BAD_INPUT: finality_record_id required';
  END IF;

  SELECT * INTO v_fr
  FROM public.p5_batch4_finality_records
  WHERE id = p_finality_record_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: finality record %', p_finality_record_id;
  END IF;

  -- Idempotency: same finality_record_id → return existing memory row.
  SELECT id INTO v_existing_id
  FROM public.p5_batch5_memory_records
  WHERE finality_record_id = p_finality_record_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    INSERT INTO public.p5_batch4_audit_events
      (event_type, finality_record_id, actor_id, reason, before_state, after_state)
    VALUES
      ('p5b5.memory_write_skipped_idempotent', p_finality_record_id, p_actor_id, p_reason,
       jsonb_build_object('existing_memory_id', v_existing_id),
       jsonb_build_object('existing_memory_id', v_existing_id));
    RETURN v_existing_id;
  END IF;

  -- Exclusion 1: must be final
  IF v_fr.p5b5_finality_status IS DISTINCT FROM 'final' THEN
    INSERT INTO public.p5_batch4_audit_events
      (event_type, finality_record_id, actor_id, reason, before_state, after_state)
    VALUES
      ('p5b5.memory_write_excluded', p_finality_record_id, p_actor_id,
       COALESCE(p_reason,'') || ' :: not_final',
       to_jsonb(v_fr),
       jsonb_build_object('memory_status','not_written','exclusion','not_final'));
    RETURN NULL;
  END IF;

  -- Exclusion 2: TEST_OR_INVALID never becomes reusable memory
  IF v_fr.p5b5_final_outcome_code::text = 'TEST_OR_INVALID' THEN
    INSERT INTO public.p5_batch4_audit_events
      (event_type, finality_record_id, actor_id, reason, before_state, after_state)
    VALUES
      ('p5b5.memory_write_excluded', p_finality_record_id, p_actor_id,
       COALESCE(p_reason,'') || ' :: test_or_invalid',
       to_jsonb(v_fr),
       jsonb_build_object('memory_status','excluded','exclusion','test_or_invalid'));
    RETURN NULL;
  END IF;

  -- Exclusion 3: unresolved dispute → paused marker, not reusable
  IF v_fr.p5b5_dispute_status = 'under_dispute' THEN
    v_status := 'paused';
  ELSE
    v_status := 'active';
  END IF;

  -- Reliance level
  v_is_provider := v_fr.p5b5_final_outcome_code::text = 'FAILED_PROVIDER_DEPENDENCY';
  v_outcome_typ := CASE v_fr.p5b5_final_outcome_code::text
    WHEN 'COMPLETED' THEN 'positive'
    WHEN 'COMPLETED_WITH_EXCEPTION' THEN 'qualified'
    WHEN 'REJECTED' THEN 'negative'
    ELSE 'neutral'
  END;

  v_reliance := CASE
    WHEN v_status = 'paused' THEN 'do_not_rely'
    WHEN v_is_provider THEN 'provider_process_history_only'
    WHEN v_outcome_typ = 'positive' THEN 'reusable_positive'
    WHEN v_outcome_typ = 'qualified' THEN 'reusable_qualified'
    WHEN v_outcome_typ = 'negative' THEN 'reusable_negative'
    ELSE 'reference_only'
  END;

  -- Build safe_facts with forbidden fields stripped.
  v_safe_facts := jsonb_build_object(
    'outcome_code', v_fr.p5b5_final_outcome_code,
    'outcome_type', v_outcome_typ,
    'evidence_completeness', v_fr.p5b5_evidence_completeness_status,
    'provider_dependency_status', v_fr.p5b5_provider_dependency_status,
    'is_provider_process_event', v_is_provider,
    'is_counterparty_fault', (NOT v_is_provider) AND v_outcome_typ = 'negative',
    'evidence_rating_snapshot',  public.p5b5_strip_forbidden_fields(v_fr.evidence_rating_snapshot),
    'compliance_decision_snapshot', public.p5b5_strip_forbidden_fields(v_fr.compliance_decision_snapshot),
    'waivers_snapshot',          public.p5b5_strip_forbidden_fields(v_fr.waivers_snapshot),
    'exceptions_snapshot',       public.p5b5_strip_forbidden_fields(v_fr.exceptions_snapshot),
    'provider_dependency_state_snapshot', public.p5b5_strip_forbidden_fields(v_fr.provider_dependency_state_snapshot),
    'finality_summary',          v_fr.finality_summary
  );

  -- Insert the memory row
  INSERT INTO public.p5_batch5_memory_records (
    finality_record_id,
    case_id,
    trigger_event_type,
    final_outcome_code,
    memory_status,
    dispute_status,
    correction_status,
    provider_dependency_status,
    evidence_completeness_status,
    safe_facts,
    reliance_level,
    audit_hash_reference,
    hash_chain_reference,
    written_by
  ) VALUES (
    v_fr.id,
    v_fr.case_id,
    v_trigger,
    v_fr.p5b5_final_outcome_code,
    v_status::p5b5_memory_status,
    v_fr.p5b5_dispute_status,
    v_fr.p5b5_correction_status,
    v_fr.p5b5_provider_dependency_status,
    v_fr.p5b5_evidence_completeness_status,
    v_safe_facts,
    v_reliance,
    v_fr.audit_hash_reference,
    v_fr.hash_chain_reference,
    p_actor_id
  )
  RETURNING id INTO v_new_id;

  INSERT INTO public.p5_batch4_audit_events
    (event_type, finality_record_id, actor_id, reason, before_state, after_state)
  VALUES (
    CASE WHEN v_status = 'paused' THEN 'p5b5.memory_paused' ELSE 'p5b5.memory_written' END,
    p_finality_record_id, p_actor_id, p_reason,
    jsonb_build_object('memory_status_target', v_status),
    jsonb_build_object('memory_id', v_new_id, 'reliance_level', v_reliance, 'safe_facts', v_safe_facts)
  );

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.p5b5_write_memory_from_finality(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b5_write_memory_from_finality(uuid, uuid, text) TO service_role;
