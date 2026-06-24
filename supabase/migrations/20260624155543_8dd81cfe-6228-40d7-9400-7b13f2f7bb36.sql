
-- P-5 BATCH 1 — Stage 1 (retry; fix profiles.org_id column name)

-- 1. Extend app_role enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'executive_approver') THEN
    ALTER TYPE public.app_role ADD VALUE 'executive_approver'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'governance_reviewer') THEN
    ALTER TYPE public.app_role ADD VALUE 'governance_reviewer'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'operator_case_manager') THEN
    ALTER TYPE public.app_role ADD VALUE 'operator_case_manager'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'developer_technical_admin') THEN
    ALTER TYPE public.app_role ADD VALUE 'developer_technical_admin'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'customer_entity_owner') THEN
    ALTER TYPE public.app_role ADD VALUE 'customer_entity_owner'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'funder_external_reviewer') THEN
    ALTER TYPE public.app_role ADD VALUE 'funder_external_reviewer'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'auditor_read_only') THEN
    ALTER TYPE public.app_role ADD VALUE 'auditor_read_only'; END IF;
END$$;

-- 2. P-5 enums
DO $$ BEGIN
  CREATE TYPE public.p5_status AS ENUM (
    'not_started','incomplete','submitted','under_review','more_information_required',
    'internally_ready','provider_dependent','conditional_ready','ready_to_proceed',
    'on_hold','blocked','escalated','rejected','waived','override_approved',
    'reopened','archived_superseded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.p5_provider_status AS ENUM (
    'not_live','credentials_pending','pending','timeout','inconclusive','failed','passed','not_applicable'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.p5_rule_severity AS ENUM ('hard_blocker','warning');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.p5_actor_type AS ENUM ('user','system','api','provider');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.p5_reason_code AS ENUM (
    'missing_evidence','incomplete_evidence','illegible_evidence','wrong_document',
    'expired_evidence','evidence_expiring_soon','does_not_match_entity',
    'does_not_match_director_ubo','does_not_match_transaction_project',
    'missing_signature','missing_authority_to_act','missing_mandate','missing_consent',
    'terms_nda_not_accepted','manual_review_required','approved_by_reviewer',
    'approved_by_admin','rejected_by_reviewer','compliance_hold_applied',
    'compliance_hold_released','governance_hold_applied','provider_not_live',
    'provider_credentials_pending','provider_pending','provider_timeout',
    'provider_inconclusive','provider_failed','provider_result_received',
    'provider_result_conflict','risk_flag','high_risk_escalation',
    'sanctions_pep_adverse_result_review','identity_verification_issue',
    'company_verification_issue','bank_detail_verification_issue',
    'payment_confirmation_issue','amount_currency_mismatch','duplicate_notification',
    'refund_finality_pending','audit_trail_issue','tamper_evidence_issue',
    'data_mismatch','counterparty_changed','project_scope_changed','waiver_granted',
    'override_approved','overdue_sla','disputed_decision','archived_superseded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Helper
CREATE OR REPLACE FUNCTION public.p5_has_any_role(_user_id uuid, _roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role::text = ANY(_roles));
$$;

-- 4. Cases
CREATE TABLE IF NOT EXISTS public.p5_governance_readiness_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id          uuid REFERENCES public.entities(id) ON DELETE SET NULL,
  organization_id    uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  counterparty_id    uuid REFERENCES public.counterparties(id) ON DELETE SET NULL,
  match_id           uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  programme_id       uuid REFERENCES public.programmes(id) ON DELETE SET NULL,
  trade_request_id   uuid REFERENCES public.trade_requests(id) ON DELETE SET NULL,
  governance_status   public.p5_status NOT NULL DEFAULT 'not_started',
  compliance_status   public.p5_status NOT NULL DEFAULT 'not_started',
  readiness_status    public.p5_status NOT NULL DEFAULT 'not_started',
  evidence_status     public.p5_status,
  blocker_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  provider_dependency      boolean NOT NULL DEFAULT false,
  provider_dependency_type text,
  provider_status          public.p5_provider_status,
  provider_last_checked_at timestamptz,
  next_action      text,
  next_owner_type  text,
  owner_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason_codes public.p5_reason_code[] NOT NULL DEFAULT '{}',
  is_on_hold        boolean NOT NULL DEFAULT false,
  hold_type         text,
  hold_reason_code  public.p5_reason_code,
  hold_owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  hold_review_date  date,
  is_escalated         boolean NOT NULL DEFAULT false,
  escalation_reason_code public.p5_reason_code,
  escalation_owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  escalated_at         timestamptz,
  sla_due_at           timestamptz,
  waiver_active       boolean NOT NULL DEFAULT false,
  waiver_reason_code  public.p5_reason_code,
  waiver_scope        text,
  waiver_expires_at   timestamptz,
  waiver_approved_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  override_active       boolean NOT NULL DEFAULT false,
  override_reason_code  public.p5_reason_code,
  override_scope        text,
  override_expires_at   timestamptz,
  override_approved_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_updated_at     timestamptz NOT NULL DEFAULT now(),
  status_changed_at   timestamptz NOT NULL DEFAULT now(),
  audit_reference         text,
  decision_reference      text,
  evidence_pack_id        uuid,
  evidence_summary_id     uuid,
  hash_chain_reference    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  archived_at timestamptz
);

CREATE OR REPLACE FUNCTION public.p5_cases_require_subject()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.entity_id IS NULL AND NEW.organization_id IS NULL AND NEW.counterparty_id IS NULL
     AND NEW.match_id IS NULL AND NEW.programme_id IS NULL AND NEW.trade_request_id IS NULL THEN
    RAISE EXCEPTION 'p5_governance_readiness_cases requires at least one subject foreign key';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS p5_cases_subject_required ON public.p5_governance_readiness_cases;
CREATE TRIGGER p5_cases_subject_required BEFORE INSERT OR UPDATE ON public.p5_governance_readiness_cases
  FOR EACH ROW EXECUTE FUNCTION public.p5_cases_require_subject();

CREATE INDEX IF NOT EXISTS idx_p5_cases_org      ON public.p5_governance_readiness_cases(organization_id);
CREATE INDEX IF NOT EXISTS idx_p5_cases_entity   ON public.p5_governance_readiness_cases(entity_id);
CREATE INDEX IF NOT EXISTS idx_p5_cases_match    ON public.p5_governance_readiness_cases(match_id);
CREATE INDEX IF NOT EXISTS idx_p5_cases_cp       ON public.p5_governance_readiness_cases(counterparty_id);
CREATE INDEX IF NOT EXISTS idx_p5_cases_prog     ON public.p5_governance_readiness_cases(programme_id);
CREATE INDEX IF NOT EXISTS idx_p5_cases_tr       ON public.p5_governance_readiness_cases(trade_request_id);
CREATE INDEX IF NOT EXISTS idx_p5_cases_readiness ON public.p5_governance_readiness_cases(readiness_status);
CREATE INDEX IF NOT EXISTS idx_p5_cases_owner    ON public.p5_governance_readiness_cases(owner_user_id);

-- 5. Evidence items
CREATE TABLE IF NOT EXISTS public.p5_governance_evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.p5_governance_readiness_cases(id) ON DELETE CASCADE,
  evidence_type text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  status public.p5_status NOT NULL DEFAULT 'not_started',
  uploaded_file_id uuid,
  evidence_version integer NOT NULL DEFAULT 1,
  expiry_date date,
  rejection_reason_code public.p5_reason_code,
  reviewer_note text,
  customer_safe_note text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p5_evidence_case ON public.p5_governance_evidence_items(case_id);

-- 6. Audit events (append-only)
CREATE TABLE IF NOT EXISTS public.p5_governance_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.p5_governance_readiness_cases(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_type public.p5_actor_type NOT NULL,
  previous_status public.p5_status,
  new_status public.p5_status,
  reason_code public.p5_reason_code,
  note text,
  evidence_item_id uuid REFERENCES public.p5_governance_evidence_items(id) ON DELETE SET NULL,
  provider_reference text,
  correlation_id text,
  api_request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p5_audit_case ON public.p5_governance_audit_events(case_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.p5_audit_block_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'p5_governance_audit_events is append-only; % is not permitted', TG_OP;
END $$;

DROP TRIGGER IF EXISTS p5_audit_no_update ON public.p5_governance_audit_events;
CREATE TRIGGER p5_audit_no_update BEFORE UPDATE ON public.p5_governance_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.p5_audit_block_mutation();
DROP TRIGGER IF EXISTS p5_audit_no_delete ON public.p5_governance_audit_events;
CREATE TRIGGER p5_audit_no_delete BEFORE DELETE ON public.p5_governance_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.p5_audit_block_mutation();

-- 7. updated_at trigger
CREATE OR REPLACE FUNCTION public.p5_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS p5_cases_touch ON public.p5_governance_readiness_cases;
CREATE TRIGGER p5_cases_touch BEFORE UPDATE ON public.p5_governance_readiness_cases
  FOR EACH ROW EXECUTE FUNCTION public.p5_touch_updated_at();
DROP TRIGGER IF EXISTS p5_evidence_touch ON public.p5_governance_evidence_items;
CREATE TRIGGER p5_evidence_touch BEFORE UPDATE ON public.p5_governance_evidence_items
  FOR EACH ROW EXECUTE FUNCTION public.p5_touch_updated_at();

-- 8. GRANTs
GRANT SELECT ON public.p5_governance_readiness_cases TO authenticated;
GRANT ALL    ON public.p5_governance_readiness_cases TO service_role;
GRANT SELECT ON public.p5_governance_evidence_items TO authenticated;
GRANT ALL    ON public.p5_governance_evidence_items TO service_role;
GRANT SELECT ON public.p5_governance_audit_events TO authenticated;
GRANT INSERT, SELECT ON public.p5_governance_audit_events TO service_role;

-- 9. RLS
ALTER TABLE public.p5_governance_readiness_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p5_governance_evidence_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p5_governance_audit_events    ENABLE ROW LEVEL SECURITY;

CREATE POLICY p5_cases_privileged_read ON public.p5_governance_readiness_cases
  FOR SELECT TO authenticated
  USING (public.p5_has_any_role(auth.uid(), ARRAY[
    'platform_admin','executive_approver','compliance_analyst','governance_reviewer',
    'operator_case_manager','auditor','auditor_read_only','developer_technical_admin']));

CREATE POLICY p5_cases_org_read ON public.p5_governance_readiness_cases
  FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND organization_id IN (
    SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()));

CREATE POLICY p5_evidence_read ON public.p5_governance_evidence_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.p5_governance_readiness_cases c
    WHERE c.id = case_id AND (
      public.p5_has_any_role(auth.uid(), ARRAY[
        'platform_admin','executive_approver','compliance_analyst','governance_reviewer',
        'operator_case_manager','auditor','auditor_read_only','developer_technical_admin'])
      OR (c.organization_id IS NOT NULL AND c.organization_id IN (
        SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())))));

CREATE POLICY p5_audit_read ON public.p5_governance_audit_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.p5_governance_readiness_cases c
    WHERE c.id = case_id AND (
      public.p5_has_any_role(auth.uid(), ARRAY[
        'platform_admin','executive_approver','compliance_analyst','governance_reviewer',
        'operator_case_manager','auditor','auditor_read_only','developer_technical_admin'])
      OR (c.organization_id IS NOT NULL AND c.organization_id IN (
        SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())))));
