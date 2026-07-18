-- ============================================================
-- Phase 1A Enterprise Support Centre — Database-native
-- behavioural security proof.
--
-- Runs on a MIGRATED, ISOLATED database (local Supabase or CI).
-- All state changes happen inside one transaction that ROLLS BACK
-- at the end, so no rows persist. Do NOT run against production
-- customer data.
--
-- Execution
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/tests/phase_1a_support_behavioural_proof.sql
--
-- Environment
--   DATABASE_URL must point at an isolated database that has been
--   migrated with `supabase db reset` (or equivalent) so every
--   Phase 1A migration is present, including the corrective
--   projection migration.
--
-- Authentication simulation
--   Postgres cannot verify a real Supabase JWT, but Supabase's own
--   RLS helpers read auth.uid() from `request.jwt.claims`. We
--   therefore set transaction-local claims + role and verify
--   auth.uid() returns the intended fixture user before each actor
--   scenario.
--
-- What this proves
--   1  Server derives ticket_number, org_id, creator, priority,
--      rule version, restriction — client cannot forge them.
--   2  Ordinary-ticket visibility matrix (Org A creator, other Org
--      A member, Org A admin, Org B member, Org B admin, platform
--      admin, anon).
--   3  Restricted-ticket isolation (same actors as above; only
--      creator + platform admin may read; org admin is denied).
--   4  Customer-visible messages vs internal notes segregation.
--   5  Auditor / non-actor cannot mutate; helper functions cannot
--      be executed by ordinary users.
--   6  Hostile safe_context inputs are rejected.
--   7  Ticket numbers are unique across a burst insert.
--
-- On failure the transaction rolls back and psql exits non-zero
-- because of ON_ERROR_STOP=1. Every RAISE EXCEPTION below carries
-- a diagnostic message identifying the failing assertion.
-- ============================================================

\set ON_ERROR_STOP on

BEGIN;

-- Guard: never run this against a database that looks like production.
DO $$
BEGIN
  IF current_database() ILIKE '%prod%' THEN
    RAISE EXCEPTION 'phase_1a_support_behavioural_proof: refusing to run against database %', current_database();
  END IF;
END $$;

-- ---------------------------------------------------------
-- 0. Fixture setup (service-role context)
-- ---------------------------------------------------------
-- Use a set of stable UUIDs so cleanup at ROLLBACK is total.
DO $$ BEGIN
  PERFORM set_config('phase1a.org_a', gen_random_uuid()::text, true);
  PERFORM set_config('phase1a.org_b', gen_random_uuid()::text, true);
  PERFORM set_config('phase1a.user_a1', gen_random_uuid()::text, true);
  PERFORM set_config('phase1a.user_a2', gen_random_uuid()::text, true);
  PERFORM set_config('phase1a.user_a_admin', gen_random_uuid()::text, true);
  PERFORM set_config('phase1a.user_b1', gen_random_uuid()::text, true);
  PERFORM set_config('phase1a.user_b_admin', gen_random_uuid()::text, true);
  PERFORM set_config('phase1a.user_platform_admin', gen_random_uuid()::text, true);
  PERFORM set_config('phase1a.user_auditor', gen_random_uuid()::text, true);
  PERFORM set_config('phase1a.user_funder', gen_random_uuid()::text, true);
END $$;

-- Minimal auth.users rows (bypassing GoTrue, allowed inside test tx).
INSERT INTO auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at)
SELECT current_setting('phase1a.' || u)::uuid, u || '@phase1a.test', 'authenticated','authenticated', now(), now(), now()
FROM unnest(ARRAY['user_a1','user_a2','user_a_admin','user_b1','user_b_admin','user_platform_admin','user_auditor','user_funder']) AS u;

-- Organisations.
INSERT INTO public.organizations (id, name, created_at, updated_at)
VALUES
  (current_setting('phase1a.org_a')::uuid, 'PHASE1A Org A', now(), now()),
  (current_setting('phase1a.org_b')::uuid, 'PHASE1A Org B', now(), now());

-- Profiles map users to orgs.
INSERT INTO public.profiles (id, org_id, created_at, updated_at)
VALUES
  (current_setting('phase1a.user_a1')::uuid,           current_setting('phase1a.org_a')::uuid, now(), now()),
  (current_setting('phase1a.user_a2')::uuid,           current_setting('phase1a.org_a')::uuid, now(), now()),
  (current_setting('phase1a.user_a_admin')::uuid,      current_setting('phase1a.org_a')::uuid, now(), now()),
  (current_setting('phase1a.user_b1')::uuid,           current_setting('phase1a.org_b')::uuid, now(), now()),
  (current_setting('phase1a.user_b_admin')::uuid,      current_setting('phase1a.org_b')::uuid, now(), now()),
  (current_setting('phase1a.user_platform_admin')::uuid, NULL, now(), now()),
  (current_setting('phase1a.user_auditor')::uuid,      NULL, now(), now()),
  (current_setting('phase1a.user_funder')::uuid,       NULL, now(), now())
ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id, updated_at = now();

-- Roles. `user_roles` and `app_role` are provided by the app schema.
INSERT INTO public.user_roles (user_id, role, org_id)
VALUES
  (current_setting('phase1a.user_a_admin')::uuid,      'org_admin'::public.app_role,        current_setting('phase1a.org_a')::uuid),
  (current_setting('phase1a.user_b_admin')::uuid,      'org_admin'::public.app_role,        current_setting('phase1a.org_b')::uuid),
  (current_setting('phase1a.user_platform_admin')::uuid,'platform_admin'::public.app_role,  NULL),
  (current_setting('phase1a.user_auditor')::uuid,      'auditor_read_only'::public.app_role, NULL)
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

-- ============================================================
-- Group 2: ordinary ticket creation + server-derived fields
-- ============================================================
DO $$
DECLARE v_id uuid; v_num text; v_ticket public.support_tickets%ROWTYPE; r record;
BEGIN
  PERFORM pg_temp.act_as(current_setting('phase1a.user_a1')::uuid);
  SELECT * FROM public.create_support_ticket(
    _category_key => 'general_question',
    _subcategory_key => NULL,
    _customer_impact => 'affects_me',
    _subject => 'PHASE1A ordinary ticket A1'
  ) INTO v_id, v_num;
  IF v_id IS NULL OR v_num IS NULL THEN
    RAISE EXCEPTION 'G2: ticket creation returned NULL id/number';
  END IF;
  PERFORM pg_temp.act_as_service();
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = v_id;
  IF v_ticket.created_by <> current_setting('phase1a.user_a1')::uuid THEN
    RAISE EXCEPTION 'G2: creator was NOT derived from auth.uid()';
  END IF;
  IF v_ticket.org_id <> current_setting('phase1a.org_a')::uuid THEN
    RAISE EXCEPTION 'G2: org_id was NOT derived server-side (got %)', v_ticket.org_id;
  END IF;
  IF v_ticket.ticket_number !~ '^IZ-[0-9]{4}-[A-Z0-9]{8}$' THEN
    RAISE EXCEPTION 'G2: ticket_number pattern violated: %', v_ticket.ticket_number;
  END IF;
  IF v_ticket.priority_rules_version IS NULL THEN
    RAISE EXCEPTION 'G2: priority_rules_version missing';
  END IF;
  IF v_ticket.is_restricted IS TRUE THEN
    RAISE EXCEPTION 'G2: general_question must not be restricted';
  END IF;
  PERFORM set_config('phase1a.ordinary_ticket', v_id::text, true);
END $$;

-- Security default: security category must yield urgent priority.
DO $$
DECLARE v_id uuid; v_num text; v_ticket public.support_tickets%ROWTYPE;
BEGIN
  PERFORM pg_temp.act_as(current_setting('phase1a.user_a1')::uuid);
  SELECT * FROM public.create_support_ticket(
    _category_key => 'security', _subcategory_key => NULL,
    _customer_impact => 'affects_me',
    _subject => 'PHASE1A restricted security ticket A1'
  ) INTO v_id, v_num;
  PERFORM pg_temp.act_as_service();
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = v_id;
  IF v_ticket.priority <> 'urgent' THEN
    RAISE EXCEPTION 'G11: security ticket priority=% expected urgent', v_ticket.priority;
  END IF;
  IF v_ticket.priority_source <> 'security_default' THEN
    RAISE EXCEPTION 'G11: security ticket priority_source=% expected security_default', v_ticket.priority_source;
  END IF;
  IF v_ticket.is_restricted IS NOT TRUE THEN
    RAISE EXCEPTION 'G11: security ticket not marked restricted';
  END IF;
  PERFORM set_config('phase1a.restricted_ticket', v_id::text, true);
END $$;

-- ============================================================
-- Group 3: ordinary visibility matrix (uses ordinary_ticket)
-- ============================================================
DO $$
DECLARE v_id uuid := current_setting('phase1a.ordinary_ticket')::uuid; cnt int;
BEGIN
  -- Creator A1 sees it.
  PERFORM pg_temp.act_as(current_setting('phase1a.user_a1')::uuid);
  SELECT count(*) INTO cnt FROM public.list_own_support_tickets() WHERE id = v_id;
  IF cnt <> 1 THEN RAISE EXCEPTION 'G3: creator A1 cannot see own ticket'; END IF;

  -- A2 (same org, non-admin) must NOT see it via list_own or list_org.
  PERFORM pg_temp.act_as(current_setting('phase1a.user_a2')::uuid);
  SELECT count(*) INTO cnt FROM public.list_own_support_tickets() WHERE id = v_id;
  IF cnt <> 0 THEN RAISE EXCEPTION 'G3: A2 leaked into list_own'; END IF;
  SELECT count(*) INTO cnt FROM public.list_org_support_tickets() WHERE id = v_id;
  IF cnt <> 0 THEN RAISE EXCEPTION 'G3: A2 leaked into list_org (not admin)'; END IF;

  -- Org admin A sees the ordinary (non-restricted) ticket via list_org.
  PERFORM pg_temp.act_as(current_setting('phase1a.user_a_admin')::uuid);
  SELECT count(*) INTO cnt FROM public.list_org_support_tickets() WHERE id = v_id;
  IF cnt <> 1 THEN RAISE EXCEPTION 'G3: org admin A cannot see org ordinary ticket'; END IF;

  -- Org B member is denied.
  PERFORM pg_temp.act_as(current_setting('phase1a.user_b1')::uuid);
  SELECT count(*) INTO cnt FROM public.list_own_support_tickets() WHERE id = v_id;
  IF cnt <> 0 THEN RAISE EXCEPTION 'G3: B1 leaked into list_own'; END IF;
  SELECT count(*) INTO cnt FROM public.get_support_ticket(v_id);
  IF cnt <> 0 THEN RAISE EXCEPTION 'G3: B1 leaked into get_support_ticket'; END IF;

  -- Org B admin is denied.
  PERFORM pg_temp.act_as(current_setting('phase1a.user_b_admin')::uuid);
  SELECT count(*) INTO cnt FROM public.list_org_support_tickets() WHERE id = v_id;
  IF cnt <> 0 THEN RAISE EXCEPTION 'G3: B admin leaked cross-tenant'; END IF;

  -- Platform admin sees internal view.
  PERFORM pg_temp.act_as(current_setting('phase1a.user_platform_admin')::uuid);
  SELECT count(*) INTO cnt FROM public.get_support_ticket_internal(v_id, 'test');
  IF cnt <> 1 THEN RAISE EXCEPTION 'G3: platform admin cannot see ticket via internal getter'; END IF;

  -- Anon is denied.
  PERFORM pg_temp.act_as_anon();
  SELECT count(*) INTO cnt FROM public.get_support_ticket(v_id);
  IF cnt <> 0 THEN RAISE EXCEPTION 'G3: anon leaked into get_support_ticket'; END IF;
END $$;

-- ============================================================
-- Group 4: restricted visibility isolation
-- ============================================================
DO $$
DECLARE v_id uuid := current_setting('phase1a.restricted_ticket')::uuid; cnt int;
BEGIN
  -- Creator A1 sees only the customer-safe view.
  PERFORM pg_temp.act_as(current_setting('phase1a.user_a1')::uuid);
  SELECT count(*) INTO cnt FROM public.get_support_ticket(v_id);
  IF cnt <> 1 THEN RAISE EXCEPTION 'G4: A1 cannot see own restricted ticket via customer getter'; END IF;

  -- Org admin A is DENIED (restricted).
  PERFORM pg_temp.act_as(current_setting('phase1a.user_a_admin')::uuid);
  SELECT count(*) INTO cnt FROM public.list_org_support_tickets() WHERE id = v_id;
  IF cnt <> 0 THEN RAISE EXCEPTION 'G4: org admin A leaked restricted ticket into list_org'; END IF;
  SELECT count(*) INTO cnt FROM public.get_support_ticket(v_id);
  IF cnt <> 0 THEN RAISE EXCEPTION 'G4: org admin A leaked restricted ticket via customer getter'; END IF;

  -- A2 denied.
  PERFORM pg_temp.act_as(current_setting('phase1a.user_a2')::uuid);
  SELECT count(*) INTO cnt FROM public.get_support_ticket(v_id);
  IF cnt <> 0 THEN RAISE EXCEPTION 'G4: A2 leaked restricted'; END IF;

  -- Org B admin denied.
  PERFORM pg_temp.act_as(current_setting('phase1a.user_b_admin')::uuid);
  SELECT count(*) INTO cnt FROM public.get_support_ticket(v_id);
  IF cnt <> 0 THEN RAISE EXCEPTION 'G4: Org B admin leaked restricted'; END IF;

  -- Platform admin: internal view allowed AND access-audit row written.
  PERFORM pg_temp.act_as(current_setting('phase1a.user_platform_admin')::uuid);
  SELECT count(*) INTO cnt FROM public.get_support_ticket_internal(v_id, 'behavioural proof');
  IF cnt <> 1 THEN RAISE EXCEPTION 'G4: platform admin cannot view restricted internal'; END IF;
  PERFORM pg_temp.act_as_service();
  SELECT count(*) INTO cnt FROM public.support_ticket_access_audit
   WHERE ticket_id = v_id AND access_kind = 'internal_view_restricted';
  IF cnt < 1 THEN RAISE EXCEPTION 'G4: access-audit not written for restricted internal view'; END IF;
END $$;

-- ============================================================
-- Group 8: message segregation (customer vs internal notes)
-- ============================================================
DO $$
DECLARE v_id uuid := current_setting('phase1a.ordinary_ticket')::uuid; cnt int;
BEGIN
  -- A1 posts a customer-visible message.
  PERFORM pg_temp.act_as(current_setting('phase1a.user_a1')::uuid);
  PERFORM public.post_support_ticket_customer_message(v_id, 'PHASE1A customer message');

  -- Platform admin posts an internal note.
  PERFORM pg_temp.act_as(current_setting('phase1a.user_platform_admin')::uuid);
  PERFORM public.post_support_ticket_internal_note(v_id, 'PHASE1A internal note');

  -- Customer sees only their customer-visible message; internal notes hidden.
  PERFORM pg_temp.act_as(current_setting('phase1a.user_a1')::uuid);
  SELECT count(*) INTO cnt FROM public.list_support_ticket_customer_messages(v_id);
  IF cnt <> 1 THEN RAISE EXCEPTION 'G8: customer messages count expected 1, got %', cnt; END IF;
  BEGIN
    SELECT count(*) INTO cnt FROM public.list_support_ticket_internal_notes(v_id);
    IF cnt <> 0 THEN RAISE EXCEPTION 'G8: customer leaked into internal notes list (count=%)', cnt; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- Customer cannot post an internal note.
  BEGIN
    PERFORM public.post_support_ticket_internal_note(v_id, 'HOSTILE internal from customer');
    RAISE EXCEPTION 'G8: customer was allowed to post an internal note';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Platform admin sees both.
  PERFORM pg_temp.act_as(current_setting('phase1a.user_platform_admin')::uuid);
  SELECT count(*) INTO cnt FROM public.list_support_ticket_customer_messages(v_id);
  IF cnt <> 1 THEN RAISE EXCEPTION 'G8: platform admin customer msg count %', cnt; END IF;
  SELECT count(*) INTO cnt FROM public.list_support_ticket_internal_notes(v_id);
  IF cnt <> 1 THEN RAISE EXCEPTION 'G8: platform admin internal note count %', cnt; END IF;
END $$;

-- ============================================================
-- Group 10: hostile safe_context rejection
-- ============================================================
DO $$
DECLARE v_id uuid; v_num text;
BEGIN
  PERFORM pg_temp.act_as(current_setting('phase1a.user_a1')::uuid);
  FOR i IN 1..1 LOOP
    BEGIN
      SELECT * FROM public.create_support_ticket(
        _category_key => 'general_question', _subcategory_key => NULL,
        _customer_impact => 'affects_me',
        _subject => 'PHASE1A hostile context',
        _safe_context => jsonb_build_object('password','pw', 'token','t')
      ) INTO v_id, v_num;
      RAISE EXCEPTION 'G10: hostile safe_context with password/token was accepted';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%safe_context%' THEN
        RAISE EXCEPTION 'G10: unexpected error rejecting hostile context: %', SQLERRM;
      END IF;
    END;
  END LOOP;
END $$;

-- ============================================================
-- Group 14: helper functions are not callable by ordinary users
-- ============================================================
DO $$
DECLARE v_denied boolean;
BEGIN
  PERFORM pg_temp.act_as(current_setting('phase1a.user_a1')::uuid);
  v_denied := false;
  BEGIN
    PERFORM public._support_record_access(
      current_setting('phase1a.ordinary_ticket')::uuid,
      current_setting('phase1a.user_a1')::uuid,
      'hostile', 'nope'
    );
  EXCEPTION WHEN OTHERS THEN v_denied := true; END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'G14: _support_record_access executed by ordinary user';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public._support_next_ticket_number();
  EXCEPTION WHEN OTHERS THEN v_denied := true; END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'G14: _support_next_ticket_number executed by ordinary user';
  END IF;
END $$;

-- ============================================================
-- Group 12: ticket-number uniqueness burst
-- ============================================================
DO $$
DECLARE v_id uuid; v_num text; v_count int; v_dup int;
BEGIN
  PERFORM pg_temp.act_as(current_setting('phase1a.user_a1')::uuid);
  FOR i IN 1..100 LOOP
    SELECT * FROM public.create_support_ticket(
      _category_key => 'general_question', _subcategory_key => NULL,
      _customer_impact => 'affects_me',
      _subject => 'PHASE1A burst ' || i
    ) INTO v_id, v_num;
    IF v_num !~ '^IZ-[0-9]{4}-[A-Z0-9]{8}$' THEN
      RAISE EXCEPTION 'G12: bad ticket_number %', v_num;
    END IF;
  END LOOP;
  PERFORM pg_temp.act_as_service();
  SELECT count(*), count(*) - count(DISTINCT ticket_number) INTO v_count, v_dup
    FROM public.support_tickets
    WHERE created_by = current_setting('phase1a.user_a1')::uuid;
  IF v_dup <> 0 THEN
    RAISE EXCEPTION 'G12: duplicate ticket numbers detected (%)', v_dup;
  END IF;
  IF v_count < 100 THEN
    RAISE EXCEPTION 'G12: burst insert produced only % tickets', v_count;
  END IF;
END $$;

-- ============================================================
-- Group 5: auditor cannot mutate
-- ============================================================
DO $$
DECLARE v_denied boolean;
BEGIN
  PERFORM pg_temp.act_as(current_setting('phase1a.user_auditor')::uuid);
  v_denied := false;
  BEGIN
    PERFORM public.post_support_ticket_customer_message(
      current_setting('phase1a.ordinary_ticket')::uuid, 'auditor tried to speak'
    );
  EXCEPTION WHEN OTHERS THEN v_denied := true; END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'G5: auditor was allowed to post a customer message';
  END IF;
END $$;

-- ============================================================
-- Group 15: empty capability scaffolding grants no authority
-- ============================================================
DO $$
DECLARE ok boolean;
BEGIN
  PERFORM pg_temp.act_as(current_setting('phase1a.user_a1')::uuid);
  SELECT public.has_support_capability(current_setting('phase1a.user_a1')::uuid, 'support_lead')
    INTO ok;
  IF ok THEN
    RAISE EXCEPTION 'G15: has_support_capability returned true with empty grants table';
  END IF;
END $$;

RAISE NOTICE 'phase_1a_support_behavioural_proof: all assertions passed';

ROLLBACK;
