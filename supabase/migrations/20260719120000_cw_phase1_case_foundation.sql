-- =====================================================================
-- Izenzo Enterprise Compliance Case Management Workbench
-- Phase 1: Canonical compliance-case aggregate
--
-- Additive-only. Does not alter or remove public.compliance_cases or any
-- existing reader/writer of that table. New cw_* tables run in parallel
-- until a dedicated, separately-reviewed cutover batch switches live
-- readers over. See src/lib/compliance-workbench/types.ts for the
-- frontend contract this schema is designed to back.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Case reference generator: server-side, collision-protected,
-- human-readable, immutable once assigned. Format: IZ-CMP-YYYY-NNNNNN
-- ---------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.cw_case_reference_seq;

CREATE OR REPLACE FUNCTION public.cw_generate_case_reference()
RETURNS text
LANGUAGE sql
AS $$
  SELECT 'IZ-CMP-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.cw_case_reference_seq')::text, 6, '0');
$$;

-- ---------------------------------------------------------------------
-- 1) cw_cases: canonical case aggregate
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cw_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE DEFAULT public.cw_generate_case_reference(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  case_type text NOT NULL CHECK (case_type IN (
    'organisation_onboarding_review',
    'individual_idv_review',
    'ubo_director_review',
    'sanctions_review',
    'evidence_remediation',
    'periodic_refresh',
    'transaction_compliance_review',
    'authority_to_bind_review',
    'pep_adverse_media_review',
    'funder_required_review',
    'manual_override_review',
    'hold_release_review'
  )),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','submitted','assigned','in_review','awaiting_customer',
    'awaiting_provider','awaiting_approval','approved',
    'conditionally_approved','rejected','blocked','suspended',
    'closed','reopened'
  )),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  risk_band text CHECK (risk_band IN ('low','medium','high','critical')),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  primary_subject_kind text NOT NULL CHECK (primary_subject_kind IN (
    'organisation','entity','individual','director','ubo','counterparty',
    'transaction','poi','wad','payment_account'
  )),
  primary_subject_ref_id uuid NOT NULL,
  submitted_at timestamptz,
  assigned_at timestamptz,
  review_started_at timestamptz,
  decided_at timestamptz,
  closed_at timestamptz,
  reopened_at timestamptz,
  next_review_at timestamptz,
  sla_target_at timestamptz,
  sla_breached boolean NOT NULL DEFAULT false,
  sla_warning boolean NOT NULL DEFAULT false,
  source_trigger text,
  legacy_case_id uuid REFERENCES public.compliance_cases(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Database-enforced active-case rule: one non-terminal case per subject
-- per case type. Historical (terminal) cases are excluded so the same
-- subject/type may be reopened later as a brand new row.
CREATE UNIQUE INDEX IF NOT EXISTS cw_cases_active_unique_idx
  ON public.cw_cases (org_id, primary_subject_kind, primary_subject_ref_id, case_type)
  WHERE status NOT IN ('approved','rejected','closed');

CREATE INDEX IF NOT EXISTS idx_cw_cases_org ON public.cw_cases(org_id);
CREATE INDEX IF NOT EXISTS idx_cw_cases_status ON public.cw_cases(status);
CREATE INDEX IF NOT EXISTS idx_cw_cases_legacy ON public.cw_cases(legacy_case_id);

CREATE OR REPLACE FUNCTION public.cw_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cw_cases_set_updated_at ON public.cw_cases;
CREATE TRIGGER cw_cases_set_updated_at
  BEFORE UPDATE ON public.cw_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.cw_set_updated_at();

GRANT SELECT ON public.cw_cases TO authenticated;
GRANT ALL ON public.cw_cases TO service_role;

ALTER TABLE public.cw_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cw_cases_org_select" ON public.cw_cases;
CREATE POLICY "cw_cases_org_select"
ON public.cw_cases
FOR SELECT TO authenticated
USING (org_id IN (SELECT profiles.org_id FROM public.profiles WHERE profiles.id = auth.uid()));

DROP POLICY IF EXISTS "cw_cases_admin_select" ON public.cw_cases;
CREATE POLICY "cw_cases_admin_select"
ON public.cw_cases
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'platform_admin'::app_role));

-- ---------------------------------------------------------------------
-- 2) cw_case_subjects: multi-subject support, one enforced primary
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cw_case_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cw_cases(id) ON DELETE CASCADE,
  subject_kind text NOT NULL CHECK (subject_kind IN (
    'organisation','entity','individual','director','ubo','counterparty',
    'transaction','poi','wad','payment_account'
  )),
  subject_ref_id uuid NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cw_case_subjects_primary_unique_idx
  ON public.cw_case_subjects (case_id)
  WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_cw_case_subjects_case ON public.cw_case_subjects(case_id);
CREATE INDEX IF NOT EXISTS idx_cw_case_subjects_ref ON public.cw_case_subjects(subject_kind, subject_ref_id);

GRANT SELECT ON public.cw_case_subjects TO authenticated;
GRANT ALL ON public.cw_case_subjects TO service_role;

ALTER TABLE public.cw_case_subjects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cw_case_subjects_visible_via_case" ON public.cw_case_subjects;
CREATE POLICY "cw_case_subjects_visible_via_case"
ON public.cw_case_subjects
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.cw_cases c
  WHERE c.id = cw_case_subjects.case_id
    AND (
      c.org_id IN (SELECT profiles.org_id FROM public.profiles WHERE profiles.id = auth.uid())
      OR has_role(auth.uid(), 'platform_admin'::app_role)
    )
));

-- ---------------------------------------------------------------------
-- 3) cw_case_related_records: generic typed links to other domain rows
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cw_case_related_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cw_cases(id) ON DELETE CASCADE,
  record_table text NOT NULL,
  record_id uuid NOT NULL,
  relationship text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, record_table, record_id)
);

CREATE INDEX IF NOT EXISTS idx_cw_case_related_case ON public.cw_case_related_records(case_id);
CREATE INDEX IF NOT EXISTS idx_cw_case_related_record ON public.cw_case_related_records(record_table, record_id);

GRANT SELECT ON public.cw_case_related_records TO authenticated;
GRANT ALL ON public.cw_case_related_records TO service_role;

ALTER TABLE public.cw_case_related_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cw_case_related_records_visible_via_case" ON public.cw_case_related_records;
CREATE POLICY "cw_case_related_records_visible_via_case"
ON public.cw_case_related_records
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.cw_cases c
  WHERE c.id = cw_case_related_records.case_id
    AND (
      c.org_id IN (SELECT profiles.org_id FROM public.profiles WHERE profiles.id = auth.uid())
      OR has_role(auth.uid(), 'platform_admin'::app_role)
    )
));

-- ---------------------------------------------------------------------
-- 4) cw_case_concerns: multiple concerns of the same type within one
-- active case (tasks / linked concerns / RFIs live on top of this)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cw_case_concerns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cw_cases(id) ON DELETE CASCADE,
  concern_type text NOT NULL,
  source_event text,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved','dismissed')),
  description text,
  related_provider_result_id uuid,
  related_evidence_id uuid,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cw_case_concerns_case ON public.cw_case_concerns(case_id);

GRANT SELECT ON public.cw_case_concerns TO authenticated;
GRANT ALL ON public.cw_case_concerns TO service_role;

ALTER TABLE public.cw_case_concerns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cw_case_concerns_visible_via_case" ON public.cw_case_concerns;
CREATE POLICY "cw_case_concerns_visible_via_case"
ON public.cw_case_concerns
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.cw_cases c
  WHERE c.id = cw_case_concerns.case_id
    AND (
      c.org_id IN (SELECT profiles.org_id FROM public.profiles WHERE profiles.id = auth.uid())
      OR has_role(auth.uid(), 'platform_admin'::app_role)
    )
));

-- ---------------------------------------------------------------------
-- 5) cw_legacy_migration_exceptions: reconciliation log for legacy rows
-- that collide with the new active-case uniqueness rule during backfill.
-- Nothing is silently dropped; every skipped legacy row is recorded here.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cw_legacy_migration_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_case_id uuid NOT NULL REFERENCES public.compliance_cases(id) ON DELETE CASCADE,
  reason text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.cw_legacy_migration_exceptions TO authenticated;
GRANT ALL ON public.cw_legacy_migration_exceptions TO service_role;

ALTER TABLE public.cw_legacy_migration_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cw_legacy_exceptions_admin_select" ON public.cw_legacy_migration_exceptions;
CREATE POLICY "cw_legacy_exceptions_admin_select"
ON public.cw_legacy_migration_exceptions
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'platform_admin'::app_role));

-- ---------------------------------------------------------------------
-- 6) cw_open_case: transactional, race-safe case opening RPC.
-- Conservative interim posture: gated to admin/service_role only ahead
-- of the full Phase 3 role matrix. All table mutation is forced through
-- RPCs; no direct client INSERT/UPDATE policy exists yet on cw_cases.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cw_open_case(
  p_org_id uuid,
  p_case_type text,
  p_primary_subject_kind text,
  p_primary_subject_ref_id uuid,
  p_source_trigger text DEFAULT NULL,
  p_priority text DEFAULT 'normal'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_case_id uuid;
  v_caller_role text := auth.jwt() ->> 'role';
BEGIN
  IF NOT (has_role(auth.uid(), 'platform_admin'::app_role) OR v_caller_role = 'service_role') THEN
    RAISE EXCEPTION 'cw.not_authorized'
      USING MESSAGE = 'Only admin or service_role may open compliance cases in this phase';
  END IF;

  BEGIN
    INSERT INTO public.cw_cases (
      org_id, case_type, priority, primary_subject_kind, primary_subject_ref_id,
      source_trigger, created_by, updated_by
    ) VALUES (
      p_org_id, p_case_type, p_priority, p_primary_subject_kind, p_primary_subject_ref_id,
      p_source_trigger, auth.uid(), auth.uid()
    )
    RETURNING id INTO v_case_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'cw.active_case_exists'
      USING MESSAGE = 'An active case already exists for this subject and case type';
  END;

  INSERT INTO public.cw_case_subjects (case_id, subject_kind, subject_ref_id, is_primary)
  VALUES (v_case_id, p_primary_subject_kind, p_primary_subject_ref_id, true);

  RETURN v_case_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cw_open_case(uuid, text, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cw_open_case(uuid, text, text, uuid, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7) Legacy backfill (idempotent). Purely additive: does not delete or
-- alter public.compliance_cases. Assumption flagged for the completion
-- report: legacy rows are backfilled as case_type =
-- 'organisation_onboarding_review' because the legacy table carries no
-- case-type distinction of its own.
-- ---------------------------------------------------------------------
INSERT INTO public.cw_cases (
  org_id, case_type, status, primary_subject_kind, primary_subject_ref_id,
  decided_at, created_at, legacy_case_id
)
SELECT
  lc.org_id,
  'organisation_onboarding_review',
  CASE lc.status
    WHEN 'OPEN' THEN 'draft'
    WHEN 'SUBMITTED' THEN 'submitted'
    WHEN 'IN_REVIEW' THEN 'in_review'
    WHEN 'APPROVED' THEN 'approved'
    WHEN 'REJECTED' THEN 'rejected'
    WHEN 'SUSPENDED' THEN 'suspended'
    ELSE 'draft'
  END,
  'entity',
  lc.entity_id,
  lc.decided_at,
  lc.created_at,
  lc.id
FROM public.compliance_cases lc
WHERE NOT EXISTS (
  SELECT 1 FROM public.cw_cases nc WHERE nc.legacy_case_id = lc.id
)
ON CONFLICT DO NOTHING;

INSERT INTO public.cw_legacy_migration_exceptions (legacy_case_id, reason, detail)
SELECT
  lc.id,
  'active_case_conflict_on_backfill',
  jsonb_build_object('org_id', lc.org_id, 'entity_id', lc.entity_id, 'status', lc.status)
FROM public.compliance_cases lc
WHERE NOT EXISTS (SELECT 1 FROM public.cw_cases nc WHERE nc.legacy_case_id = lc.id)
  AND EXISTS (
    SELECT 1 FROM public.cw_cases nc
    WHERE nc.org_id = lc.org_id
      AND nc.primary_subject_kind = 'entity'
      AND nc.primary_subject_ref_id = lc.entity_id
      AND nc.case_type = 'organisation_onboarding_review'
      AND nc.status NOT IN ('approved','rejected','closed')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.cw_legacy_migration_exceptions ex WHERE ex.legacy_case_id = lc.id
  );
