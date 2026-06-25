
-- =====================================================================
-- P-5 Batch 5 Phase 2 — Correction / Dispute / Supersession Records
-- =====================================================================

-- 0. Enums --------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.p5b5_dispute_category AS ENUM (
    'user_challenge','organisation_challenge','funder_challenge',
    'provider_correction','contradictory_evidence','legal_compliance_notice',
    'duplicated_or_incorrect_case','platform_admin_review'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.p5b5_dispute_resolution AS ENUM (
    'upheld','partially_upheld','dismissed','withdrawn',
    'corrected','superseded','escalated'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1. Helper: role gate --------------------------------------------------
-- Returns the matching p5_batch4_role_key for the given user, or NULL if
-- the user does not hold any of the requested app_role values.

CREATE OR REPLACE FUNCTION public.p5b5_actor_role_for_user(
  _user_id uuid,
  _allowed_roles text[]
) RETURNS public.p5_batch4_role_key
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
BEGIN
  IF _user_id IS NULL THEN RETURN NULL; END IF;
  FOREACH r IN ARRAY _allowed_roles LOOP
    IF public.has_role(_user_id, r::public.app_role) THEN
      -- Map to the closest p5_batch4_role_key.
      RETURN CASE
        WHEN r = 'platform_admin' THEN 'platform_admin'::public.p5_batch4_role_key
        ELSE 'operator'::public.p5_batch4_role_key
      END;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.p5b5_actor_role_for_user(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p5b5_actor_role_for_user(uuid, text[]) TO authenticated, service_role;

-- 2. finality_corrections ----------------------------------------------

CREATE TABLE IF NOT EXISTS public.finality_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finality_record_id uuid NOT NULL
    REFERENCES public.p5_batch4_finality_records(id),
  case_id uuid NOT NULL,
  reason text NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  supporting_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved_by uuid NOT NULL,
  approver_role public.p5_batch4_role_key NOT NULL,
  audit_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.finality_corrections TO authenticated;
GRANT ALL ON public.finality_corrections TO service_role;
ALTER TABLE public.finality_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finality_corrections_admin_auditor_read"
  ON public.finality_corrections FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_analyst'::public.app_role)
    OR public.has_role(auth.uid(), 'legal_reviewer'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  );

CREATE POLICY "finality_corrections_service_role_all"
  ON public.finality_corrections FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS finality_corrections_finality_idx
  ON public.finality_corrections(finality_record_id);
CREATE INDEX IF NOT EXISTS finality_corrections_case_idx
  ON public.finality_corrections(case_id);

-- 3. finality_disputes -------------------------------------------------

CREATE TABLE IF NOT EXISTS public.finality_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finality_record_id uuid NOT NULL
    REFERENCES public.p5_batch4_finality_records(id),
  case_id uuid NOT NULL,
  category public.p5b5_dispute_category NOT NULL,
  reason text NOT NULL,
  linked_challenge_id uuid,
  reviewer_user_id uuid,
  opened_by uuid NOT NULL,
  opener_role public.p5_batch4_role_key NOT NULL,
  resolution public.p5b5_dispute_resolution,
  resolution_reason text,
  resolved_by uuid,
  resolver_role public.p5_batch4_role_key,
  resolved_at timestamptz,
  audit_event_id uuid,
  resolution_audit_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.finality_disputes TO authenticated;
GRANT ALL ON public.finality_disputes TO service_role;
ALTER TABLE public.finality_disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finality_disputes_admin_auditor_read"
  ON public.finality_disputes FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_analyst'::public.app_role)
    OR public.has_role(auth.uid(), 'legal_reviewer'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  );

CREATE POLICY "finality_disputes_service_role_all"
  ON public.finality_disputes FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS finality_disputes_finality_idx
  ON public.finality_disputes(finality_record_id);
CREATE INDEX IF NOT EXISTS finality_disputes_unresolved_idx
  ON public.finality_disputes(finality_record_id) WHERE resolution IS NULL;

-- 4. finality_supersessions --------------------------------------------

CREATE TABLE IF NOT EXISTS public.finality_supersessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_finality_record_id uuid NOT NULL
    REFERENCES public.p5_batch4_finality_records(id),
  superseding_finality_record_id uuid NOT NULL
    REFERENCES public.p5_batch4_finality_records(id),
  case_id uuid NOT NULL,
  reason text NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  approved_by uuid NOT NULL,
  approver_role public.p5_batch4_role_key NOT NULL,
  audit_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finality_supersessions_distinct
    CHECK (original_finality_record_id <> superseding_finality_record_id)
);
GRANT SELECT ON public.finality_supersessions TO authenticated;
GRANT ALL ON public.finality_supersessions TO service_role;
ALTER TABLE public.finality_supersessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finality_supersessions_admin_auditor_read"
  ON public.finality_supersessions FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_analyst'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  );

CREATE POLICY "finality_supersessions_service_role_all"
  ON public.finality_supersessions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS finality_supersessions_original_idx
  ON public.finality_supersessions(original_finality_record_id);

-- 5. finality_administrative_reclassifications -------------------------

CREATE TABLE IF NOT EXISTS public.finality_administrative_reclassifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finality_record_id uuid NOT NULL
    REFERENCES public.p5_batch4_finality_records(id),
  case_id uuid NOT NULL,
  reason text NOT NULL,
  previous_outcome_label text NOT NULL,
  corrected_outcome_label text NOT NULL,
  approved_by uuid NOT NULL,
  approver_role public.p5_batch4_role_key NOT NULL,
  audit_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.finality_administrative_reclassifications TO authenticated;
GRANT ALL ON public.finality_administrative_reclassifications TO service_role;
ALTER TABLE public.finality_administrative_reclassifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finality_reclass_admin_auditor_read"
  ON public.finality_administrative_reclassifications FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_analyst'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  );

CREATE POLICY "finality_reclass_service_role_all"
  ON public.finality_administrative_reclassifications FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS finality_reclass_finality_idx
  ON public.finality_administrative_reclassifications(finality_record_id);

-- 6. Append-only triggers ----------------------------------------------
-- Shared function: blocks DELETE always; on UPDATE, only the dispute
-- table may transition resolution / resolved_by / resolver_role /
-- resolved_at / resolution_reason / resolution_audit_event_id /
-- reviewer_user_id. All other tables are strictly insert-only.

CREATE OR REPLACE FUNCTION public.p5b5_disputes_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'P5B5: finality_disputes is append-only (id=%)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.finality_record_id IS DISTINCT FROM OLD.finality_record_id
     OR NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.linked_challenge_id IS DISTINCT FROM OLD.linked_challenge_id
     OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
     OR NEW.opener_role IS DISTINCT FROM OLD.opener_role
     OR NEW.audit_event_id IS DISTINCT FROM OLD.audit_event_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'P5B5: finality_disputes is append-only; only resolution fields may transition (id=%)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  -- Once resolved, resolution is locked.
  IF OLD.resolution IS NOT NULL
     AND (NEW.resolution IS DISTINCT FROM OLD.resolution
          OR NEW.resolved_by IS DISTINCT FROM OLD.resolved_by
          OR NEW.resolver_role IS DISTINCT FROM OLD.resolver_role
          OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
          OR NEW.resolution_reason IS DISTINCT FROM OLD.resolution_reason)
  THEN
    RAISE EXCEPTION 'P5B5: dispute already resolved; cannot mutate resolution (id=%)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS p5b5_disputes_append_only_trg ON public.finality_disputes;
CREATE TRIGGER p5b5_disputes_append_only_trg
  BEFORE UPDATE OR DELETE ON public.finality_disputes
  FOR EACH ROW EXECUTE FUNCTION public.p5b5_disputes_append_only();

CREATE OR REPLACE FUNCTION public.p5b5_insert_only_block()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'P5B5: % is append-only', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS p5b5_corrections_insert_only_trg ON public.finality_corrections;
CREATE TRIGGER p5b5_corrections_insert_only_trg
  BEFORE UPDATE OR DELETE ON public.finality_corrections
  FOR EACH ROW EXECUTE FUNCTION public.p5b5_insert_only_block();

DROP TRIGGER IF EXISTS p5b5_supersessions_insert_only_trg ON public.finality_supersessions;
CREATE TRIGGER p5b5_supersessions_insert_only_trg
  BEFORE UPDATE OR DELETE ON public.finality_supersessions
  FOR EACH ROW EXECUTE FUNCTION public.p5b5_insert_only_block();

DROP TRIGGER IF EXISTS p5b5_reclass_insert_only_trg
  ON public.finality_administrative_reclassifications;
CREATE TRIGGER p5b5_reclass_insert_only_trg
  BEFORE UPDATE OR DELETE ON public.finality_administrative_reclassifications
  FOR EACH ROW EXECUTE FUNCTION public.p5b5_insert_only_block();

-- 7. RPCs --------------------------------------------------------------

-- 7a. p5b5_add_correction
CREATE OR REPLACE FUNCTION public.p5b5_add_correction(
  _finality_record_id uuid,
  _reason text,
  _after_state jsonb,
  _supporting_evidence jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_role public.p5_batch4_role_key;
  v_finality public.p5_batch4_finality_records;
  v_before jsonb;
  v_audit_id uuid;
  v_correction_id uuid;
BEGIN
  IF _reason IS NULL OR length(btrim(_reason)) = 0 THEN
    RAISE EXCEPTION 'P5B5: reason required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _after_state IS NULL THEN
    RAISE EXCEPTION 'P5B5: after_state required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_actor_role := public.p5b5_actor_role_for_user(
    auth.uid(), ARRAY['platform_admin','compliance_analyst']
  );
  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'P5B5: not authorised to add correction'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_finality FROM public.p5_batch4_finality_records
    WHERE id = _finality_record_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P5B5: finality record not found' USING ERRCODE = 'no_data_found';
  END IF;

  v_before := to_jsonb(v_finality);

  INSERT INTO public.p5_batch4_audit_events(
    case_id, event_type, actor_user_id, actor_role, before_state, after_state,
    reason, linked_finality_id
  ) VALUES (
    v_finality.case_id, 'p5b5.correction_added', auth.uid(), v_actor_role,
    v_before, _after_state, _reason, _finality_record_id
  ) RETURNING id INTO v_audit_id;

  INSERT INTO public.finality_corrections(
    finality_record_id, case_id, reason, before_state, after_state,
    supporting_evidence, approved_by, approver_role, audit_event_id
  ) VALUES (
    _finality_record_id, v_finality.case_id, _reason, v_before, _after_state,
    COALESCE(_supporting_evidence, '[]'::jsonb), auth.uid(), v_actor_role, v_audit_id
  ) RETURNING id INTO v_correction_id;

  UPDATE public.p5_batch4_finality_records
    SET p5b5_correction_status = 'corrected',
        p5b5_finality_status = CASE
          WHEN p5b5_finality_status = 'final' THEN 'corrected'::public.p5b5_finality_status
          ELSE p5b5_finality_status
        END
    WHERE id = _finality_record_id;

  RETURN v_correction_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b5_add_correction(uuid, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p5b5_add_correction(uuid, text, jsonb, jsonb) TO authenticated, service_role;

-- 7b. p5b5_mark_under_dispute
CREATE OR REPLACE FUNCTION public.p5b5_mark_under_dispute(
  _finality_record_id uuid,
  _category public.p5b5_dispute_category,
  _reason text,
  _linked_challenge_id uuid DEFAULT NULL,
  _reviewer_user_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_role public.p5_batch4_role_key;
  v_finality public.p5_batch4_finality_records;
  v_before jsonb;
  v_audit_id uuid;
  v_dispute_id uuid;
BEGIN
  IF _reason IS NULL OR length(btrim(_reason)) = 0 THEN
    RAISE EXCEPTION 'P5B5: reason required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _category IS NULL THEN
    RAISE EXCEPTION 'P5B5: category required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_actor_role := public.p5b5_actor_role_for_user(
    auth.uid(), ARRAY['platform_admin','compliance_analyst','legal_reviewer']
  );
  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'P5B5: not authorised to mark dispute'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_finality FROM public.p5_batch4_finality_records
    WHERE id = _finality_record_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P5B5: finality record not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.finality_disputes
    WHERE finality_record_id = _finality_record_id AND resolution IS NULL
  ) THEN
    RAISE EXCEPTION 'P5B5: finality record already under unresolved dispute'
      USING ERRCODE = 'check_violation';
  END IF;

  v_before := to_jsonb(v_finality);

  INSERT INTO public.p5_batch4_audit_events(
    case_id, event_type, actor_user_id, actor_role, before_state, after_state,
    reason, linked_finality_id
  ) VALUES (
    v_finality.case_id, 'p5b5.dispute_opened', auth.uid(), v_actor_role,
    v_before,
    jsonb_build_object('category', _category::text, 'linked_challenge_id', _linked_challenge_id),
    _reason, _finality_record_id
  ) RETURNING id INTO v_audit_id;

  INSERT INTO public.finality_disputes(
    finality_record_id, case_id, category, reason, linked_challenge_id,
    reviewer_user_id, opened_by, opener_role, audit_event_id
  ) VALUES (
    _finality_record_id, v_finality.case_id, _category, _reason, _linked_challenge_id,
    _reviewer_user_id, auth.uid(), v_actor_role, v_audit_id
  ) RETURNING id INTO v_dispute_id;

  UPDATE public.p5_batch4_finality_records
    SET p5b5_dispute_status = 'under_dispute',
        p5b5_finality_status = 'under_dispute',
        p5b5_memory_status = COALESCE(
          CASE WHEN p5b5_memory_status = 'not_written' THEN p5b5_memory_status
               ELSE 'paused'::public.p5b5_memory_status END,
          'paused'::public.p5b5_memory_status)
    WHERE id = _finality_record_id;

  UPDATE public.p5_batch5_memory_records
    SET memory_status = 'paused', dispute_status = 'under_dispute'
    WHERE finality_record_id = _finality_record_id
      AND memory_status NOT IN ('superseded','corrected');

  RETURN v_dispute_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b5_mark_under_dispute(uuid, public.p5b5_dispute_category, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p5b5_mark_under_dispute(uuid, public.p5b5_dispute_category, text, uuid, uuid) TO authenticated, service_role;

-- 7c. p5b5_resolve_dispute
CREATE OR REPLACE FUNCTION public.p5b5_resolve_dispute(
  _dispute_id uuid,
  _resolution public.p5b5_dispute_resolution,
  _resolution_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_role public.p5_batch4_role_key;
  v_dispute public.finality_disputes;
  v_finality public.p5_batch4_finality_records;
  v_audit_id uuid;
  v_dispute_status public.p5b5_dispute_status;
  v_memory_status public.p5b5_memory_status;
  v_finality_status public.p5b5_finality_status;
BEGIN
  IF _resolution_reason IS NULL OR length(btrim(_resolution_reason)) = 0 THEN
    RAISE EXCEPTION 'P5B5: resolution_reason required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _resolution IS NULL THEN
    RAISE EXCEPTION 'P5B5: resolution required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_actor_role := public.p5b5_actor_role_for_user(
    auth.uid(), ARRAY['platform_admin','compliance_analyst']
  );
  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'P5B5: not authorised to resolve dispute'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_dispute FROM public.finality_disputes
    WHERE id = _dispute_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P5B5: dispute not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_dispute.resolution IS NOT NULL THEN
    RAISE EXCEPTION 'P5B5: dispute already resolved' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_finality FROM public.p5_batch4_finality_records
    WHERE id = v_dispute.finality_record_id FOR UPDATE;

  -- Upheld / partially upheld must be followed by correction or supersession
  -- (caller invokes the matching RPC). We allow the resolution here but
  -- keep Memory paused until correction/supersession lands.
  v_dispute_status := CASE _resolution
    WHEN 'upheld' THEN 'resolved_upheld'::public.p5b5_dispute_status
    WHEN 'partially_upheld' THEN 'resolved_partially_upheld'::public.p5b5_dispute_status
    WHEN 'dismissed' THEN 'resolved_dismissed'::public.p5b5_dispute_status
    WHEN 'withdrawn' THEN 'withdrawn'::public.p5b5_dispute_status
    WHEN 'escalated' THEN 'escalated'::public.p5b5_dispute_status
    WHEN 'corrected' THEN 'resolved_upheld'::public.p5b5_dispute_status
    WHEN 'superseded' THEN 'resolved_upheld'::public.p5b5_dispute_status
  END;

  v_memory_status := CASE _resolution
    WHEN 'dismissed' THEN 'active'::public.p5b5_memory_status
    WHEN 'withdrawn' THEN COALESCE(v_finality.p5b5_memory_status, 'active'::public.p5b5_memory_status)
    WHEN 'escalated' THEN 'paused'::public.p5b5_memory_status
    ELSE 'paused'::public.p5b5_memory_status   -- upheld / partially_upheld / corrected / superseded await follow-up
  END;

  v_finality_status := CASE _resolution
    WHEN 'dismissed' THEN 'final'::public.p5b5_finality_status
    WHEN 'withdrawn' THEN 'final'::public.p5b5_finality_status
    ELSE v_finality.p5b5_finality_status
  END;

  INSERT INTO public.p5_batch4_audit_events(
    case_id, event_type, actor_user_id, actor_role, before_state, after_state,
    reason, linked_finality_id
  ) VALUES (
    v_dispute.case_id, 'p5b5.dispute_resolved', auth.uid(), v_actor_role,
    to_jsonb(v_dispute),
    jsonb_build_object(
      'resolution', _resolution::text,
      'new_dispute_status', v_dispute_status::text,
      'new_memory_status', v_memory_status::text,
      'new_finality_status', v_finality_status::text
    ),
    _resolution_reason, v_dispute.finality_record_id
  ) RETURNING id INTO v_audit_id;

  UPDATE public.finality_disputes
    SET resolution = _resolution,
        resolution_reason = _resolution_reason,
        resolved_by = auth.uid(),
        resolver_role = v_actor_role,
        resolved_at = now(),
        resolution_audit_event_id = v_audit_id
    WHERE id = _dispute_id;

  UPDATE public.p5_batch4_finality_records
    SET p5b5_dispute_status = v_dispute_status,
        p5b5_memory_status = v_memory_status,
        p5b5_finality_status = v_finality_status
    WHERE id = v_dispute.finality_record_id;

  UPDATE public.p5_batch5_memory_records
    SET memory_status = v_memory_status, dispute_status = v_dispute_status
    WHERE finality_record_id = v_dispute.finality_record_id
      AND memory_status NOT IN ('superseded','corrected');

  RETURN _dispute_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b5_resolve_dispute(uuid, public.p5b5_dispute_resolution, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p5b5_resolve_dispute(uuid, public.p5b5_dispute_resolution, text) TO authenticated, service_role;

-- 7d. p5b5_supersede_finality
CREATE OR REPLACE FUNCTION public.p5b5_supersede_finality(
  _original_finality_record_id uuid,
  _superseding_finality_record_id uuid,
  _reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_role public.p5_batch4_role_key;
  v_original public.p5_batch4_finality_records;
  v_superseding public.p5_batch4_finality_records;
  v_audit_id uuid;
  v_super_id uuid;
BEGIN
  IF _reason IS NULL OR length(btrim(_reason)) = 0 THEN
    RAISE EXCEPTION 'P5B5: reason required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _original_finality_record_id = _superseding_finality_record_id THEN
    RAISE EXCEPTION 'P5B5: original and superseding records must differ'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_actor_role := public.p5b5_actor_role_for_user(
    auth.uid(), ARRAY['platform_admin']
  );
  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'P5B5: only platform_admin may supersede finality'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_original FROM public.p5_batch4_finality_records
    WHERE id = _original_finality_record_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P5B5: original finality record not found' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO v_superseding FROM public.p5_batch4_finality_records
    WHERE id = _superseding_finality_record_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P5B5: superseding finality record not found' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.p5_batch4_audit_events(
    case_id, event_type, actor_user_id, actor_role, before_state, after_state,
    reason, linked_finality_id
  ) VALUES (
    v_original.case_id, 'p5b5.finality_superseded', auth.uid(), v_actor_role,
    to_jsonb(v_original), to_jsonb(v_superseding), _reason, _original_finality_record_id
  ) RETURNING id INTO v_audit_id;

  INSERT INTO public.finality_supersessions(
    original_finality_record_id, superseding_finality_record_id, case_id,
    reason, before_state, after_state, approved_by, approver_role, audit_event_id
  ) VALUES (
    _original_finality_record_id, _superseding_finality_record_id, v_original.case_id,
    _reason, to_jsonb(v_original), to_jsonb(v_superseding), auth.uid(), v_actor_role, v_audit_id
  ) RETURNING id INTO v_super_id;

  UPDATE public.p5_batch4_finality_records
    SET superseded_by_finality_record_id = _superseding_finality_record_id,
        is_current_effective_record = false,
        p5b5_finality_status = 'superseded',
        p5b5_correction_status = 'superseded',
        p5b5_memory_status = 'superseded'
    WHERE id = _original_finality_record_id;

  UPDATE public.p5_batch4_finality_records
    SET is_current_effective_record = true
    WHERE id = _superseding_finality_record_id;

  UPDATE public.p5_batch5_memory_records
    SET memory_status = 'superseded', correction_status = 'superseded'
    WHERE finality_record_id = _original_finality_record_id
      AND memory_status NOT IN ('superseded');

  RETURN v_super_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b5_supersede_finality(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p5b5_supersede_finality(uuid, uuid, text) TO authenticated, service_role;

-- 7e. p5b5_reclassify_finality
CREATE OR REPLACE FUNCTION public.p5b5_reclassify_finality(
  _finality_record_id uuid,
  _corrected_outcome_label text,
  _reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_role public.p5_batch4_role_key;
  v_finality public.p5_batch4_finality_records;
  v_audit_id uuid;
  v_reclass_id uuid;
  v_previous_label text;
BEGIN
  IF _reason IS NULL OR length(btrim(_reason)) = 0 THEN
    RAISE EXCEPTION 'P5B5: reason required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _corrected_outcome_label IS NULL OR length(btrim(_corrected_outcome_label)) = 0 THEN
    RAISE EXCEPTION 'P5B5: corrected_outcome_label required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_actor_role := public.p5b5_actor_role_for_user(
    auth.uid(), ARRAY['platform_admin','compliance_analyst']
  );
  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'P5B5: not authorised to reclassify finality'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_finality FROM public.p5_batch4_finality_records
    WHERE id = _finality_record_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P5B5: finality record not found' USING ERRCODE = 'no_data_found';
  END IF;

  v_previous_label := COALESCE(v_finality.p5b5_final_outcome_code::text,
                               v_finality.final_outcome::text);

  INSERT INTO public.p5_batch4_audit_events(
    case_id, event_type, actor_user_id, actor_role, before_state, after_state,
    reason, linked_finality_id
  ) VALUES (
    v_finality.case_id, 'p5b5.finality_reclassified', auth.uid(), v_actor_role,
    jsonb_build_object('previous_outcome_label', v_previous_label),
    jsonb_build_object('corrected_outcome_label', _corrected_outcome_label),
    _reason, _finality_record_id
  ) RETURNING id INTO v_audit_id;

  INSERT INTO public.finality_administrative_reclassifications(
    finality_record_id, case_id, reason, previous_outcome_label,
    corrected_outcome_label, approved_by, approver_role, audit_event_id
  ) VALUES (
    _finality_record_id, v_finality.case_id, _reason, v_previous_label,
    _corrected_outcome_label, auth.uid(), v_actor_role, v_audit_id
  ) RETURNING id INTO v_reclass_id;

  UPDATE public.p5_batch4_finality_records
    SET p5b5_correction_status = 'administrative_reclassification'
    WHERE id = _finality_record_id;

  RETURN v_reclass_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.p5b5_reclassify_finality(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p5b5_reclassify_finality(uuid, text, text) TO authenticated, service_role;
