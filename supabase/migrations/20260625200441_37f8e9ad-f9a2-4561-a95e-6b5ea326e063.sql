
-- =====================================================================
-- P-5 Batch 5 Phase 1 — Schema SSOT + vocab expansion
-- =====================================================================

-- 1. Enums --------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.p5b5_finality_status AS ENUM (
    'none','ready_for_finality','final','under_dispute','corrected','superseded','invalid_test'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.p5b5_final_outcome_code AS ENUM (
    'COMPLETED','COMPLETED_WITH_EXCEPTION','APPROVED_NOT_EXECUTED',
    'WITHDRAWN_BY_USER','REJECTED','EXPIRED','CANCELLED',
    'FAILED_PROVIDER_DEPENDENCY','DISPUTED','SUPERSEDED','TEST_OR_INVALID'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.p5b5_memory_status AS ENUM (
    'active','paused','excluded','corrected','superseded','not_written'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.p5b5_dispute_status AS ENUM (
    'none','under_dispute','resolved_upheld','resolved_partially_upheld',
    'resolved_dismissed','withdrawn','escalated'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.p5b5_correction_status AS ENUM (
    'none','corrected','superseded','administrative_reclassification'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.p5b5_provider_dependency_status AS ENUM (
    'success','failed','inconclusive','reconciled','refunded','duplicate_ignored','not_applicable'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.p5b5_evidence_completeness_status AS ENUM (
    'complete','incomplete','waived','not_applicable'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Extend p5_batch4_finality_records (canonical finality table) -------

ALTER TABLE public.p5_batch4_finality_records
  ADD COLUMN IF NOT EXISTS p5b5_finality_status public.p5b5_finality_status,
  ADD COLUMN IF NOT EXISTS p5b5_final_outcome_code public.p5b5_final_outcome_code,
  ADD COLUMN IF NOT EXISTS p5b5_memory_status public.p5b5_memory_status,
  ADD COLUMN IF NOT EXISTS p5b5_dispute_status public.p5b5_dispute_status
    DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS p5b5_correction_status public.p5b5_correction_status
    DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS p5b5_provider_dependency_status
    public.p5b5_provider_dependency_status,
  ADD COLUMN IF NOT EXISTS p5b5_evidence_completeness_status
    public.p5b5_evidence_completeness_status,
  ADD COLUMN IF NOT EXISTS evidence_relied_on_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence_rating_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS compliance_decision_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS kyb_kyc_decision_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS funder_review_outcome_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS approvals_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS waivers_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS exceptions_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS provider_dependency_state_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_state_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS webhook_state_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reconciliation_state_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_current_effective_record boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS superseded_by_finality_record_id uuid
    REFERENCES public.p5_batch4_finality_records(id),
  ADD COLUMN IF NOT EXISTS audit_hash_reference text,
  ADD COLUMN IF NOT EXISTS hash_chain_reference text,
  ADD COLUMN IF NOT EXISTS schema_version text NOT NULL DEFAULT 'p5b5.v1',
  ADD COLUMN IF NOT EXISTS outcome_code_version text NOT NULL DEFAULT 'p5b5-outcomes.v1';

COMMENT ON TABLE public.p5_batch4_finality_records IS
  'Canonical finality table. Extended by P-5 Batch 5 (Phase 1) with locked snapshots, governed status enums, supersession linkage and audit/hash references. Do not create a parallel finality table.';

CREATE INDEX IF NOT EXISTS p5b4_finality_records_p5b5_status_idx
  ON public.p5_batch4_finality_records(p5b5_finality_status);
CREATE INDEX IF NOT EXISTS p5b4_finality_records_current_effective_idx
  ON public.p5_batch4_finality_records(case_id) WHERE is_current_effective_record;
CREATE INDEX IF NOT EXISTS p5b4_finality_records_superseded_by_idx
  ON public.p5_batch4_finality_records(superseded_by_finality_record_id);

-- 3. Lock trigger -------------------------------------------------------
-- Once p5b5_finality_status='final', block UPDATE/DELETE except for the
-- two controlled supersession/effective-record columns. DELETE is always
-- blocked on final rows.

CREATE OR REPLACE FUNCTION public.p5b5_prevent_finality_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.p5b5_finality_status = 'final' THEN
      RAISE EXCEPTION 'P5B5: cannot DELETE a finalised finality record (id=%)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE path
  IF OLD.p5b5_finality_status = 'final' THEN
    -- Allow controlled mutations: supersession linkage + current effective flag
    -- + the Batch 5 status enums that reflect downstream lifecycle (dispute,
    -- correction, memory, provider) transitions. Snapshot/identity/actor
    -- fields are frozen.
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.case_id IS DISTINCT FROM OLD.case_id
       OR NEW.final_outcome IS DISTINCT FROM OLD.final_outcome
       OR NEW.p5b5_final_outcome_code IS DISTINCT FROM OLD.p5b5_final_outcome_code
       OR NEW.finality_summary IS DISTINCT FROM OLD.finality_summary
       OR NEW.evidence_relied_on_snapshot IS DISTINCT FROM OLD.evidence_relied_on_snapshot
       OR NEW.evidence_rating_snapshot IS DISTINCT FROM OLD.evidence_rating_snapshot
       OR NEW.compliance_decision_snapshot IS DISTINCT FROM OLD.compliance_decision_snapshot
       OR NEW.kyb_kyc_decision_snapshot IS DISTINCT FROM OLD.kyb_kyc_decision_snapshot
       OR NEW.funder_review_outcome_snapshot IS DISTINCT FROM OLD.funder_review_outcome_snapshot
       OR NEW.approvals_snapshot IS DISTINCT FROM OLD.approvals_snapshot
       OR NEW.waivers_snapshot IS DISTINCT FROM OLD.waivers_snapshot
       OR NEW.exceptions_snapshot IS DISTINCT FROM OLD.exceptions_snapshot
       OR NEW.provider_dependency_state_snapshot IS DISTINCT FROM OLD.provider_dependency_state_snapshot
       OR NEW.payment_state_snapshot IS DISTINCT FROM OLD.payment_state_snapshot
       OR NEW.webhook_state_snapshot IS DISTINCT FROM OLD.webhook_state_snapshot
       OR NEW.reconciliation_state_snapshot IS DISTINCT FROM OLD.reconciliation_state_snapshot
       OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
       OR NEW.audit_hash_reference IS DISTINCT FROM OLD.audit_hash_reference
       OR NEW.hash_chain_reference IS DISTINCT FROM OLD.hash_chain_reference
       OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
       OR NEW.outcome_code_version IS DISTINCT FROM OLD.outcome_code_version
    THEN
      RAISE EXCEPTION 'P5B5: finalised finality record is locked (id=%); only supersession/effective-record/lifecycle status columns may change', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS p5b5_prevent_finality_mutation_trg
  ON public.p5_batch4_finality_records;
CREATE TRIGGER p5b5_prevent_finality_mutation_trg
  BEFORE UPDATE OR DELETE ON public.p5_batch4_finality_records
  FOR EACH ROW EXECUTE FUNCTION public.p5b5_prevent_finality_mutation();

-- 4. New table: p5_batch5_memory_records --------------------------------

CREATE TABLE IF NOT EXISTS public.p5_batch5_memory_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finality_record_id uuid NOT NULL
    REFERENCES public.p5_batch4_finality_records(id),
  case_id uuid NOT NULL,
  organisation_id uuid,
  counterparty_id uuid,
  trigger_event_type text NOT NULL,
  final_outcome_code public.p5b5_final_outcome_code NOT NULL,
  memory_status public.p5b5_memory_status NOT NULL DEFAULT 'active',
  dispute_status public.p5b5_dispute_status NOT NULL DEFAULT 'none',
  correction_status public.p5b5_correction_status NOT NULL DEFAULT 'none',
  provider_dependency_status public.p5b5_provider_dependency_status,
  evidence_completeness_status public.p5b5_evidence_completeness_status,
  evidence_rating_band text,
  safe_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  reliance_level text NOT NULL DEFAULT 'governed',
  superseded_by_memory_record_id uuid
    REFERENCES public.p5_batch5_memory_records(id),
  audit_hash_reference text,
  hash_chain_reference text,
  schema_version text NOT NULL DEFAULT 'p5b5.v1',
  outcome_code_version text NOT NULL DEFAULT 'p5b5-outcomes.v1',
  written_by uuid NOT NULL,
  written_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.p5_batch5_memory_records IS
  'P-5 Batch 5 governed Memory layer. Separate from basic_memory_records v1. Append-only; status enums may transition via security-definer RPC. No direct UPDATE/DELETE by users.';

GRANT SELECT ON public.p5_batch5_memory_records TO authenticated;
GRANT ALL ON public.p5_batch5_memory_records TO service_role;

ALTER TABLE public.p5_batch5_memory_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "p5b5_memory_records_admin_auditor_read"
  ON public.p5_batch5_memory_records
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  );

CREATE POLICY "p5b5_memory_records_service_role_all"
  ON public.p5_batch5_memory_records
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Append-only enforcement: block UPDATE/DELETE except for controlled
-- lifecycle status fields (memory_status, dispute_status, correction_status,
-- superseded_by_memory_record_id). All other columns are immutable.

CREATE OR REPLACE FUNCTION public.p5b5_memory_records_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'P5B5: p5_batch5_memory_records is append-only (id=%)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.finality_record_id IS DISTINCT FROM OLD.finality_record_id
     OR NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.counterparty_id IS DISTINCT FROM OLD.counterparty_id
     OR NEW.trigger_event_type IS DISTINCT FROM OLD.trigger_event_type
     OR NEW.final_outcome_code IS DISTINCT FROM OLD.final_outcome_code
     OR NEW.provider_dependency_status IS DISTINCT FROM OLD.provider_dependency_status
     OR NEW.evidence_completeness_status IS DISTINCT FROM OLD.evidence_completeness_status
     OR NEW.evidence_rating_band IS DISTINCT FROM OLD.evidence_rating_band
     OR NEW.safe_facts IS DISTINCT FROM OLD.safe_facts
     OR NEW.reliance_level IS DISTINCT FROM OLD.reliance_level
     OR NEW.audit_hash_reference IS DISTINCT FROM OLD.audit_hash_reference
     OR NEW.hash_chain_reference IS DISTINCT FROM OLD.hash_chain_reference
     OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
     OR NEW.outcome_code_version IS DISTINCT FROM OLD.outcome_code_version
     OR NEW.written_by IS DISTINCT FROM OLD.written_by
     OR NEW.written_at IS DISTINCT FROM OLD.written_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'P5B5: p5_batch5_memory_records is append-only; only memory_status, dispute_status, correction_status and superseded_by_memory_record_id may transition (id=%)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS p5b5_memory_records_append_only_trg
  ON public.p5_batch5_memory_records;
CREATE TRIGGER p5b5_memory_records_append_only_trg
  BEFORE UPDATE OR DELETE ON public.p5_batch5_memory_records
  FOR EACH ROW EXECUTE FUNCTION public.p5b5_memory_records_append_only();

CREATE INDEX IF NOT EXISTS p5b5_memory_records_finality_idx
  ON public.p5_batch5_memory_records(finality_record_id);
CREATE INDEX IF NOT EXISTS p5b5_memory_records_case_idx
  ON public.p5_batch5_memory_records(case_id);
CREATE INDEX IF NOT EXISTS p5b5_memory_records_counterparty_idx
  ON public.p5_batch5_memory_records(counterparty_id);
CREATE INDEX IF NOT EXISTS p5b5_memory_records_status_idx
  ON public.p5_batch5_memory_records(memory_status);
