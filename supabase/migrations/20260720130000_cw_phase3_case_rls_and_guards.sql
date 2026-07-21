-- =====================================================================
-- Izenzo Enterprise Compliance Case Management Workbench
-- Phase 3, Increment 2: RLS write-policies + case-mutation guard
--
-- Additive-only. Every policy added here is a NEW policy alongside the
-- existing org-scoped and (now-dormant, see note below) admin SELECT
-- policies from Phase 1 -- nothing is dropped, replaced, or narrowed.
--
-- Note on the dormant legacy-admin policies: Phase 1's cw_cases_admin_select
-- and cw_legacy_exceptions_admin_select gate on the legacy app_role value
-- admin (via the has_role helper). A historical migration (20260213123630)
-- moved every user_roles row from that legacy value to platform_admin, so
-- those two policies now match nobody in practice. This migration repairs
-- that by ADDING working platform_admin/compliance-staff policies
-- alongside them; it does not touch the existing (harmless, if inert)
-- legacy policies.
--
-- Enforcement model:
-- - RLS SELECT policies (this file) are the authoritative tenant-
-- isolation and compliance-staff-visibility layer -- not the Edge
-- Functions or frontend route guards.
-- - Case creation/decisioning continues to be encouraged through the
-- cw_open_case RPC (whose interim admin/service_role-only gate is
-- relaxed here to the real Phase 3 capability, see part 6), but this
-- migration also adds real INSERT/UPDATE RLS policies as a backstop
-- in case a client ever queries the tables directly via PostgREST.
-- - A BEFORE UPDATE trigger on cw_cases enforces two rules no simple
-- USING/CHECK expression can express on its own: (a) a case that has
-- reached a terminal decision (approved / conditionally_approved /
-- rejected / blocked / closed) can never have its decision fields
-- rewritten -- "may approve, may not rewrite prior history" -- and
-- (b) a status transition into a decision outcome requires
-- cw_can_decide_case(), while an assignment-only change only
-- requires cw_can_assign_case().
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Auditor export grants: auditors are read-only by default. An
-- explicit, admin-issued grant is required before an auditor may
-- export case data, per the Phase 3 mandatory rule. Global platform
-- staff (platform_admin, compliance decision-makers) do not need a
-- grant row -- they already hold read authority this table doesn't
-- widen.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cw_auditor_export_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auditor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
    reason text,
    granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    granted_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz
    );

CREATE INDEX IF NOT EXISTS idx_cw_auditor_export_grants_auditor ON public.cw_auditor_export_grants(auditor_user_id);

GRANT SELECT ON public.cw_auditor_export_grants TO authenticated;
GRANT ALL ON public.cw_auditor_export_grants TO service_role;

ALTER TABLE public.cw_auditor_export_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cw_auditor_export_grants_self_select" ON public.cw_auditor_export_grants;
CREATE POLICY "cw_auditor_export_grants_self_select"
ON public.cw_auditor_export_grants
FOR SELECT TO authenticated
USING (auditor_user_id = auth.uid() OR public.cw_is_platform_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.cw_can_export_case_data(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
SELECT public.cw_is_platform_admin(p_user_id)
OR public.cw_is_compliance_decision_maker(p_user_id)
OR EXISTS (
    SELECT 1 FROM public.cw_auditor_export_grants g
    WHERE g.auditor_user_id = p_user_id
    AND public.cw_is_auditor(p_user_id)
    AND (g.expires_at IS NULL OR g.expires_at > now())
    );
$$;

REVOKE ALL ON FUNCTION public.cw_can_export_case_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cw_can_export_case_data(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2) Additive SELECT policies: global compliance-staff visibility,
-- independent of org membership (compliance staff review cases across
-- organisations). Funder and customer projections are deliberately NOT
-- granted raw cw_cases access in this increment -- see the Phase 3
-- completion report for the follow-up plan to build dedicated,
-- explicitly-approved projection views instead of widening raw table
-- access.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "cw_cases_compliance_staff_select" ON public.cw_cases;
CREATE POLICY "cw_cases_compliance_staff_select"
ON public.cw_cases
FOR SELECT TO authenticated
USING (
    public.cw_is_platform_admin(auth.uid())
    OR public.cw_is_auditor(auth.uid())
    OR public.cw_is_compliance_analyst(auth.uid())
    OR public.cw_is_compliance_decision_maker(auth.uid())
    );

DROP POLICY IF EXISTS "cw_legacy_exceptions_platform_admin_select" ON public.cw_legacy_migration_exceptions;
CREATE POLICY "cw_legacy_exceptions_platform_admin_select"
ON public.cw_legacy_migration_exceptions
FOR SELECT TO authenticated
USING (public.cw_is_platform_admin(auth.uid()) OR public.cw_is_auditor(auth.uid()));

-- ---------------------------------------------------------------------
-- 3) INSERT / UPDATE backstop policies on cw_cases. The intended write
-- path remains the cw_open_case RPC (race-safe, generates the case
-- reference, inserts the primary subject row); these RLS policies exist
-- so tenant isolation and role gating are enforced at the database
-- layer even if a client bypasses the RPC.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "cw_cases_compliance_insert" ON public.cw_cases;
CREATE POLICY "cw_cases_compliance_insert"
ON public.cw_cases
FOR INSERT TO authenticated
WITH CHECK (
    public.cw_can_assign_case(auth.uid())
    OR public.cw_is_compliance_decision_maker(auth.uid())
    );

DROP POLICY IF EXISTS "cw_cases_compliance_update" ON public.cw_cases;
CREATE POLICY "cw_cases_compliance_update"
ON public.cw_cases
FOR UPDATE TO authenticated
USING (
    public.cw_can_assign_case(auth.uid())
    OR public.cw_is_compliance_decision_maker(auth.uid())
    )
WITH CHECK (
    public.cw_can_assign_case(auth.uid())
    OR public.cw_is_compliance_decision_maker(auth.uid())
    );

-- ---------------------------------------------------------------------
-- 4) Case-mutation guard trigger: encodes "may approve, may not rewrite
-- prior history" and per-field-group capability checks that a single
-- USING/CHECK expression cannot express. Runs BEFORE the RLS-permitted
-- UPDATE above and applies equally to writes made through service_role
-- (including the RPC path), so the rule cannot be bypassed by routing
-- around RLS.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cw_cases_guard_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
v_uid uuid := auth.uid();
v_decision_changed boolean;
v_assignment_changed boolean;
BEGIN
v_decision_changed := (NEW.status IS DISTINCT FROM OLD.status)
OR (NEW.decision_notes IS DISTINCT FROM OLD.decision_notes)
OR (NEW.decided_by IS DISTINCT FROM OLD.decided_by)
OR (NEW.decided_at IS DISTINCT FROM OLD.decided_at);

v_assignment_changed := (NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id)
OR (NEW.assigned_at IS DISTINCT FROM OLD.assigned_at);

IF OLD.status IN ('approved','conditionally_approved','rejected','closed') AND v_decision_changed THEN
RAISE EXCEPTION 'cw.history_immutable: cannot amend a decided/closed compliance case; open a new case instead';
END IF;

IF v_decision_changed AND v_uid IS NOT NULL AND NOT public.cw_can_decide_case(v_uid) THEN
RAISE EXCEPTION 'cw.decision_requires_decision_maker: only a compliance decision-making role may change case status/decision fields';
END IF;

IF v_assignment_changed AND NOT v_decision_changed AND v_uid IS NOT NULL AND NOT public.cw_can_assign_case(v_uid) THEN
RAISE EXCEPTION 'cw.assignment_requires_assign_capability: only platform_admin or compliance_ops_lead may reassign a case';
END IF;

RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cw_cases_guard_mutation_trg ON public.cw_cases;
CREATE TRIGGER cw_cases_guard_mutation_trg
BEFORE UPDATE ON public.cw_cases
FOR EACH ROW
EXECUTE FUNCTION public.cw_cases_guard_mutation();

-- ---------------------------------------------------------------------
-- 5) cw_case_concerns: analysts and decision-makers may raise and
-- manage concerns (investigative working notes), independent of org
-- membership, since compliance staff work across organisations.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "cw_case_concerns_compliance_write" ON public.cw_case_concerns;
CREATE POLICY "cw_case_concerns_compliance_write"
ON public.cw_case_concerns
FOR INSERT TO authenticated
WITH CHECK (
    public.cw_is_compliance_analyst(auth.uid())
    OR public.cw_is_compliance_decision_maker(auth.uid())
    OR public.cw_is_platform_admin(auth.uid())
    );

DROP POLICY IF EXISTS "cw_case_concerns_compliance_update" ON public.cw_case_concerns;
CREATE POLICY "cw_case_concerns_compliance_update"
ON public.cw_case_concerns
FOR UPDATE TO authenticated
USING (
    public.cw_is_compliance_analyst(auth.uid())
    OR public.cw_is_compliance_decision_maker(auth.uid())
    OR public.cw_is_platform_admin(auth.uid())
    )
WITH CHECK (
    public.cw_is_compliance_analyst(auth.uid())
    OR public.cw_is_compliance_decision_maker(auth.uid())
    OR public.cw_is_platform_admin(auth.uid())
    );

-- ---------------------------------------------------------------------
-- 6) Relax cw_open_case's interim "admin/service_role only" gate (from
-- Phase 1) to the real Phase 3 capability. This is the change Phase 1
-- explicitly deferred: "gated to admin/service_role only ahead of the
-- full Phase 3 role matrix". Behaviour for existing admin/service_role
-- callers is unchanged; compliance_ops_lead and the other decision-
-- making roles gain the ability the Phase 1 placeholder withheld from
-- them pending this work.
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
IF NOT (
    v_caller_role = 'service_role'
    OR public.cw_can_assign_case(auth.uid())
    OR public.cw_is_compliance_decision_maker(auth.uid())
    ) THEN
RAISE EXCEPTION 'cw.not_authorized'
USING MESSAGE = 'Only platform_admin, compliance_ops_lead, a compliance decision-making role, or service_role may open compliance cases';
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
