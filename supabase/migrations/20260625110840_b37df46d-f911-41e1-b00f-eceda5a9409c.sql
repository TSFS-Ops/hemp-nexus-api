
-- ============================================================
-- P-5 Batch 4 Stage 1 — Execution Engine DB foundation
-- (Enums + helpers, tables, then GRANTs / RLS / policies / triggers / indexes.)
-- Stage 1 scope: schema only. No RPC wrappers (Stage 3), no UI (Stage 4+).
-- ============================================================

-- ---------- Enums ----------
CREATE TYPE public.p5_batch4_process_type AS ENUM (
  'company_onboarding','transaction_case','project_workstream','funder_release'
);
CREATE TYPE public.p5_batch4_execution_status AS ENUM (
  'not_started','opened','in_progress','waiting_for_evidence','evidence_under_review',
  'waiting_for_internal_review','provider_dependent','more_information_requested',
  'blocked','escalated','funder_review','approved_to_proceed','final_approval_pending',
  'finality_recorded','rejected','withdrawn','cancelled','closed','archived'
);
CREATE TYPE public.p5_batch4_readiness_status AS ENUM (
  'not_ready','in_review','internally_ready','provider_dependent','blocked','ready_for_finality'
);
CREATE TYPE public.p5_batch4_milestone_key AS ENUM (
  'case_opened','scope_confirmed','evidence_checklist_generated','evidence_requested',
  'evidence_received','evidence_review_complete','governance_review_complete',
  'compliance_review_complete','readiness_confirmed','funder_release',
  'funder_review_complete','execution_conditions_complete','final_approval',
  'finality_recorded','closed_archived'
);
CREATE TYPE public.p5_batch4_milestone_status AS ENUM (
  'not_started','active','complete','waived','not_applicable','overdue','escalated','blocked'
);
CREATE TYPE public.p5_batch4_mandatory_type AS ENUM (
  'mandatory','conditional','optional'
);
CREATE TYPE public.p5_batch4_evidence_status AS ENUM (
  'missing','requested','uploaded','under_review','accepted','rejected',
  'expired','replaced','waived','provider_dependent'
);
CREATE TYPE public.p5_batch4_blocker_type AS ENUM ('hard','soft_warning');
CREATE TYPE public.p5_batch4_blocker_status AS ENUM (
  'open','resolved','overridden','escalated'
);
CREATE TYPE public.p5_batch4_blocker_key AS ENUM (
  'missing_authority_to_act','missing_mandatory_kyc_kyb',
  'rejected_or_expired_mandatory_evidence','unresolved_compliance_hold',
  'bank_account_holder_mismatch','ubo_director_unresolved','provider_failed_result',
  'provider_dependent_finality_item','unauthorised_access','final_approval_missing',
  'optional_evidence_missing','document_approaching_expiry','name_address_variation',
  'provider_not_live_internal_review','overdue_non_critical_task'
);
CREATE TYPE public.p5_batch4_task_status AS ENUM (
  'open','in_progress','completed','cancelled','escalated'
);
CREATE TYPE public.p5_batch4_funder_release_status AS ENUM (
  'released','viewed','more_information_requested','interested','not_interested',
  'approved_internally','declined','exited','revoked'
);
CREATE TYPE public.p5_batch4_finality_outcome AS ENUM (
  'finality_recorded','rejected','withdrawn','cancelled','superseded','archived'
);
CREATE TYPE public.p5_batch4_responsible_party_type AS ENUM (
  'platform_admin','operator','organisation_user','counterparty',
  'funder_organisation','system','external_provider'
);
CREATE TYPE public.p5_batch4_source_channel AS ENUM ('ui','api','system','webhook');
CREATE TYPE public.p5_batch4_role_key AS ENUM (
  'platform_admin','operator','organisation_user','counterparty',
  'funder_viewer','funder_reviewer','funder_approver','api_user','developer_system'
);

-- ---------- Helper trigger functions ----------
CREATE OR REPLACE FUNCTION public.p5b4_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Finality lock: rows are immutable after insert. Service role can override
-- only via direct SQL (no policy or RPC issues UPDATE in Stage 1).
CREATE OR REPLACE FUNCTION public.p5b4_lock_finality()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'p5_batch4_finality_records are locked after insert (case_id=%, outcome=%)',
    OLD.case_id, OLD.final_outcome
    USING ERRCODE = '42501';
END; $$;

-- Audit immutability: forbid UPDATE/DELETE on audit table.
CREATE OR REPLACE FUNCTION public.p5b4_block_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'p5_batch4_audit_events are append-only'
    USING ERRCODE = '42501';
END; $$;

-- Helper: is current user a platform admin?
CREATE OR REPLACE FUNCTION public.p5b4_is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'platform_admin'::public.app_role);
$$;

-- Helper: current funder organisation (re-uses Batch 3 funder-user mapping).
CREATE OR REPLACE FUNCTION public.p5b4_current_funder_org()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT fu.funder_organisation_id
  FROM public.p5_batch3_funder_users fu
  WHERE fu.auth_user_id = auth.uid()
    AND fu.status = 'active'
  LIMIT 1;
$$;

-- ============================================================
-- 1. Tables (no policies yet)
-- ============================================================

CREATE TABLE public.p5_batch4_execution_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_reference text NOT NULL UNIQUE,
  process_type public.p5_batch4_process_type NOT NULL,
  linked_company_id uuid,
  linked_transaction_id uuid,
  linked_project_id uuid,
  linked_workstream_id uuid,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  responsible_party_type public.p5_batch4_responsible_party_type,
  responsible_party_id uuid,
  current_milestone public.p5_batch4_milestone_key,
  execution_status public.p5_batch4_execution_status NOT NULL DEFAULT 'not_started',
  readiness_status public.p5_batch4_readiness_status NOT NULL DEFAULT 'not_ready',
  blocker_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  due_at timestamptz,
  overdue_state text,
  funder_status public.p5_batch4_funder_release_status,
  provider_dependency_status text,
  finality_status public.p5_batch4_finality_outcome,
  memory_summary_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  archived_at timestamptz,
  reopened_at timestamptz,
  reopen_reason text
);

CREATE TABLE public.p5_batch4_execution_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.p5_batch4_execution_cases(id) ON DELETE CASCADE,
  milestone_key public.p5_batch4_milestone_key NOT NULL,
  milestone_name text NOT NULL,
  mandatory_type public.p5_batch4_mandatory_type NOT NULL DEFAULT 'mandatory',
  status public.p5_batch4_milestone_status NOT NULL DEFAULT 'not_started',
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  responsible_role public.p5_batch4_role_key,
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  waived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  waiver_reason text,
  overdue_label text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, milestone_key)
);

CREATE TABLE public.p5_batch4_evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.p5_batch4_execution_cases(id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES public.p5_batch4_execution_milestones(id) ON DELETE SET NULL,
  evidence_type text NOT NULL,
  evidence_label text NOT NULL,
  requirement_type public.p5_batch4_mandatory_type NOT NULL DEFAULT 'mandatory',
  status public.p5_batch4_evidence_status NOT NULL DEFAULT 'missing',
  provider_dependent boolean NOT NULL DEFAULT false,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_reason text,
  waived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  waiver_reason text,
  file_reference text,
  file_hash text,
  sensitive boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.p5_batch4_blockers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.p5_batch4_execution_cases(id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES public.p5_batch4_execution_milestones(id) ON DELETE SET NULL,
  blocker_key public.p5_batch4_blocker_key NOT NULL,
  blocker_name text NOT NULL,
  blocker_type public.p5_batch4_blocker_type NOT NULL,
  trigger_condition text,
  status public.p5_batch4_blocker_status NOT NULL DEFAULT 'open',
  external_safe_label text NOT NULL,
  internal_detail text,
  can_override boolean NOT NULL DEFAULT false,
  override_by_role public.p5_batch4_role_key,
  override_reason_required boolean NOT NULL DEFAULT true,
  overridden_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  override_reason text,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE public.p5_batch4_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.p5_batch4_execution_cases(id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES public.p5_batch4_execution_milestones(id) ON DELETE SET NULL,
  assigned_to_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to_role public.p5_batch4_role_key,
  task_type text NOT NULL,
  task_label text NOT NULL,
  status public.p5_batch4_task_status NOT NULL DEFAULT 'open',
  due_at timestamptz,
  reminder_at timestamptz,
  escalation_at timestamptz,
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.p5_batch4_funder_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.p5_batch4_execution_cases(id) ON DELETE CASCADE,
  funder_org_id uuid NOT NULL,
  released_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  release_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  pack_reference text,
  access_expires_at timestamptz NOT NULL,
  download_allowed boolean NOT NULL DEFAULT false,
  nda_required boolean NOT NULL DEFAULT false,
  status public.p5_batch4_funder_release_status NOT NULL DEFAULT 'released',
  last_viewed_at timestamptz,
  decision_at timestamptz,
  decision_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.p5_batch4_finality_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.p5_batch4_execution_cases(id) ON DELETE CASCADE,
  final_outcome public.p5_batch4_finality_outcome NOT NULL,
  finality_summary text NOT NULL,
  evidence_pack_reference text,
  approval_reference text,
  waiver_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocker_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  funder_status_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  audit_reference uuid,
  memory_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  locked boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id)
);

CREATE TABLE public.p5_batch4_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES public.p5_batch4_execution_cases(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role public.p5_batch4_role_key,
  actor_org_id uuid,
  source_channel public.p5_batch4_source_channel NOT NULL DEFAULT 'system',
  before_state jsonb,
  after_state jsonb,
  reason text,
  external_safe_summary text,
  internal_detail text,
  linked_evidence_id uuid REFERENCES public.p5_batch4_evidence_items(id) ON DELETE SET NULL,
  linked_milestone_id uuid REFERENCES public.p5_batch4_execution_milestones(id) ON DELETE SET NULL,
  linked_blocker_id uuid REFERENCES public.p5_batch4_blockers(id) ON DELETE SET NULL,
  linked_funder_release_id uuid REFERENCES public.p5_batch4_funder_releases(id) ON DELETE SET NULL,
  linked_finality_id uuid REFERENCES public.p5_batch4_finality_records(id) ON DELETE SET NULL,
  request_id text,
  ip_address inet,
  device_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. GRANTs, RLS, Policies, Triggers, Indexes
-- ============================================================

-- ---- execution_cases ----
GRANT SELECT ON public.p5_batch4_execution_cases TO authenticated;
GRANT ALL ON public.p5_batch4_execution_cases TO service_role;
ALTER TABLE public.p5_batch4_execution_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b4_cases_admin_all" ON public.p5_batch4_execution_cases
  FOR ALL TO authenticated
  USING (public.p5b4_is_platform_admin())
  WITH CHECK (public.p5b4_is_platform_admin());
CREATE POLICY "p5b4_cases_owner_select" ON public.p5_batch4_execution_cases
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() OR created_by = auth.uid());
CREATE TRIGGER p5b4_cases_updated_at BEFORE UPDATE ON public.p5_batch4_execution_cases
  FOR EACH ROW EXECUTE FUNCTION public.p5b4_set_updated_at();
CREATE INDEX idx_p5b4_cases_process ON public.p5_batch4_execution_cases(process_type);
CREATE INDEX idx_p5b4_cases_status ON public.p5_batch4_execution_cases(execution_status);
CREATE INDEX idx_p5b4_cases_owner ON public.p5_batch4_execution_cases(owner_user_id);
CREATE INDEX idx_p5b4_cases_due ON public.p5_batch4_execution_cases(due_at);

-- ---- execution_milestones ----
GRANT SELECT ON public.p5_batch4_execution_milestones TO authenticated;
GRANT ALL ON public.p5_batch4_execution_milestones TO service_role;
ALTER TABLE public.p5_batch4_execution_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b4_milestones_admin_all" ON public.p5_batch4_execution_milestones
  FOR ALL TO authenticated
  USING (public.p5b4_is_platform_admin())
  WITH CHECK (public.p5b4_is_platform_admin());
CREATE POLICY "p5b4_milestones_owner_select" ON public.p5_batch4_execution_milestones
  FOR SELECT TO authenticated
  USING (
    case_id IN (
      SELECT id FROM public.p5_batch4_execution_cases
      WHERE owner_user_id = auth.uid() OR created_by = auth.uid()
    )
  );
CREATE TRIGGER p5b4_milestones_updated_at BEFORE UPDATE ON public.p5_batch4_execution_milestones
  FOR EACH ROW EXECUTE FUNCTION public.p5b4_set_updated_at();
CREATE INDEX idx_p5b4_milestones_case ON public.p5_batch4_execution_milestones(case_id);
CREATE INDEX idx_p5b4_milestones_status ON public.p5_batch4_execution_milestones(status);

-- ---- evidence_items ----
GRANT SELECT ON public.p5_batch4_evidence_items TO authenticated;
GRANT ALL ON public.p5_batch4_evidence_items TO service_role;
ALTER TABLE public.p5_batch4_evidence_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b4_evidence_admin_all" ON public.p5_batch4_evidence_items
  FOR ALL TO authenticated
  USING (public.p5b4_is_platform_admin())
  WITH CHECK (public.p5b4_is_platform_admin());
CREATE POLICY "p5b4_evidence_owner_select" ON public.p5_batch4_evidence_items
  FOR SELECT TO authenticated
  USING (
    case_id IN (
      SELECT id FROM public.p5_batch4_execution_cases
      WHERE owner_user_id = auth.uid() OR created_by = auth.uid()
    )
  );
CREATE TRIGGER p5b4_evidence_updated_at BEFORE UPDATE ON public.p5_batch4_evidence_items
  FOR EACH ROW EXECUTE FUNCTION public.p5b4_set_updated_at();
CREATE INDEX idx_p5b4_evidence_case ON public.p5_batch4_evidence_items(case_id);
CREATE INDEX idx_p5b4_evidence_milestone ON public.p5_batch4_evidence_items(milestone_id);
CREATE INDEX idx_p5b4_evidence_status ON public.p5_batch4_evidence_items(status);

-- ---- blockers ----
GRANT SELECT ON public.p5_batch4_blockers TO authenticated;
GRANT ALL ON public.p5_batch4_blockers TO service_role;
ALTER TABLE public.p5_batch4_blockers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b4_blockers_admin_all" ON public.p5_batch4_blockers
  FOR ALL TO authenticated
  USING (public.p5b4_is_platform_admin())
  WITH CHECK (public.p5b4_is_platform_admin());
CREATE POLICY "p5b4_blockers_owner_select" ON public.p5_batch4_blockers
  FOR SELECT TO authenticated
  USING (
    case_id IN (
      SELECT id FROM public.p5_batch4_execution_cases
      WHERE owner_user_id = auth.uid() OR created_by = auth.uid()
    )
  );
CREATE INDEX idx_p5b4_blockers_case ON public.p5_batch4_blockers(case_id);
CREATE INDEX idx_p5b4_blockers_status ON public.p5_batch4_blockers(status);
CREATE INDEX idx_p5b4_blockers_type ON public.p5_batch4_blockers(blocker_type);

-- ---- tasks ----
GRANT SELECT ON public.p5_batch4_tasks TO authenticated;
GRANT ALL ON public.p5_batch4_tasks TO service_role;
ALTER TABLE public.p5_batch4_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b4_tasks_admin_all" ON public.p5_batch4_tasks
  FOR ALL TO authenticated
  USING (public.p5b4_is_platform_admin())
  WITH CHECK (public.p5b4_is_platform_admin());
CREATE POLICY "p5b4_tasks_assignee_select" ON public.p5_batch4_tasks
  FOR SELECT TO authenticated
  USING (assigned_to_user_id = auth.uid() OR created_by = auth.uid());
CREATE TRIGGER p5b4_tasks_updated_at BEFORE UPDATE ON public.p5_batch4_tasks
  FOR EACH ROW EXECUTE FUNCTION public.p5b4_set_updated_at();
CREATE INDEX idx_p5b4_tasks_case ON public.p5_batch4_tasks(case_id);
CREATE INDEX idx_p5b4_tasks_assignee ON public.p5_batch4_tasks(assigned_to_user_id);
CREATE INDEX idx_p5b4_tasks_status ON public.p5_batch4_tasks(status);

-- ---- funder_releases ----
GRANT SELECT ON public.p5_batch4_funder_releases TO authenticated;
GRANT ALL ON public.p5_batch4_funder_releases TO service_role;
ALTER TABLE public.p5_batch4_funder_releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b4_releases_admin_all" ON public.p5_batch4_funder_releases
  FOR ALL TO authenticated
  USING (public.p5b4_is_platform_admin())
  WITH CHECK (public.p5b4_is_platform_admin());
CREATE POLICY "p5b4_releases_funder_select" ON public.p5_batch4_funder_releases
  FOR SELECT TO authenticated
  USING (
    funder_org_id = public.p5b4_current_funder_org()
    AND status <> 'revoked'
    AND access_expires_at > now()
  );
CREATE TRIGGER p5b4_releases_updated_at BEFORE UPDATE ON public.p5_batch4_funder_releases
  FOR EACH ROW EXECUTE FUNCTION public.p5b4_set_updated_at();
CREATE INDEX idx_p5b4_releases_case ON public.p5_batch4_funder_releases(case_id);
CREATE INDEX idx_p5b4_releases_funder ON public.p5_batch4_funder_releases(funder_org_id);
CREATE INDEX idx_p5b4_releases_status ON public.p5_batch4_funder_releases(status);

-- ---- finality_records (append-only at policy layer + finality lock trigger) ----
GRANT SELECT ON public.p5_batch4_finality_records TO authenticated;
GRANT ALL ON public.p5_batch4_finality_records TO service_role;
ALTER TABLE public.p5_batch4_finality_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b4_finality_admin_select" ON public.p5_batch4_finality_records
  FOR SELECT TO authenticated
  USING (public.p5b4_is_platform_admin());
CREATE POLICY "p5b4_finality_owner_select" ON public.p5_batch4_finality_records
  FOR SELECT TO authenticated
  USING (
    case_id IN (
      SELECT id FROM public.p5_batch4_execution_cases
      WHERE owner_user_id = auth.uid() OR created_by = auth.uid()
    )
  );
CREATE TRIGGER p5b4_finality_lock_update
  BEFORE UPDATE ON public.p5_batch4_finality_records
  FOR EACH ROW EXECUTE FUNCTION public.p5b4_lock_finality();
CREATE TRIGGER p5b4_finality_lock_delete
  BEFORE DELETE ON public.p5_batch4_finality_records
  FOR EACH ROW EXECUTE FUNCTION public.p5b4_lock_finality();
CREATE INDEX idx_p5b4_finality_case ON public.p5_batch4_finality_records(case_id);
CREATE INDEX idx_p5b4_finality_outcome ON public.p5_batch4_finality_records(final_outcome);

-- ---- audit_events (append-only at policy layer + block-mutation trigger) ----
GRANT SELECT ON public.p5_batch4_audit_events TO authenticated;
GRANT ALL ON public.p5_batch4_audit_events TO service_role;
ALTER TABLE public.p5_batch4_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5b4_audit_admin_select" ON public.p5_batch4_audit_events
  FOR SELECT TO authenticated
  USING (public.p5b4_is_platform_admin());
CREATE POLICY "p5b4_audit_owner_select" ON public.p5_batch4_audit_events
  FOR SELECT TO authenticated
  USING (
    case_id IN (
      SELECT id FROM public.p5_batch4_execution_cases
      WHERE owner_user_id = auth.uid() OR created_by = auth.uid()
    )
  );
CREATE TRIGGER p5b4_audit_block_update
  BEFORE UPDATE ON public.p5_batch4_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.p5b4_block_audit_mutation();
CREATE TRIGGER p5b4_audit_block_delete
  BEFORE DELETE ON public.p5_batch4_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.p5b4_block_audit_mutation();
CREATE INDEX idx_p5b4_audit_case ON public.p5_batch4_audit_events(case_id);
CREATE INDEX idx_p5b4_audit_event ON public.p5_batch4_audit_events(event_type, created_at DESC);
CREATE INDEX idx_p5b4_audit_actor ON public.p5_batch4_audit_events(actor_user_id);
