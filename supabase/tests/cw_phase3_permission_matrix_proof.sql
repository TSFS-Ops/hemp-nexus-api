-- ============================================================
-- Izenzo Enterprise Compliance Case Management Workbench
-- Phase 3 -- Database-native negative-access / permission-matrix proof.
--
-- Companion to src/tests/cw-phase3-permission-resolver.test.ts, which
-- checks the migration SOURCE (static). This file checks LIVE BEHAVIOUR
-- against a migrated, isolated database, following the same convention
-- as supabase/tests/phase_1a_support_behavioural_proof.sql: everything
-- runs inside one transaction that ROLLS BACK at the end, so no rows
-- persist. Do NOT run against production customer data.
--
-- Execution
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
-- -f supabase/tests/cw_phase3_permission_matrix_proof.sql
--
-- Environment
-- DATABASE_URL must point at an isolated database migrated with every
-- Phase 1-3 Compliance Workbench migration applied, including:
-- 20260719120000_cw_phase1_case_foundation.sql
-- 20260720120000_cw_phase3_permission_resolver.sql
-- 20260720130000_cw_phase3_case_rls_and_guards.sql
--
-- What this proves
-- 1 Cross-tenant denial: an Org B member cannot see an Org A case.
-- 2 Org member / Org Administrator ordinary visibility (org-scoped).
-- 3 Compliance-staff cross-org visibility: analyst, decision-maker,
-- auditor and platform_admin all see cases regardless of org
-- membership (compliance staff work across organisations).
-- 4 Funder and support/engineering personas get ZERO raw cw_cases
-- access in this increment (dedicated projection views are a
-- follow-up; see the Increment 2 migration note).
-- 5 Decision-authority matrix: cw_can_decide_case is true only for
-- compliance_ops_lead / legal_reviewer / senior_compliance_approver
-- / director, and explicitly false for platform_admin and for
-- compliance_analyst.
-- 6 Assignment authority matrix: cw_can_assign_case is true for
-- platform_admin / compliance_ops_lead only.
-- 7 A capability-holder attempting the WRONG kind of change is still
-- blocked by the cw_cases_guard_mutation trigger (e.g. an assign-
-- only actor changing a decision field), even though blanket RLS
-- already let the UPDATE through.
-- 8 An actor with neither capability is blocked by RLS itself (the
-- UPDATE affects zero rows; the row is provably unchanged).
-- 9 History immutability: once a case reaches a terminal decision
-- status, its decision fields can never be amended again.
-- 10 Auditor export requires an explicit, org-scoped grant; platform
-- admins and decision-makers do not need one.
-- 11 Anon has no access at all.
--
-- Out of scope for this increment (tracked, not silently skipped):
-- customer-vs-internal FIELD-level separation on cw_cases (e.g.
-- hiding decision_notes from an ordinary org member) requires a
-- dedicated projection view and is explicitly deferred to that
-- follow-up per the Increment 2 migration's own docstring -- this
-- proof does not claim to cover it.
-- ============================================================

\set ON_ERROR_STOP on

BEGIN;

-- Guard: never run this against a database that looks like production.
DO $$
BEGIN
IF current_database() ILIKE '%prod%' THEN
RAISE EXCEPTION 'cw_phase3_permission_matrix_proof: refusing to run against database %', current_database();
END IF;
END $$;

-- ---------------------------------------------------------
-- 0. Fixture setup (service-role context)
-- ---------------------------------------------------------
DO $$ BEGIN
PERFORM set_config('cwp3.org_a', gen_random_uuid()::text, true);
PERFORM set_config('cwp3.org_b', gen_random_uuid()::text, true);
PERFORM set_config('cwp3.user_a_member', gen_random_uuid()::text, true);
PERFORM set_config('cwp3.user_a_admin', gen_random_uuid()::text, true);
PERFORM set_config('cwp3.user_b_member', gen_random_uuid()::text, true);
PERFORM set_config('cwp3.user_analyst', gen_random_uuid()::text, true);
PERFORM set_config('cwp3.user_ops_lead', gen_random_uuid()::text, true);
PERFORM set_config('cwp3.user_approver', gen_random_uuid()::text, true);
PERFORM set_config('cwp3.user_auditor', gen_random_uuid()::text, true);
PERFORM set_config('cwp3.user_platform_admin', gen_random_uuid()::text, true);
PERFORM set_config('cwp3.user_funder', gen_random_uuid()::text, true);
PERFORM set_config('cwp3.user_support', gen_random_uuid()::text, true);
END $$;

INSERT INTO auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at)
SELECT current_setting('cwp3.' || u)::uuid, u || '@cwp3.test', 'authenticated','authenticated', now(), now(), now()
FROM unnest(ARRAY['user_a_member','user_a_admin','user_b_member','user_analyst','user_ops_lead',
  'user_approver','user_auditor','user_platform_admin','user_funder','user_support']) AS u;

INSERT INTO public.organizations (id, name, created_at, updated_at)
VALUES
(current_setting('cwp3.org_a')::uuid, 'CWP3 Org A', now(), now()),
(current_setting('cwp3.org_b')::uuid, 'CWP3 Org B', now(), now());

INSERT INTO public.profiles (id, org_id, created_at, updated_at)
VALUES
(current_setting('cwp3.user_a_member')::uuid, current_setting('cwp3.org_a')::uuid, now(), now()),
(current_setting('cwp3.user_a_admin')::uuid, current_setting('cwp3.org_a')::uuid, now(), now()),
(current_setting('cwp3.user_b_member')::uuid, current_setting('cwp3.org_b')::uuid, now(), now()),
(current_setting('cwp3.user_analyst')::uuid, NULL, now(), now()),
(current_setting('cwp3.user_ops_lead')::uuid, NULL, now(), now()),
(current_setting('cwp3.user_approver')::uuid, NULL, now(), now()),
(current_setting('cwp3.user_auditor')::uuid, NULL, now(), now()),
(current_setting('cwp3.user_platform_admin')::uuid, NULL, now(), now()),
(current_setting('cwp3.user_funder')::uuid, NULL, now(), now()),
(current_setting('cwp3.user_support')::uuid, NULL, now(), now())
ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id, updated_at = now();

INSERT INTO public.user_roles (user_id, role, org_id)
VALUES
(current_setting('cwp3.user_a_admin')::uuid, 'org_admin'::public.app_role, current_setting('cwp3.org_a')::uuid),
(current_setting('cwp3.user_analyst')::uuid, 'compliance_analyst'::public.app_role, NULL),
(current_setting('cwp3.user_ops_lead')::uuid, 'compliance_ops_lead'::public.app_role, NULL),
(current_setting('cwp3.user_approver')::uuid, 'senior_compliance_approver'::public.app_role, NULL),
(current_setting('cwp3.user_auditor')::uuid, 'auditor'::public.app_role, NULL),
(current_setting('cwp3.user_platform_admin')::uuid, 'platform_admin'::public.app_role, NULL),
(current_setting('cwp3.user_funder')::uuid, 'funder_viewer'::public.app_role, NULL),
(current_setting('cwp3.user_support')::uuid, 'technical_support'::public.app_role, NULL)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------
-- Helper: act as a given user (transaction-local JWT claim).
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
PERFORM set_config('request.jwt.claims',
  json_build_object('sub', _uid::text, 'role','authenticated')::text, true);
PERFORM set_config('role', 'authenticated', true);
IF auth.uid() IS DISTINCT FROM _uid THEN
RAISE EXCEPTION 'act_as: auth.uid()=% expected=%', auth.uid(), _uid;
END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.act_as_anon() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
PERFORM set_config('request.jwt.claim.sub', '', true);
PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
PERFORM set_config('role', 'anon', true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.act_as_service() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
PERFORM set_config('request.jwt.claim.sub', '', true);
PERFORM set_config('request.jwt.claims', '', true);
PERFORM set_config('role', 'postgres', true);
END $$;

-- ---------------------------------------------------------
-- Fixture cases (service-role context, one per scenario so scenarios
-- cannot interfere with one another's row state).
-- ---------------------------------------------------------
DO $$
DECLARE v_id uuid;
BEGIN
PERFORM pg_temp.act_as_service();

INSERT INTO public.cw_cases (org_id, case_type, status, primary_subject_kind, primary_subject_ref_id)
VALUES (current_setting('cwp3.org_a')::uuid, 'periodic_refresh', 'in_review', 'organisation', gen_random_uuid())
RETURNING id INTO v_id;
PERFORM set_config('cwp3.case_visibility', v_id::text, true);

INSERT INTO public.cw_cases (org_id, case_type, status, primary_subject_kind, primary_subject_ref_id)
VALUES (current_setting('cwp3.org_a')::uuid, 'periodic_refresh', 'in_review', 'organisation', gen_random_uuid())
RETURNING id INTO v_id;
PERFORM set_config('cwp3.case_decision_guard', v_id::text, true);

INSERT INTO public.cw_cases (org_id, case_type, status, primary_subject_kind, primary_subject_ref_id)
VALUES (current_setting('cwp3.org_a')::uuid, 'periodic_refresh', 'in_review', 'organisation', gen_random_uuid())
RETURNING id INTO v_id;
PERFORM set_config('cwp3.case_assignment_guard', v_id::text, true);

INSERT INTO public.cw_cases (org_id, case_type, status, primary_subject_kind, primary_subject_ref_id)
VALUES (current_setting('cwp3.org_a')::uuid, 'periodic_refresh', 'in_review', 'organisation', gen_random_uuid())
RETURNING id INTO v_id;
PERFORM set_config('cwp3.case_history', v_id::text, true);

INSERT INTO public.cw_cases (org_id, case_type, status, primary_subject_kind, primary_subject_ref_id)
VALUES (current_setting('cwp3.org_a')::uuid, 'periodic_refresh', 'in_review', 'organisation', gen_random_uuid())
RETURNING id INTO v_id;
PERFORM set_config('cwp3.case_assign_success', v_id::text, true);

INSERT INTO public.cw_cases (org_id, case_type, status, primary_subject_kind, primary_subject_ref_id)
VALUES (current_setting('cwp3.org_a')::uuid, 'periodic_refresh', 'in_review', 'organisation', gen_random_uuid())
RETURNING id INTO v_id;
PERFORM set_config('cwp3.case_rls_blanket', v_id::text, true);
END $$;

-- ============================================================
-- Group 1: cross-tenant denial + ordinary org visibility
-- ============================================================
DO $$
DECLARE v_id uuid := current_setting('cwp3.case_visibility')::uuid; cnt int;
BEGIN
PERFORM pg_temp.act_as(current_setting('cwp3.user_a_member')::uuid);
SELECT count(*) INTO cnt FROM public.cw_cases WHERE id = v_id;
IF cnt <> 1 THEN RAISE EXCEPTION 'G1: Org A member cannot see own-org case'; END IF;

PERFORM pg_temp.act_as(current_setting('cwp3.user_a_admin')::uuid);
SELECT count(*) INTO cnt FROM public.cw_cases WHERE id = v_id;
IF cnt <> 1 THEN RAISE EXCEPTION 'G1: Org A admin cannot see own-org case'; END IF;

PERFORM pg_temp.act_as(current_setting('cwp3.user_b_member')::uuid);
SELECT count(*) INTO cnt FROM public.cw_cases WHERE id = v_id;
IF cnt <> 0 THEN RAISE EXCEPTION 'G1: cross-tenant leak -- Org B member saw Org A case'; END IF;

PERFORM pg_temp.act_as_anon();
SELECT count(*) INTO cnt FROM public.cw_cases WHERE id = v_id;
IF cnt <> 0 THEN RAISE EXCEPTION 'G1: anon leaked into cw_cases'; END IF;
END $$;

-- ============================================================
-- Group 2: compliance-staff cross-org visibility
-- ============================================================
DO $$
DECLARE v_id uuid := current_setting('cwp3.case_visibility')::uuid; cnt int;
BEGIN
PERFORM pg_temp.act_as(current_setting('cwp3.user_analyst')::uuid);
SELECT count(*) INTO cnt FROM public.cw_cases WHERE id = v_id;
IF cnt <> 1 THEN RAISE EXCEPTION 'G2: compliance_analyst cannot see cross-org case'; END IF;

PERFORM pg_temp.act_as(current_setting('cwp3.user_approver')::uuid);
SELECT count(*) INTO cnt FROM public.cw_cases WHERE id = v_id;
IF cnt <> 1 THEN RAISE EXCEPTION 'G2: senior_compliance_approver cannot see cross-org case'; END IF;

PERFORM pg_temp.act_as(current_setting('cwp3.user_auditor')::uuid);
SELECT count(*) INTO cnt FROM public.cw_cases WHERE id = v_id;
IF cnt <> 1 THEN RAISE EXCEPTION 'G2: auditor cannot see cross-org case'; END IF;

PERFORM pg_temp.act_as(current_setting('cwp3.user_platform_admin')::uuid);
SELECT count(*) INTO cnt FROM public.cw_cases WHERE id = v_id;
IF cnt <> 1 THEN RAISE EXCEPTION 'G2: platform_admin cannot see cross-org case'; END IF;
END $$;

-- ============================================================
-- Group 3: funder + support/engineering isolation (no raw access yet)
-- ============================================================
DO $$
DECLARE v_id uuid := current_setting('cwp3.case_visibility')::uuid; cnt int;
BEGIN
PERFORM pg_temp.act_as(current_setting('cwp3.user_funder')::uuid);
SELECT count(*) INTO cnt FROM public.cw_cases WHERE id = v_id;
IF cnt <> 0 THEN RAISE EXCEPTION 'G3: funder_viewer must not see raw cw_cases in this increment'; END IF;

PERFORM pg_temp.act_as(current_setting('cwp3.user_support')::uuid);
SELECT count(*) INTO cnt FROM public.cw_cases WHERE id = v_id;
IF cnt <> 0 THEN RAISE EXCEPTION 'G3: technical_support must not see raw cw_cases in this increment'; END IF;
END $$;

-- ============================================================
-- Group 4: decision- and assignment-authority function matrix
-- ============================================================
DO $$
BEGIN
PERFORM pg_temp.act_as_service();

IF public.cw_can_decide_case(current_setting('cwp3.user_platform_admin')::uuid) THEN
RAISE EXCEPTION 'G4: platform_admin must NOT satisfy cw_can_decide_case';
END IF;
IF public.cw_can_decide_case(current_setting('cwp3.user_analyst')::uuid) THEN
RAISE EXCEPTION 'G4: compliance_analyst must NOT satisfy cw_can_decide_case';
END IF;
IF NOT public.cw_can_decide_case(current_setting('cwp3.user_approver')::uuid) THEN
RAISE EXCEPTION 'G4: senior_compliance_approver must satisfy cw_can_decide_case';
END IF;

IF NOT public.cw_can_assign_case(current_setting('cwp3.user_platform_admin')::uuid) THEN
RAISE EXCEPTION 'G4: platform_admin must satisfy cw_can_assign_case';
END IF;
IF NOT public.cw_can_assign_case(current_setting('cwp3.user_ops_lead')::uuid) THEN
RAISE EXCEPTION 'G4: compliance_ops_lead must satisfy cw_can_assign_case';
END IF;
IF public.cw_can_assign_case(current_setting('cwp3.user_analyst')::uuid) THEN
RAISE EXCEPTION 'G4: compliance_analyst must NOT satisfy cw_can_assign_case';
END IF;
END $$;

-- ============================================================
-- Group 5: assign-capable actor blocked from a DECISION change
-- (RLS lets the UPDATE through via cw_can_assign_case; the guard
-- trigger must still block it because it is a decision-field change)
-- ============================================================
DO $$
DECLARE v_id uuid := current_setting('cwp3.case_decision_guard')::uuid; v_raised boolean := false;
BEGIN
PERFORM pg_temp.act_as(current_setting('cwp3.user_ops_lead')::uuid);
BEGIN
UPDATE public.cw_cases SET status = 'approved', decided_by = current_setting('cwp3.user_ops_lead')::uuid, decided_at = now()
WHERE id = v_id;
EXCEPTION WHEN OTHERS THEN
IF SQLERRM LIKE 'cw.decision_requires_decision_maker%' THEN v_raised := true;
ELSE RAISE;
END IF;
END;
IF NOT v_raised THEN
RAISE EXCEPTION 'G5: compliance_ops_lead (assign-only) was able to change a decision field';
END IF;
END $$;

-- ============================================================
-- Group 6: decision-capable actor blocked from an ASSIGNMENT-only
-- change (RLS lets the UPDATE through via decision authority; the
-- guard trigger must still block it because it is not a decision)
-- ============================================================
DO $$
DECLARE v_id uuid := current_setting('cwp3.case_assignment_guard')::uuid; v_raised boolean := false;
BEGIN
PERFORM pg_temp.act_as(current_setting('cwp3.user_approver')::uuid);
BEGIN
UPDATE public.cw_cases SET owner_user_id = current_setting('cwp3.user_approver')::uuid, assigned_at = now()
WHERE id = v_id;
EXCEPTION WHEN OTHERS THEN
IF SQLERRM LIKE 'cw.assignment_requires_assign_capability%' THEN v_raised := true;
ELSE RAISE;
END IF;
END;
IF NOT v_raised THEN
RAISE EXCEPTION 'G6: senior_compliance_approver (decision-only) was able to reassign a case';
END IF;
END $$;

-- ============================================================
-- Group 7: history immutability -- may decide once, may never
-- rewrite a decided/closed case afterwards.
-- ============================================================
DO $$
DECLARE v_id uuid := current_setting('cwp3.case_history')::uuid; v_raised boolean := false; v_status text;
BEGIN
PERFORM pg_temp.act_as(current_setting('cwp3.user_approver')::uuid);
UPDATE public.cw_cases SET status = 'approved', decided_by = current_setting('cwp3.user_approver')::uuid, decided_at = now()
WHERE id = v_id;

PERFORM pg_temp.act_as_service();
SELECT status INTO v_status FROM public.cw_cases WHERE id = v_id;
IF v_status <> 'approved' THEN RAISE EXCEPTION 'G7: legitimate first decision did not apply'; END IF;

PERFORM pg_temp.act_as(current_setting('cwp3.user_approver')::uuid);
BEGIN
UPDATE public.cw_cases SET decision_notes = 'attempted rewrite of decided case' WHERE id = v_id;
EXCEPTION WHEN OTHERS THEN
IF SQLERRM LIKE 'cw.history_immutable%' THEN v_raised := true;
ELSE RAISE;
END IF;
END;
IF NOT v_raised THEN
RAISE EXCEPTION 'G7: a decided/closed case was amended -- history is not immutable';
END IF;
END $$;

-- ============================================================
-- Group 8: legitimate assignment succeeds for an assign-capable actor
-- ============================================================
DO $$
DECLARE v_id uuid := current_setting('cwp3.case_assign_success')::uuid; v_owner uuid;
BEGIN
PERFORM pg_temp.act_as(current_setting('cwp3.user_ops_lead')::uuid);
UPDATE public.cw_cases SET owner_user_id = current_setting('cwp3.user_ops_lead')::uuid, assigned_at = now()
WHERE id = v_id;

PERFORM pg_temp.act_as_service();
SELECT owner_user_id INTO v_owner FROM public.cw_cases WHERE id = v_id;
IF v_owner IS DISTINCT FROM current_setting('cwp3.user_ops_lead')::uuid THEN
RAISE EXCEPTION 'G8: compliance_ops_lead legitimate assignment did not apply';
END IF;
END $$;

-- ============================================================
-- Group 9: an actor with NEITHER capability is blocked by RLS itself
-- (zero rows affected, no exception, row provably unchanged)
-- ============================================================
DO $$
DECLARE v_id uuid := current_setting('cwp3.case_rls_blanket')::uuid; v_status_before text; v_status_after text;
BEGIN
PERFORM pg_temp.act_as_service();
SELECT status INTO v_status_before FROM public.cw_cases WHERE id = v_id;

PERFORM pg_temp.act_as(current_setting('cwp3.user_analyst')::uuid);
UPDATE public.cw_cases SET status = 'approved' WHERE id = v_id;
IF FOUND THEN RAISE EXCEPTION 'G9: compliance_analyst UPDATE should affect zero rows under RLS'; END IF;

PERFORM pg_temp.act_as(current_setting('cwp3.user_auditor')::uuid);
UPDATE public.cw_cases SET status = 'approved' WHERE id = v_id;
IF FOUND THEN RAISE EXCEPTION 'G9: auditor UPDATE should affect zero rows under RLS (read-only)'; END IF;

PERFORM pg_temp.act_as_service();
SELECT status INTO v_status_after FROM public.cw_cases WHERE id = v_id;
IF v_status_after IS DISTINCT FROM v_status_before THEN
RAISE EXCEPTION 'G9: row was mutated despite neither actor holding a write capability';
END IF;
END $$;

-- ============================================================
-- Group 10: auditor export requires an explicit grant
-- ============================================================
DO $$
DECLARE v_can boolean;
BEGIN
PERFORM pg_temp.act_as_service();

SELECT public.cw_can_export_case_data(current_setting('cwp3.user_auditor')::uuid) INTO v_can;
IF v_can THEN RAISE EXCEPTION 'G10: auditor without a grant must NOT be able to export'; END IF;

INSERT INTO public.cw_auditor_export_grants (auditor_user_id, org_id, reason, granted_by)
VALUES (current_setting('cwp3.user_auditor')::uuid, current_setting('cwp3.org_a')::uuid, 'proof fixture', current_setting('cwp3.user_platform_admin')::uuid);

SELECT public.cw_can_export_case_data(current_setting('cwp3.user_auditor')::uuid) INTO v_can;
IF NOT v_can THEN RAISE EXCEPTION 'G10: auditor WITH a grant must be able to export'; END IF;

SELECT public.cw_can_export_case_data(current_setting('cwp3.user_platform_admin')::uuid) INTO v_can;
IF NOT v_can THEN RAISE EXCEPTION 'G10: platform_admin must be able to export without a grant row'; END IF;
END $$;

-- ============================================================
-- Group 11: cw_auditor_export_grants row-level self-isolation
-- ============================================================
DO $$
DECLARE cnt int;
BEGIN
PERFORM pg_temp.act_as(current_setting('cwp3.user_auditor')::uuid);
SELECT count(*) INTO cnt FROM public.cw_auditor_export_grants
WHERE auditor_user_id = current_setting('cwp3.user_auditor')::uuid;
IF cnt <> 1 THEN RAISE EXCEPTION 'G11: auditor cannot see their own export grant row'; END IF;

PERFORM pg_temp.act_as(current_setting('cwp3.user_a_member')::uuid);
SELECT count(*) INTO cnt FROM public.cw_auditor_export_grants;
IF cnt <> 0 THEN RAISE EXCEPTION 'G11: an unrelated ordinary user leaked into cw_auditor_export_grants'; END IF;
END $$;

ROLLBACK;
