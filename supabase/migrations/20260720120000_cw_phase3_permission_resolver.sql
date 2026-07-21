-- =====================================================================
-- Izenzo Enterprise Compliance Case Management Workbench
-- Phase 3, Increment 1: compliance permission-resolution bridge
--
-- Additive-only. Does not remove or narrow any existing policy, grant,
-- or role. This migration introduces ONE authoritative set of
-- compliance-capability functions that bridge the existing role
-- sources (user_roles / app_role via has_role/is_admin/is_org_admin,
-- and the separate dd_roles system via has_dd_role) instead of adding
-- another independent role system or duplicating ad hoc role-list
-- checks the way individual Edge Functions currently do.
--
-- Mandatory rule encoded here: a Platform Administrator does NOT
-- automatically receive compliance decision-making authority. Platform
-- admins retain read/operational-assignment visibility (support and
-- ops need this), but public.cw_can_decide_case() deliberately excludes
-- platform_admin. Only a genuine compliance decision-making role
-- (Compliance Operations Lead, Legal Reviewer, Senior Compliance
-- Approver, Director) satisfies that check.
--
-- RLS write-policies for cw_* tables that consume these functions, and
-- the negative-access proof tests, land in the next two increments of
-- this same PR, per the small-reviewable-increments approach for
-- Phase 3.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Additive, idempotent app_role vocabulary needed for the Phase 3
-- capability matrix. Every label is guarded so this file is safe to
-- run against a database that may already define some of them, and
-- safe to re-run (idempotency is validated by the disposable-DB CI
-- job, which applies every migration twice).
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'compliance_analyst') THEN
    ALTER TYPE public.app_role ADD VALUE 'compliance_analyst';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'compliance_ops_lead') THEN
    ALTER TYPE public.app_role ADD VALUE 'compliance_ops_lead';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'legal_reviewer') THEN
    ALTER TYPE public.app_role ADD VALUE 'legal_reviewer';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'senior_compliance_approver') THEN
    ALTER TYPE public.app_role ADD VALUE 'senior_compliance_approver';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'director') THEN
    ALTER TYPE public.app_role ADD VALUE 'director';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'funder_viewer') THEN
    ALTER TYPE public.app_role ADD VALUE 'funder_viewer';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'security_incident_commander') THEN
    ALTER TYPE public.app_role ADD VALUE 'security_incident_commander';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'technical_support') THEN
    ALTER TYPE public.app_role ADD VALUE 'technical_support';
  END IF;
END$$;

-- ---------------------------------------------------------------------
-- 1) Thin, single-purpose bridge functions. Each one wraps an existing
-- role source; none of them introduce a new place where role data is
-- stored. All are STABLE + SECURITY DEFINER so they can be used inside
-- RLS USING/CHECK expressions without requiring the querying role to
-- hold table-level privileges on user_roles/profiles directly.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cw_is_platform_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(p_user_id, 'platform_admin'::app_role);
$$;

CREATE OR REPLACE FUNCTION public.cw_is_org_admin_for_org(p_user_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_org_id IS NOT NULL AND public.is_org_admin(p_user_id, p_org_id);
$$;

CREATE OR REPLACE FUNCTION public.cw_is_org_member(p_user_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.profiles pr WHERE pr.id = p_user_id AND pr.org_id = p_org_id
    );
$$;

CREATE OR REPLACE FUNCTION public.cw_is_compliance_analyst(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(p_user_id, 'compliance_analyst'::app_role);
$$;

-- Decision-making authority for compliance cases. Deliberately EXCLUDES
-- platform_admin and compliance_analyst: analysts investigate and
-- recommend, they do not hold final decide/approve/reject authority.
CREATE OR REPLACE FUNCTION public.cw_is_compliance_decision_maker(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(p_user_id, 'compliance_ops_lead'::app_role)
      OR public.has_role(p_user_id, 'legal_reviewer'::app_role)
      OR public.has_role(p_user_id, 'senior_compliance_approver'::app_role)
      OR public.has_role(p_user_id, 'executive_approver'::app_role)
      OR public.has_role(p_user_id, 'director'::app_role);
$$;

CREATE OR REPLACE FUNCTION public.cw_is_auditor(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(p_user_id, 'auditor'::app_role)
      OR public.has_role(p_user_id, 'auditor_read_only'::app_role);
$$;

CREATE OR REPLACE FUNCTION public.cw_is_funder_reviewer(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(p_user_id, 'funder_external_reviewer'::app_role);
$$;

CREATE OR REPLACE FUNCTION public.cw_is_funder_viewer(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- A funder reviewer is always at least a funder viewer.
  SELECT public.has_role(p_user_id, 'funder_viewer'::app_role)
      OR public.cw_is_funder_reviewer(p_user_id);
$$;

CREATE OR REPLACE FUNCTION public.cw_is_security_incident_commander(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(p_user_id, 'security_incident_commander'::app_role);
$$;

-- Support / engineering personas. This function exists so policies and
-- tests have one place to assert these personas are EXCLUDED from
-- compliance-decision and unnecessary-data access -- it is not used to
-- grant them anything in this migration.
CREATE OR REPLACE FUNCTION public.cw_is_support_or_engineering(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(p_user_id, 'technical_support'::app_role)
      OR public.has_role(p_user_id, 'developer_technical_admin'::app_role);
$$;

-- ---------------------------------------------------------------------
-- 2) Capability gates. These are the functions RLS policies and Edge
-- Functions should call -- the single authoritative surface for "can
-- this user do X on compliance cases", instead of each call site
-- re-deriving its own ad hoc role list.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cw_can_read_case(p_user_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.cw_is_platform_admin(p_user_id)
      OR public.cw_is_auditor(p_user_id)
      OR public.cw_is_compliance_analyst(p_user_id)
      OR public.cw_is_compliance_decision_maker(p_user_id)
      OR public.cw_is_org_member(p_user_id, p_org_id);
$$;

CREATE OR REPLACE FUNCTION public.cw_can_assign_case(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- Operational assignment is not a compliance decision, so platform
  -- admins and the ops-lead role may both do it.
  SELECT public.cw_is_platform_admin(p_user_id)
      OR public.has_role(p_user_id, 'compliance_ops_lead'::app_role);
$$;

-- The mandatory rule lives here: platform_admin is not part of this
-- check, by design.
CREATE OR REPLACE FUNCTION public.cw_can_decide_case(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.cw_is_compliance_decision_maker(p_user_id);
$$;

REVOKE ALL ON FUNCTION public.cw_is_platform_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cw_is_org_admin_for_org(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cw_is_org_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cw_is_compliance_analyst(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cw_is_compliance_decision_maker(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cw_is_auditor(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cw_is_funder_reviewer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cw_is_funder_viewer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cw_is_security_incident_commander(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cw_is_support_or_engineering(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cw_can_read_case(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cw_can_assign_case(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cw_can_decide_case(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.cw_is_platform_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cw_is_org_admin_for_org(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cw_is_org_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cw_is_compliance_analyst(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cw_is_compliance_decision_maker(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cw_is_auditor(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cw_is_funder_reviewer(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cw_is_funder_viewer(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cw_is_security_incident_commander(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cw_is_support_or_engineering(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cw_can_read_case(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cw_can_assign_case(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cw_can_decide_case(uuid) TO authenticated, service_role;
