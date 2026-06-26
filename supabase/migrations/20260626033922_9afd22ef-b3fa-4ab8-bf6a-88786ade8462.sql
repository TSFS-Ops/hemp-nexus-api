
-- =====================================================================
-- P-5 Batch 6 Phase 2 — Exceptions / Queues / Audit persistence
-- =====================================================================

-- Shared append-only guard
CREATE OR REPLACE FUNCTION public.p5b6_block_mutation_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_user = 'service_role' OR current_user = 'postgres' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'p5b6 append-only: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

-- ---------------------------------------------------------------------
-- 1. p5b6_exceptions
-- ---------------------------------------------------------------------
CREATE TABLE public.p5b6_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version text NOT NULL DEFAULT 'p5b6.v1',
  exception_type text NOT NULL,
  review_queue text NOT NULL,
  priority text NOT NULL,
  status text NOT NULL,
  severity text NOT NULL,
  owner_role text NOT NULL,
  assignee_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  org_id uuid,
  funder_org_id uuid,
  counterparty_org_id uuid,
  related_finality_id uuid,
  related_memory_id uuid,
  related_match_id uuid,
  summary text NOT NULL,
  external_safe_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT p5b6_exceptions_type_chk CHECK (exception_type IN (
    'EVIDENCE_MISSING','EVIDENCE_INVALID_OR_EXPIRED','CONFLICTING_PARTY_INFORMATION',
    'COMPLIANCE_HOLD','FUNDER_REVIEW_EXCEPTION','PROVIDER_DEPENDENCY_FAILURE',
    'PAYMENT_RECONCILIATION_EXCEPTION','MANUAL_OVERRIDE_REQUESTED','DISPUTE_RAISED',
    'FINALITY_BLOCKED','MEMORY_CONFLICT_OR_CORRECTION','SECURITY_OR_ACCESS_EXCEPTION'
  )),
  CONSTRAINT p5b6_exceptions_queue_chk CHECK (review_queue IN (
    'evidence_gap','compliance_exception','funder_escalation','provider_dependency',
    'payment_reconciliation','manual_override_waiver','finality_review','dispute_review',
    'memory_governance','unified_operations_inbox'
  )),
  CONSTRAINT p5b6_exceptions_priority_chk CHECK (priority IN ('P0','P1','P2','P3','P4')),
  CONSTRAINT p5b6_exceptions_severity_chk CHECK (severity IN ('critical','high','medium')),
  CONSTRAINT p5b6_exceptions_status_chk CHECK (status IN (
    'open_action_required','open_evidence_review','open_compliance_review','on_hold_compliance',
    'open_funder_review','open_provider_dependency','open_reconciliation','pending_override_approval',
    'dispute_raised','blocked_finality','open_memory_review','security_hold','under_review',
    'awaiting_evidence','awaiting_external_response','resolved','reopened','duplicate','cancelled',
    'invalid_test','tombstoned_legal'
  )),
  CONSTRAINT p5b6_exceptions_schema_chk CHECK (schema_version = 'p5b6.v1')
);
GRANT SELECT ON public.p5b6_exceptions TO authenticated;
GRANT ALL ON public.p5b6_exceptions TO service_role;
ALTER TABLE public.p5b6_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "p5b6_exceptions_admin_select"
  ON public.p5b6_exceptions FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'governance_reviewer')
    OR public.has_role(auth.uid(), 'compliance_analyst')
  );

CREATE POLICY "p5b6_exceptions_scoped_select"
  ON public.p5b6_exceptions FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    OR funder_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    OR counterparty_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE INDEX p5b6_exceptions_queue_status_idx ON public.p5b6_exceptions(review_queue, status);
CREATE INDEX p5b6_exceptions_org_idx ON public.p5b6_exceptions(org_id);
CREATE INDEX p5b6_exceptions_assignee_idx ON public.p5b6_exceptions(assignee_user_id);

CREATE TRIGGER p5b6_exceptions_updated_at
  BEFORE UPDATE ON public.p5b6_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 2. p5b6_exception_notes (immutable)
-- ---------------------------------------------------------------------
CREATE TABLE public.p5b6_exception_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version text NOT NULL DEFAULT 'p5b6.v1',
  exception_id uuid NOT NULL REFERENCES public.p5b6_exceptions(id) ON DELETE CASCADE,
  note_type text NOT NULL,
  body text NOT NULL,
  reason_required boolean NOT NULL DEFAULT false,
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p5b6_notes_type_chk CHECK (note_type IN (
    'resolution_reason','override_waiver_reason','rejection_reason','compliance_hold_note',
    'priority_change_reason','assignment_note','evidence_request_note','dispute_review_note',
    'correction_supersession_note','security_access_note'
  )),
  CONSTRAINT p5b6_notes_body_chk CHECK (length(btrim(body)) > 0),
  CONSTRAINT p5b6_notes_schema_chk CHECK (schema_version = 'p5b6.v1')
);
GRANT SELECT ON public.p5b6_exception_notes TO authenticated;
GRANT ALL ON public.p5b6_exception_notes TO service_role;
ALTER TABLE public.p5b6_exception_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "p5b6_notes_admin_select"
  ON public.p5b6_exception_notes FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'governance_reviewer')
    OR public.has_role(auth.uid(), 'compliance_analyst')
  );

CREATE INDEX p5b6_notes_exception_idx ON public.p5b6_exception_notes(exception_id);

CREATE TRIGGER p5b6_notes_no_update
  BEFORE UPDATE ON public.p5b6_exception_notes
  FOR EACH ROW EXECUTE FUNCTION public.p5b6_block_mutation_append_only();
CREATE TRIGGER p5b6_notes_no_delete
  BEFORE DELETE ON public.p5b6_exception_notes
  FOR EACH ROW EXECUTE FUNCTION public.p5b6_block_mutation_append_only();

-- ---------------------------------------------------------------------
-- 3. p5b6_exception_audit_events (append-only ledger)
-- ---------------------------------------------------------------------
CREATE TABLE public.p5b6_exception_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version text NOT NULL DEFAULT 'p5b6.v1',
  exception_id uuid NOT NULL REFERENCES public.p5b6_exceptions(id) ON DELETE CASCADE,
  event_code text NOT NULL,
  before_snapshot jsonb,
  after_snapshot jsonb,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p5b6_audit_prefix_chk CHECK (event_code LIKE 'p5b6.%'),
  CONSTRAINT p5b6_audit_schema_chk CHECK (schema_version = 'p5b6.v1')
);
GRANT SELECT ON public.p5b6_exception_audit_events TO authenticated;
GRANT ALL ON public.p5b6_exception_audit_events TO service_role;
ALTER TABLE public.p5b6_exception_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "p5b6_audit_admin_select"
  ON public.p5b6_exception_audit_events FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'governance_reviewer')
    OR public.has_role(auth.uid(), 'compliance_analyst')
  );

CREATE INDEX p5b6_audit_exception_idx ON public.p5b6_exception_audit_events(exception_id, created_at);
CREATE INDEX p5b6_audit_event_code_idx ON public.p5b6_exception_audit_events(event_code);

CREATE TRIGGER p5b6_audit_no_update
  BEFORE UPDATE ON public.p5b6_exception_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.p5b6_block_mutation_append_only();
CREATE TRIGGER p5b6_audit_no_delete
  BEFORE DELETE ON public.p5b6_exception_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.p5b6_block_mutation_append_only();

-- ---------------------------------------------------------------------
-- 4. p5b6_exception_disputes
-- ---------------------------------------------------------------------
CREATE TABLE public.p5b6_exception_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version text NOT NULL DEFAULT 'p5b6.v1',
  exception_id uuid NOT NULL REFERENCES public.p5b6_exceptions(id) ON DELETE CASCADE,
  dispute_state text NOT NULL DEFAULT 'dispute_raised',
  pauses_memory boolean NOT NULL DEFAULT true,
  raised_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  raised_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  closure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p5b6_disputes_state_chk CHECK (dispute_state IN (
    'dispute_raised','initial_triage','under_review','awaiting_evidence',
    'awaiting_counterparty_response','escalated','proposed_resolution',
    'resolved_upheld','resolved_partially_upheld','resolved_dismissed',
    'withdrawn','closed_corrected','closed_superseded'
  )),
  CONSTRAINT p5b6_disputes_schema_chk CHECK (schema_version = 'p5b6.v1')
);
GRANT SELECT ON public.p5b6_exception_disputes TO authenticated;
GRANT ALL ON public.p5b6_exception_disputes TO service_role;
ALTER TABLE public.p5b6_exception_disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "p5b6_disputes_admin_select"
  ON public.p5b6_exception_disputes FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'governance_reviewer')
    OR public.has_role(auth.uid(), 'compliance_analyst')
  );

CREATE INDEX p5b6_disputes_exception_idx ON public.p5b6_exception_disputes(exception_id);
CREATE INDEX p5b6_disputes_state_idx ON public.p5b6_exception_disputes(dispute_state);

CREATE TRIGGER p5b6_disputes_updated_at
  BEFORE UPDATE ON public.p5b6_exception_disputes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 5. p5b6_exception_queue_assignments (append-only trail)
-- ---------------------------------------------------------------------
CREATE TABLE public.p5b6_exception_queue_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version text NOT NULL DEFAULT 'p5b6.v1',
  exception_id uuid NOT NULL REFERENCES public.p5b6_exceptions(id) ON DELETE CASCADE,
  from_queue text,
  to_queue text NOT NULL,
  from_assignee_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  to_assignee_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p5b6_qassign_to_queue_chk CHECK (to_queue IN (
    'evidence_gap','compliance_exception','funder_escalation','provider_dependency',
    'payment_reconciliation','manual_override_waiver','finality_review','dispute_review',
    'memory_governance','unified_operations_inbox'
  )),
  CONSTRAINT p5b6_qassign_schema_chk CHECK (schema_version = 'p5b6.v1')
);
GRANT SELECT ON public.p5b6_exception_queue_assignments TO authenticated;
GRANT ALL ON public.p5b6_exception_queue_assignments TO service_role;
ALTER TABLE public.p5b6_exception_queue_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "p5b6_qassign_admin_select"
  ON public.p5b6_exception_queue_assignments FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'governance_reviewer')
    OR public.has_role(auth.uid(), 'compliance_analyst')
  );

CREATE INDEX p5b6_qassign_exception_idx ON public.p5b6_exception_queue_assignments(exception_id, created_at);

CREATE TRIGGER p5b6_qassign_no_update
  BEFORE UPDATE ON public.p5b6_exception_queue_assignments
  FOR EACH ROW EXECUTE FUNCTION public.p5b6_block_mutation_append_only();
CREATE TRIGGER p5b6_qassign_no_delete
  BEFORE DELETE ON public.p5b6_exception_queue_assignments
  FOR EACH ROW EXECUTE FUNCTION public.p5b6_block_mutation_append_only();

-- ---------------------------------------------------------------------
-- 6. p5b6_exception_report_exports (append-only)
-- ---------------------------------------------------------------------
CREATE TABLE public.p5b6_exception_report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version text NOT NULL DEFAULT 'p5b6.v1',
  report_code text NOT NULL,
  export_format text NOT NULL,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_for_org_id uuid,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_restricted boolean NOT NULL DEFAULT false,
  row_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p5b6_report_format_chk CHECK (export_format IN ('csv','json','pdf')),
  CONSTRAINT p5b6_report_schema_chk CHECK (schema_version = 'p5b6.v1')
);
GRANT SELECT ON public.p5b6_exception_report_exports TO authenticated;
GRANT ALL ON public.p5b6_exception_report_exports TO service_role;
ALTER TABLE public.p5b6_exception_report_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "p5b6_reports_admin_select"
  ON public.p5b6_exception_report_exports FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'governance_reviewer')
    OR public.has_role(auth.uid(), 'compliance_analyst')
  );

CREATE INDEX p5b6_reports_code_idx ON public.p5b6_exception_report_exports(report_code, created_at);

CREATE TRIGGER p5b6_reports_no_update
  BEFORE UPDATE ON public.p5b6_exception_report_exports
  FOR EACH ROW EXECUTE FUNCTION public.p5b6_block_mutation_append_only();
CREATE TRIGGER p5b6_reports_no_delete
  BEFORE DELETE ON public.p5b6_exception_report_exports
  FOR EACH ROW EXECUTE FUNCTION public.p5b6_block_mutation_append_only();
