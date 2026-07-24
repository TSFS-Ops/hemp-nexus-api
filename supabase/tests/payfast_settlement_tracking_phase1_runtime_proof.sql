-- ============================================================================
-- PayFast Settlement Tracking -- Phase 1 -- Runtime Behavioural Proof
-- ============================================================================
-- Executed against a disposable Postgres 15 service container (GitHub-hosted
-- runner) AFTER the full supabase/migrations/*.sql chain has been applied,
-- using the same minimal Supabase-compatibility bootstrap (auth/storage
-- schemas, anon/authenticated/service_role roles, pgcrypto/uuid-ossp) that
-- .github/workflows/pr26-pilot-readiness-validation.yml already establishes
-- and that PR #31's migration already applies cleanly under. This file adds
-- a session-settable auth.uid() stub on top of that bootstrap so a single
-- psql session can simulate different callers (platform_admin, auditor,
-- ordinary customer, anonymous) via SET ROLE plus a custom GUC.
--
-- This file is self-contained. It creates its own fixtures (one throwaway
-- organisation, three throwaway auth.users + user_roles rows, and a handful
-- of token_purchases rows) inside supabase/tests and expects to run once
-- against a disposable database that is discarded after the job. It does
-- not touch PayFast checkout, PayFast ITN, Paystack, token_ledger, or wallet
-- balance logic -- it only exercises the four PR #31 RPCs and the
-- payment_settlements table they own.
--
-- Every assertion appends exactly one row to pg_temp.proof_results (area,
-- check_name, passed, detail). The final block raises an exception -- and
-- therefore fails the psql invocation / CI job with a non-zero exit code --
-- if any row has passed = false. A green run means every assertion actually
-- executed SQL/RPC calls against a real Postgres 15 instance running the
-- real migration output, not a static source-text match.
--
-- What this proves, and what it explicitly does not, is documented in
-- docs/payfast-settlement-tracking-phase-1-report.md under
-- "Runtime behavioural proof".
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Harness plumbing: results table, fixture-id table, smarter auth.uid()
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pg_temp.proof_results (
  seq        bigserial PRIMARY KEY,
  area       text NOT NULL,
  check_name text NOT NULL,
  passed     boolean NOT NULL,
  detail     text
);

CREATE OR REPLACE FUNCTION pg_temp.record_result(p_area text, p_check text, p_passed boolean, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE sql AS $rr$
  INSERT INTO pg_temp.proof_results(area, check_name, passed, detail)
  VALUES (p_area, p_check, p_passed, p_detail)
$rr$;

CREATE TABLE IF NOT EXISTS pg_temp.fixture_ids (
  name text PRIMARY KEY,
  id   uuid NOT NULL
);

CREATE OR REPLACE FUNCTION pg_temp.fid(p_name text) RETURNS uuid
LANGUAGE sql AS $f$ SELECT id FROM pg_temp.fixture_ids WHERE name = p_name $f$;

CREATE OR REPLACE FUNCTION pg_temp.set_fid(p_name text, p_id uuid) RETURNS uuid
LANGUAGE sql AS $sf$
  INSERT INTO pg_temp.fixture_ids(name, id) VALUES (p_name, p_id)
  ON CONFLICT (name) DO UPDATE SET id = EXCLUDED.id
  RETURNING id
$sf$;

CREATE TABLE IF NOT EXISTS pg_temp.snapshots (name text PRIMARY KEY, value text);

CREATE OR REPLACE FUNCTION pg_temp.set_snap(p_name text, p_value text) RETURNS void
LANGUAGE sql AS $ss$
  INSERT INTO pg_temp.snapshots(name, value) VALUES (p_name, p_value)
  ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value
$ss$;

CREATE OR REPLACE FUNCTION pg_temp.get_snap(p_name text) RETURNS text
LANGUAGE sql AS $gs$ SELECT value FROM pg_temp.snapshots WHERE name = p_name $gs$;

-- Session-settable identity stub. Unset/NULL simulates a service/internal
-- caller -- this matches how the PR #31 RPCs already treat auth.uid() IS
-- NULL as a cron/service-role bypass context (see create_missing_payfast_
-- settlements_v1 and detect_payment_settlement_risks_v1). This replaces the
-- fixed-NULL auth.uid() stub installed by the generic bootstrap step earlier
-- in the job, so this script can simulate different real callers.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $au$ SELECT NULLIF(current_setting('app.test_uid', true), '')::uuid $au$;

CREATE OR REPLACE PROCEDURE pg_temp.act_as(p_uid uuid)
LANGUAGE plpgsql AS $aa$
BEGIN
  PERFORM set_config('app.test_uid', COALESCE(p_uid::text, ''), false);
END;
$aa$;

-- Fixture helper: create a token_purchases row. NOTE (schema quirk):
-- paystack_reference is still NOT NULL UNIQUE on this table even for
-- provider='payfast' rows (PayFast Phase 2A only added provider /
-- provider_reference as nullable additions; it did not relax the historical
-- Paystack-era NOT NULL UNIQUE constraint). A synthetic legacy value is
-- required here purely to satisfy that constraint; it is never read by any
-- PayFast settlement-tracking logic.
CREATE OR REPLACE FUNCTION pg_temp.mk_tp(
  p_ref text, p_provider text, p_status text, p_org uuid, p_user uuid,
  p_updated_at timestamptz DEFAULT now()
) RETURNS uuid LANGUAGE plpgsql AS $mktp$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.token_purchases (
    id, org_id, user_id, paystack_reference, package_id, token_amount,
    amount_usd, currency, status, provider, provider_reference, metadata,
    created_at, updated_at
  ) VALUES (
    v_id, p_org, p_user,
    'legacy-ref-' || v_id::text,
    'pkg_test_1000', 1000,
    100.00, 'USD', p_status, p_provider, p_ref,
    jsonb_build_object('price_usd', 100, 'amount_zar', 1900, 'usd_zar_rate', 19.0),
    p_updated_at, p_updated_at
  );
  RETURN v_id;
END;
$mktp$;

-- Fixture helper: seed a payment_settlements row directly (bypassing the
-- reconciliation RPC), for tests that need a pre-existing settlement in a
-- known state (admin-update / list / risk-detection proofs).
CREATE OR REPLACE FUNCTION pg_temp.mk_ps(
  p_tp uuid, p_org uuid, p_ref text, p_expected_at timestamptz DEFAULT (now() + interval '2 days')
) RETURNS uuid LANGUAGE plpgsql AS $mkps$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.payment_settlements (
    id, provider, provider_reference, token_purchase_id, org_id,
    amount_usd, amount_zar, usd_zar_rate, expected_settlement_at, status, metadata
  ) VALUES (
    v_id, 'payfast', p_ref, p_tp, p_org,
    100.00, 1900, 19.0, p_expected_at, 'expected',
    jsonb_build_object('source_purchase_id', p_tp, 'creation_reason', 'runtime_proof_direct_seed')
  );
  RETURN v_id;
END;
$mkps$;

-- Fixed test identities -------------------------------------------------------
INSERT INTO public.organizations (id, name) VALUES
  ('33333333-3333-3333-3333-333333333333', 'Runtime Proof Test Org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'runtime-proof-admin@example.test'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'runtime-proof-auditor@example.test'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'runtime-proof-customer@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'platform_admin'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'auditor'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'buyer')
ON CONFLICT (user_id, role) DO NOTHING;

CALL pg_temp.act_as(NULL);

-- ============================================================================
-- AREA A -- migration application: table / constraints / indexes / RLS / RPCs
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.payment_settlements') IS NOT NULL THEN
    PERFORM pg_temp.record_result('A', 'payment_settlements table exists', true);
  ELSE
    PERFORM pg_temp.record_result('A', 'payment_settlements table exists', false, 'to_regclass returned NULL');
  END IF;
END $$;

DO $$
DECLARE v_missing text[];
BEGIN
  SELECT array_agg(want) INTO v_missing
  FROM unnest(ARRAY[
    'payment_settlements_provider_reference_uidx',
    'payment_settlements_token_purchase_uidx',
    'payment_settlements_confirmed_requires_bank_ref',
    'payment_settlements_pkey'
  ]) AS want
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'payment_settlements' AND c.conname = want
  );
  IF v_missing IS NULL THEN
    PERFORM pg_temp.record_result('A', 'required constraints exist (unique + confirmed-requires-bank-ref)', true);
  ELSE
    PERFORM pg_temp.record_result('A', 'required constraints exist (unique + confirmed-requires-bank-ref)', false, 'missing: ' || array_to_string(v_missing, ', '));
  END IF;
END $$;

DO $$
DECLARE v_missing text[];
BEGIN
  SELECT array_agg(want) INTO v_missing
  FROM unnest(ARRAY[
    'idx_payment_settlements_provider_status',
    'idx_payment_settlements_org',
    'idx_payment_settlements_expected_at'
  ]) AS want
  WHERE NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'payment_settlements' AND indexname = want);
  IF v_missing IS NULL THEN
    PERFORM pg_temp.record_result('A', 'required indexes exist', true);
  ELSE
    PERFORM pg_temp.record_result('A', 'required indexes exist', false, 'missing: ' || array_to_string(v_missing, ', '));
  END IF;
END $$;

DO $$
DECLARE v_rls boolean;
v_policy_count int;
BEGIN
  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE relname = 'payment_settlements';
  SELECT count(*) INTO v_policy_count FROM pg_policies WHERE tablename = 'payment_settlements';
  IF v_rls IS TRUE AND v_policy_count >= 1 THEN
    PERFORM pg_temp.record_result('A', 'RLS enabled with at least one policy', true, v_policy_count || ' policy/policies found');
  ELSE
    PERFORM pg_temp.record_result('A', 'RLS enabled with at least one policy', false, 'relrowsecurity=' || v_rls || ' policies=' || v_policy_count);
  END IF;
END $$;

DO $$
DECLARE v_missing text[];
BEGIN
  SELECT array_agg(want) INTO v_missing
  FROM unnest(ARRAY[
    'create_missing_payfast_settlements_v1(integer)',
    'payment_settlement_mark_v1(uuid,text,text,text,text)',
    'payment_settlements_list_v1(text,text,uuid,text,text,timestamptz,timestamptz,integer,integer)',
    'detect_payment_settlement_risks_v1(integer,integer)'
  ]) AS want
  WHERE to_regprocedure('public.' || want) IS NULL;
  IF v_missing IS NULL THEN
    PERFORM pg_temp.record_result('A', 'all four governed RPCs exist with expected signatures', true);
  ELSE
    PERFORM pg_temp.record_result('A', 'all four governed RPCs exist with expected signatures', false, 'missing: ' || array_to_string(v_missing, ', '));
  END IF;
END $$;

-- ============================================================================
-- AREA C -- reconciliation creator RPC: create_missing_payfast_settlements_v1
-- ============================================================================

-- Fixtures: one eligible completed PayFast purchase, plus rows that must be
-- skipped for each documented reason. NOTE (schema quirk): token_purchases
-- .status has no 'cancelled' value in its CHECK constraint (only pending,
-- completed, failed, abandoned) -- 'failed'/'abandoned'/'pending' are used
-- here in place of "cancelled/incomplete" per the real schema.
DO $$
DECLARE v_id uuid;
BEGIN
  v_id := pg_temp.mk_tp('PF-REF-COMPLETED-001', 'payfast', 'completed',
            '33333333-3333-3333-3333-333333333333'::uuid, 'aaaaaaaa-0000-0000-0000-000000000003'::uuid);
  PERFORM pg_temp.set_fid('tp_completed_1', v_id);

  v_id := pg_temp.mk_tp('PF-REF-FAILED-001', 'payfast', 'failed',
            '33333333-3333-3333-3333-333333333333'::uuid, 'aaaaaaaa-0000-0000-0000-000000000003'::uuid);
  PERFORM pg_temp.set_fid('tp_failed', v_id);

  v_id := pg_temp.mk_tp('PF-REF-ABANDONED-001', 'payfast', 'abandoned',
            '33333333-3333-3333-3333-333333333333'::uuid, 'aaaaaaaa-0000-0000-0000-000000000003'::uuid);
  PERFORM pg_temp.set_fid('tp_abandoned', v_id);

  v_id := pg_temp.mk_tp('PF-REF-PENDING-001', 'payfast', 'pending',
            '33333333-3333-3333-3333-333333333333'::uuid, 'aaaaaaaa-0000-0000-0000-000000000003'::uuid);
  PERFORM pg_temp.set_fid('tp_pending', v_id);

  v_id := pg_temp.mk_tp('PS-REF-COMPLETED-001', 'paystack', 'completed',
            '33333333-3333-3333-3333-333333333333'::uuid, 'aaaaaaaa-0000-0000-0000-000000000003'::uuid);
  PERFORM pg_temp.set_fid('tp_paystack', v_id);

  v_id := pg_temp.mk_tp(NULL, 'payfast', 'completed',
            '33333333-3333-3333-3333-333333333333'::uuid, 'aaaaaaaa-0000-0000-0000-000000000003'::uuid);
  PERFORM pg_temp.set_fid('tp_noref', v_id);

  PERFORM pg_temp.record_result('C', 'area C fixtures created', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result('C', 'area C fixtures created', false, SQLERRM);
END $$;

-- Snapshot the fixture rows + wallet/ledger tables BEFORE any RPC runs, for
-- the area G no-mutation proof.
DO $$
BEGIN
  PERFORM pg_temp.set_snap('tp_fixture_checksum_before', (
    SELECT md5(string_agg(t::text, '|' ORDER BY t.id))
    FROM public.token_purchases t
    WHERE t.id IN (
      pg_temp.fid('tp_completed_1'), pg_temp.fid('tp_failed'), pg_temp.fid('tp_abandoned'),
      pg_temp.fid('tp_pending'), pg_temp.fid('tp_paystack'), pg_temp.fid('tp_noref')
    )
  ));
  PERFORM pg_temp.record_result('G', 'pre-proof snapshot of token_purchases fixtures captured', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result('G', 'pre-proof snapshot of token_purchases fixtures captured', false, SQLERRM);
END $$;

DO $$
DECLARE v_count text;
BEGIN
  IF to_regclass('public.token_ledger') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::text FROM public.token_ledger' INTO v_count;
  ELSE
    v_count := 'table_not_present';
  END IF;
  PERFORM pg_temp.set_snap('token_ledger_count_before', v_count);
END $$;

DO $$
DECLARE v_count text;
BEGIN
  IF to_regclass('public.token_balances') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::text FROM public.token_balances' INTO v_count;
  ELSE
    v_count := 'table_not_present';
  END IF;
  PERFORM pg_temp.set_snap('token_balances_count_before', v_count);
END $$;

-- Run the reconciliation job as a service/internal caller (auth.uid() NULL),
-- matching how a cron/service-role invocation would look.
DO $$
DECLARE v_inserted int;
v_count int;
BEGIN
  CALL pg_temp.act_as(NULL);
  SELECT inserted INTO v_inserted FROM public.create_missing_payfast_settlements_v1(2);
  SELECT count(*) INTO v_count FROM public.payment_settlements WHERE token_purchase_id = pg_temp.fid('tp_completed_1');
  IF v_inserted = 1 AND v_count = 1 THEN
    PERFORM pg_temp.record_result('C', 'completed PayFast purchase creates exactly one settlement row', true, 'inserted=' || v_inserted);
  ELSE
    PERFORM pg_temp.record_result('C', 'completed PayFast purchase creates exactly one settlement row', false, 'inserted=' || v_inserted || ' rows_for_tp=' || v_count);
  END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result('C', 'completed PayFast purchase creates exactly one settlement row', false, SQLERRM);
END $$;

DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.payment_settlements WHERE token_purchase_id = pg_temp.fid('tp_completed_1');
  PERFORM pg_temp.set_fid('ps_completed_1', v_id);
END $$;

DO $$
DECLARE v_inserted int;
v_count int;
BEGIN
  SELECT inserted INTO v_inserted FROM public.create_missing_payfast_settlements_v1(2);
  SELECT count(*) INTO v_count FROM public.payment_settlements WHERE token_purchase_id = pg_temp.fid('tp_completed_1');
  IF v_inserted = 0 AND v_count = 1 THEN
    PERFORM pg_temp.record_result('C', 'duplicate reconciliation run creates no duplicate row', true);
  ELSE
    PERFORM pg_temp.record_result('C', 'duplicate reconciliation run creates no duplicate row', false, 'second_run_inserted=' || v_inserted || ' rows_for_tp=' || v_count);
  END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result('C', 'duplicate reconciliation run creates no duplicate row', false, SQLERRM);
END $$;

DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM public.payment_settlements
  WHERE token_purchase_id IN (pg_temp.fid('tp_failed'), pg_temp.fid('tp_abandoned'), pg_temp.fid('tp_pending'));
  IF v_bad = 0 THEN
    PERFORM pg_temp.record_result('C', 'failed/abandoned/pending PayFast purchases create no settlement row', true);
  ELSE
    PERFORM pg_temp.record_result('C', 'failed/abandoned/pending PayFast purchases create no settlement row', false, 'unexpected rows=' || v_bad);
  END IF;
END $$;

DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM public.payment_settlements WHERE token_purchase_id = pg_temp.fid('tp_paystack');
  IF v_bad = 0 THEN
    PERFORM pg_temp.record_result('C', 'non-PayFast (paystack) purchase creates no settlement row', true);
  ELSE
    PERFORM pg_temp.record_result('C', 'non-PayFast (paystack) purchase creates no settlement row', false, 'unexpected rows=' || v_bad);
  END IF;
END $$;

DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM public.payment_settlements WHERE token_purchase_id = pg_temp.fid('tp_noref');
  IF v_bad = 0 THEN
    PERFORM pg_temp.record_result('C', 'missing provider_reference purchase is skipped', true);
  ELSE
    PERFORM pg_temp.record_result('C', 'missing provider_reference purchase is skipped', false, 'unexpected rows=' || v_bad);
  END IF;
END $$;

DO $$
DECLARE r public.payment_settlements%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.payment_settlements WHERE token_purchase_id = pg_temp.fid('tp_completed_1');
  IF r.status = 'expected'
     AND r.amount_usd = 100.00
     AND r.amount_zar = 1900
     AND r.usd_zar_rate = 19.0
     AND r.expected_settlement_at IS NOT NULL
     AND r.provider = 'payfast'
     AND r.provider_reference = 'PF-REF-COMPLETED-001'
  THEN
    PERFORM pg_temp.record_result('C', 'status starts as expected; amount_usd/amount_zar/usd_zar_rate carried across from token_purchases.metadata', true);
  ELSE
    PERFORM pg_temp.record_result('C', 'status starts as expected; amount_usd/amount_zar/usd_zar_rate carried across from token_purchases.metadata', false,
      format('status=%s amount_usd=%s amount_zar=%s rate=%s expected_at=%s', r.status, r.amount_usd, r.amount_zar, r.usd_zar_rate, r.expected_settlement_at));
  END IF;
END $$;

-- ============================================================================
-- AREA B -- role / RLS enforcement on public.payment_settlements
-- ============================================================================
-- Pattern used throughout this section: capture any fixture ids needed
-- while still running as the postgres superuser, set the simulated-identity
-- GUC (session-level, unaffected by SET ROLE), THEN switch Postgres role via
-- EXECUTE 'SET ROLE ...', run exactly the statement under test, EXECUTE
-- 'RESET ROLE' back to postgres, and only then record the result. This
-- keeps every assertion running under the real Postgres privilege system
-- (table GRANTs + RLS policies) rather than under the superuser, which
-- would silently bypass both.

-- Anonymous: no GRANTs at all on the table (REVOKE ALL ... FROM anon in the
-- migration) -> any query must fail with permission denied, not merely
-- return zero rows.
DO $$
BEGIN
  CALL pg_temp.act_as(NULL);
  EXECUTE 'SET ROLE anon';
  BEGIN
    PERFORM count(*) FROM public.payment_settlements;
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.record_result('B', 'anonymous cannot read payment_settlements', false, 'SELECT unexpectedly succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.record_result('B', 'anonymous cannot read payment_settlements', true, SQLERRM);
  END;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.record_result('B', 'anonymous cannot read payment_settlements', false, SQLERRM);
END $$;

-- Ordinary authenticated customer: has table-level SELECT (granted broadly
-- to 'authenticated'), but the RLS policy only allows platform_admin /
-- auditor -> query succeeds but must return zero rows.
DO $$
DECLARE v_count int;
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003'::uuid);
  EXECUTE 'SET ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.payment_settlements;
  EXECUTE 'RESET ROLE';
  IF v_count = 0 THEN
    PERFORM pg_temp.record_result('B', 'ordinary customer reads zero payment_settlements rows despite table GRANT (RLS-filtered)', true);
  ELSE
    PERFORM pg_temp.record_result('B', 'ordinary customer reads zero payment_settlements rows despite table GRANT (RLS-filtered)', false, 'rows_visible=' || v_count);
  END IF;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.record_result('B', 'ordinary customer reads zero payment_settlements rows despite table GRANT (RLS-filtered)', false, SQLERRM);
END $$;

-- Ordinary authenticated customer: no INSERT/UPDATE/DELETE GRANT at all on
-- the table -> direct writes must fail with permission denied.
DO $$
DECLARE v_tp uuid := pg_temp.fid('tp_failed');
v_org uuid := '33333333-3333-3333-3333-333333333333'::uuid;
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003'::uuid);
  EXECUTE 'SET ROLE authenticated';
  BEGIN
    INSERT INTO public.payment_settlements (provider, provider_reference, token_purchase_id, org_id, expected_settlement_at)
    VALUES ('payfast', 'DIRECT-INSERT-ATTEMPT', v_tp, v_org, now());
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.record_result('B', 'ordinary customer cannot INSERT directly into payment_settlements', false, 'INSERT unexpectedly succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.record_result('B', 'ordinary customer cannot INSERT directly into payment_settlements', true, SQLERRM);
  END;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.record_result('B', 'ordinary customer cannot INSERT directly into payment_settlements', false, SQLERRM);
END $$;

DO $$
DECLARE v_ps uuid := pg_temp.fid('ps_completed_1');
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003'::uuid);
  EXECUTE 'SET ROLE authenticated';
  BEGIN
    UPDATE public.payment_settlements SET bank_reference = 'HACKED' WHERE id = v_ps;
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.record_result('B', 'ordinary customer cannot UPDATE payment_settlements directly', false, 'UPDATE unexpectedly succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.record_result('B', 'ordinary customer cannot UPDATE payment_settlements directly', true, SQLERRM);
  END;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.record_result('B', 'ordinary customer cannot UPDATE payment_settlements directly', false, SQLERRM);
END $$;

-- platform_admin: allowed read path via RLS.
DO $$
DECLARE v_count int;
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001'::uuid);
  EXECUTE 'SET ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.payment_settlements WHERE id = pg_temp.fid('ps_completed_1');
  EXECUTE 'RESET ROLE';
  IF v_count = 1 THEN
    PERFORM pg_temp.record_result('B', 'platform_admin can read payment_settlements via RLS', true);
  ELSE
    PERFORM pg_temp.record_result('B', 'platform_admin can read payment_settlements via RLS', false, 'rows_visible=' || v_count);
  END IF;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.record_result('B', 'platform_admin can read payment_settlements via RLS', false, SQLERRM);
END $$;

-- auditor: allowed read path via RLS, but no write GRANT (read-only).
DO $$
DECLARE v_count int;
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002'::uuid);
  EXECUTE 'SET ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.payment_settlements WHERE id = pg_temp.fid('ps_completed_1');
  EXECUTE 'RESET ROLE';
  IF v_count = 1 THEN
    PERFORM pg_temp.record_result('B', 'auditor can read payment_settlements via RLS', true);
  ELSE
    PERFORM pg_temp.record_result('B', 'auditor can read payment_settlements via RLS', false, 'rows_visible=' || v_count);
  END IF;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.record_result('B', 'auditor can read payment_settlements via RLS', false, SQLERRM);
END $$;

DO $$
DECLARE v_ps uuid := pg_temp.fid('ps_completed_1');
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002'::uuid);
  EXECUTE 'SET ROLE authenticated';
  BEGIN
    UPDATE public.payment_settlements SET bank_reference = 'AUDITOR-DIRECT-WRITE' WHERE id = v_ps;
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.record_result('B', 'auditor cannot write directly to payment_settlements (read-only)', false, 'UPDATE unexpectedly succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.record_result('B', 'auditor cannot write directly to payment_settlements (read-only)', true, SQLERRM);
  END;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.record_result('B', 'auditor cannot write directly to payment_settlements (read-only)', false, SQLERRM);
END $$;

-- ============================================================================
-- AREA D -- admin update RPC: payment_settlement_mark_v1
-- ============================================================================

-- Fixtures: one distinct token_purchase + directly-seeded payment_settlements
-- row per action scenario (token_purchase_id is UNIQUE on payment_settlements,
-- so each scenario needs its own purchase).
DO $$
DECLARE v_tp uuid; v_ps uuid;
v_org uuid := '33333333-3333-3333-3333-333333333333'::uuid;
v_cust uuid := 'aaaaaaaa-0000-0000-0000-000000000003'::uuid;
BEGIN
  v_tp := pg_temp.mk_tp('PF-D-CONFIRM-OK', 'payfast', 'completed', v_org, v_cust);
  v_ps := pg_temp.mk_ps(v_tp, v_org, 'PF-D-CONFIRM-OK');
  PERFORM pg_temp.set_fid('ps_confirm_ok', v_ps);

  v_tp := pg_temp.mk_tp('PF-D-CONFIRM-NOREF', 'payfast', 'completed', v_org, v_cust);
  v_ps := pg_temp.mk_ps(v_tp, v_org, 'PF-D-CONFIRM-NOREF');
  PERFORM pg_temp.set_fid('ps_confirm_noref', v_ps);

  v_tp := pg_temp.mk_tp('PF-D-DELAY-OK', 'payfast', 'completed', v_org, v_cust);
  v_ps := pg_temp.mk_ps(v_tp, v_org, 'PF-D-DELAY-OK');
  PERFORM pg_temp.set_fid('ps_delay_ok', v_ps);

  v_tp := pg_temp.mk_tp('PF-D-DELAY-FAIL', 'payfast', 'completed', v_org, v_cust);
  v_ps := pg_temp.mk_ps(v_tp, v_org, 'PF-D-DELAY-FAIL');
  PERFORM pg_temp.set_fid('ps_delay_fail', v_ps);

  v_tp := pg_temp.mk_tp('PF-D-EXCEPTION-OK', 'payfast', 'completed', v_org, v_cust);
  v_ps := pg_temp.mk_ps(v_tp, v_org, 'PF-D-EXCEPTION-OK');
  PERFORM pg_temp.set_fid('ps_exception_ok', v_ps);

  v_tp := pg_temp.mk_tp('PF-D-EXCEPTION-FAIL', 'payfast', 'completed', v_org, v_cust);
  v_ps := pg_temp.mk_ps(v_tp, v_org, 'PF-D-EXCEPTION-FAIL');
  PERFORM pg_temp.set_fid('ps_exception_fail', v_ps);

  v_tp := pg_temp.mk_tp('PF-D-NOTES', 'payfast', 'completed', v_org, v_cust);
  v_ps := pg_temp.mk_ps(v_tp, v_org, 'PF-D-NOTES');
  PERFORM pg_temp.set_fid('ps_notes', v_ps);

  v_tp := pg_temp.mk_tp('PF-D-CUSTOMER-DENIED', 'payfast', 'completed', v_org, v_cust);
  v_ps := pg_temp.mk_ps(v_tp, v_org, 'PF-D-CUSTOMER-DENIED');
  PERFORM pg_temp.set_fid('ps_customer_denied', v_ps);

  v_tp := pg_temp.mk_tp('PF-D-AUDITOR-DENIED', 'payfast', 'completed', v_org, v_cust);
  v_ps := pg_temp.mk_ps(v_tp, v_org, 'PF-D-AUDITOR-DENIED');
  PERFORM pg_temp.set_fid('ps_auditor_denied', v_ps);

  PERFORM pg_temp.record_result('D', 'area D fixtures created', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result('D', 'area D fixtures created', false, SQLERRM);
END $$;

-- confirm requires bank_reference: success path
DO $$
DECLARE v_status text; v_audit_before int; v_audit_after int;
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001'::uuid);
  SELECT count(*) INTO v_audit_before FROM public.admin_audit_logs WHERE target_id = pg_temp.fid('ps_confirm_ok');
  PERFORM public.payment_settlement_mark_v1(pg_temp.fid('ps_confirm_ok'), 'confirm', 'BANKREF-001', NULL, NULL);
  SELECT status INTO v_status FROM public.payment_settlements WHERE id = pg_temp.fid('ps_confirm_ok');
  SELECT count(*) INTO v_audit_after FROM public.admin_audit_logs WHERE target_id = pg_temp.fid('ps_confirm_ok');
  IF v_status = 'confirmed' AND v_audit_after = v_audit_before + 1 THEN
    PERFORM pg_temp.record_result('D', 'platform_admin can mark confirmed with bank_reference; admin_audit_logs written', true);
  ELSE
    PERFORM pg_temp.record_result('D', 'platform_admin can mark confirmed with bank_reference; admin_audit_logs written', false, 'status=' || v_status || ' audit_before=' || v_audit_before || ' audit_after=' || v_audit_after);
  END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result('D', 'platform_admin can mark confirmed with bank_reference; admin_audit_logs written', false, SQLERRM);
END $$;

-- confirm without bank_reference must be rejected
DO $$
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001'::uuid);
  BEGIN
    PERFORM public.payment_settlement_mark_v1(pg_temp.fid('ps_confirm_noref'), 'confirm', NULL, NULL, NULL);
    PERFORM pg_temp.record_result('D', 'confirm without bank_reference is rejected', false, 'RPC unexpectedly succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.record_result('D', 'confirm without bank_reference is rejected', true, SQLERRM);
  END;
END $$;

-- delay requires reason or note: success path
DO $$
DECLARE v_status text;
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001'::uuid);
  PERFORM public.payment_settlement_mark_v1(pg_temp.fid('ps_delay_ok'), 'delay', NULL, 'bank public holiday backlog', NULL);
  SELECT status INTO v_status FROM public.payment_settlements WHERE id = pg_temp.fid('ps_delay_ok');
  IF v_status = 'delayed' THEN
    PERFORM pg_temp.record_result('D', 'platform_admin can mark delayed with reason', true);
  ELSE
    PERFORM pg_temp.record_result('D', 'platform_admin can mark delayed with reason', false, 'status=' || v_status);
  END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result('D', 'platform_admin can mark delayed with reason', false, SQLERRM);
END $$;

-- delay without reason/note must be rejected
DO $$
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001'::uuid);
  BEGIN
    PERFORM public.payment_settlement_mark_v1(pg_temp.fid('ps_delay_fail'), 'delay', NULL, NULL, NULL);
    PERFORM pg_temp.record_result('D', 'delay without reason/note is rejected', false, 'RPC unexpectedly succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.record_result('D', 'delay without reason/note is rejected', true, SQLERRM);
  END;
END $$;

-- exception requires reason: success path + risk item created inline
DO $$
DECLARE v_status text; v_risk_count int;
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001'::uuid);
  PERFORM public.payment_settlement_mark_v1(pg_temp.fid('ps_exception_ok'), 'exception', NULL, 'bank rejected reference, manual follow-up required', NULL);
  SELECT status INTO v_status FROM public.payment_settlements WHERE id = pg_temp.fid('ps_exception_ok');
  SELECT count(*) INTO v_risk_count FROM public.admin_risk_items
    WHERE dedup_key = 'payfast_settlement_exception:' || pg_temp.fid('ps_exception_ok')::text;
  IF v_status = 'exception' AND v_risk_count = 1 THEN
    PERFORM pg_temp.record_result('D', 'platform_admin can mark exception with reason; inline risk item created', true);
  ELSE
    PERFORM pg_temp.record_result('D', 'platform_admin can mark exception with reason; inline risk item created', false, 'status=' || v_status || ' risk_count=' || v_risk_count);
  END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result('D', 'platform_admin can mark exception with reason; inline risk item created', false, SQLERRM);
END $$;

-- exception without reason must be rejected
DO $$
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001'::uuid);
  BEGIN
    PERFORM public.payment_settlement_mark_v1(pg_temp.fid('ps_exception_fail'), 'exception', NULL, NULL, NULL);
    PERFORM pg_temp.record_result('D', 'exception without reason is rejected', false, 'RPC unexpectedly succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.record_result('D', 'exception without reason is rejected', true, SQLERRM);
  END;
END $$;

-- add_note appends, not overwrites; before/after status captured in audit details
DO $$
DECLARE v_len_1 int; v_len_2 int; v_details jsonb;
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001'::uuid);
  PERFORM public.payment_settlement_mark_v1(pg_temp.fid('ps_notes'), 'add_note', NULL, NULL, 'first note');
  SELECT jsonb_array_length(notes) INTO v_len_1 FROM public.payment_settlements WHERE id = pg_temp.fid('ps_notes');
  PERFORM public.payment_settlement_mark_v1(pg_temp.fid('ps_notes'), 'add_note', NULL, NULL, 'second note');
  SELECT jsonb_array_length(notes) INTO v_len_2 FROM public.payment_settlements WHERE id = pg_temp.fid('ps_notes');
  SELECT details INTO v_details FROM public.admin_audit_logs
    WHERE target_id = pg_temp.fid('ps_notes') AND action = 'payment_settlement.add_note'
    ORDER BY created_at DESC LIMIT 1;
  IF v_len_1 = 1 AND v_len_2 = 2 AND v_details ? 'before_status' AND v_details ? 'after_status' THEN
    PERFORM pg_temp.record_result('D', 'add_note appends rather than overwrites; before/after status captured in admin_audit_logs.details', true, 'len_1=' || v_len_1 || ' len_2=' || v_len_2);
  ELSE
    PERFORM pg_temp.record_result('D', 'add_note appends rather than overwrites; before/after status captured in admin_audit_logs.details', false, 'len_1=' || v_len_1 || ' len_2=' || v_len_2 || ' details=' || v_details::text);
  END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result('D', 'add_note appends rather than overwrites; before/after status captured in admin_audit_logs.details', false, SQLERRM);
END $$;

-- ordinary customer cannot call the update RPC
DO $$
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003'::uuid);
  EXECUTE 'SET ROLE authenticated';
  BEGIN
    PERFORM public.payment_settlement_mark_v1(pg_temp.fid('ps_customer_denied'), 'confirm', 'X', NULL, NULL);
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.record_result('D', 'ordinary customer cannot call payment_settlement_mark_v1', false, 'RPC unexpectedly succeeded');
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.record_result('D', 'ordinary customer cannot call payment_settlement_mark_v1', true, SQLERRM);
  END;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.record_result('D', 'ordinary customer cannot call payment_settlement_mark_v1', false, SQLERRM);
END $$;

-- auditor cannot call the update RPC (read-only role)
DO $$
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002'::uuid);
  EXECUTE 'SET ROLE authenticated';
  BEGIN
    PERFORM public.payment_settlement_mark_v1(pg_temp.fid('ps_auditor_denied'), 'confirm', 'X', NULL, NULL);
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.record_result('D', 'auditor cannot call payment_settlement_mark_v1', false, 'RPC unexpectedly succeeded');
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.record_result('D', 'auditor cannot call payment_settlement_mark_v1', true, SQLERRM);
  END;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.record_result('D', 'auditor cannot call payment_settlement_mark_v1', false, SQLERRM);
END $$;

-- ============================================================================
-- AREA E -- list RPC: payment_settlements_list_v1
-- ============================================================================

DO $$
DECLARE v_count int;
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001'::uuid);
  EXECUTE 'SET ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.payment_settlements_list_v1();
  EXECUTE 'RESET ROLE';
  IF v_count >= 1 THEN
    PERFORM pg_temp.record_result('E', 'platform_admin can list settlements', true, 'rows=' || v_count);
  ELSE
    PERFORM pg_temp.record_result('E', 'platform_admin can list settlements', false, 'rows=' || v_count);
  END IF;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.record_result('E', 'platform_admin can list settlements', false, SQLERRM);
END $$;

DO $$
DECLARE v_count int;
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002'::uuid);
  EXECUTE 'SET ROLE authenticated';
  SELECT count(*) INTO v_count FROM public.payment_settlements_list_v1();
  EXECUTE 'RESET ROLE';
  IF v_count >= 1 THEN
    PERFORM pg_temp.record_result('E', 'auditor can list settlements', true, 'rows=' || v_count);
  ELSE
    PERFORM pg_temp.record_result('E', 'auditor can list settlements', false, 'rows=' || v_count);
  END IF;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.record_result('E', 'auditor can list settlements', false, SQLERRM);
END $$;

DO $$
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003'::uuid);
  EXECUTE 'SET ROLE authenticated';
  BEGIN
    PERFORM count(*) FROM public.payment_settlements_list_v1();
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.record_result('E', 'ordinary customer cannot list settlements', false, 'RPC unexpectedly succeeded');
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.record_result('E', 'ordinary customer cannot list settlements', true, SQLERRM);
  END;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.record_result('E', 'ordinary customer cannot list settlements', false, SQLERRM);
END $$;

-- Filters: status, provider, provider_reference search, org, date range,
-- limit/offset, and confirm the returned shape carries the fields a future
-- admin UI needs.
DO $$
DECLARE v_row jsonb;
v_status_count int;
v_ref_count int;
v_org_count int;
v_future_count int;
v_limited_count int;
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001'::uuid);
  EXECUTE 'SET ROLE authenticated';

  SELECT count(*) INTO v_status_count FROM public.payment_settlements_list_v1(p_status := 'confirmed');
  SELECT count(*) INTO v_ref_count FROM public.payment_settlements_list_v1(p_provider_reference := 'PF-D-CONFIRM-OK');
  SELECT count(*) INTO v_org_count FROM public.payment_settlements_list_v1(p_org_id := '33333333-3333-3333-3333-333333333333'::uuid);
  SELECT count(*) INTO v_future_count FROM public.payment_settlements_list_v1(p_date_from := now() + interval '10 years');
  SELECT count(*) INTO v_limited_count FROM public.payment_settlements_list_v1(p_limit := 1);
  SELECT to_jsonb(x) INTO v_row FROM public.payment_settlements_list_v1() x LIMIT 1;

  EXECUTE 'RESET ROLE';

  IF v_status_count >= 1
     AND v_ref_count = 1
     AND v_org_count >= 1
     AND v_future_count = 0
     AND v_limited_count = 1
     AND v_row ? 'id' AND v_row ? 'status' AND v_row ? 'org_name' AND v_row ? 'bank_reference' AND v_row ? 'expected_settlement_at'
  THEN
    PERFORM pg_temp.record_result('E', 'list RPC filters (status/provider_reference/org/date range/limit) and return shape all work', true,
      format('status=%s ref=%s org=%s future=%s limited=%s', v_status_count, v_ref_count, v_org_count, v_future_count, v_limited_count));
  ELSE
    PERFORM pg_temp.record_result('E', 'list RPC filters (status/provider_reference/org/date range/limit) and return shape all work', false,
      format('status=%s ref=%s org=%s future=%s limited=%s row=%s', v_status_count, v_ref_count, v_org_count, v_future_count, v_limited_count, v_row::text));
  END IF;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.record_result('E', 'list RPC filters (status/provider_reference/org/date range/limit) and return shape all work', false, SQLERRM);
END $$;

-- ============================================================================
-- AREA F -- risk-item detection RPC: detect_payment_settlement_risks_v1
-- ============================================================================
-- The exception-triggers-a-risk-item path is already proven in AREA D (every
-- 'exception' action inserts/updates an admin_risk_items row inline, inside
-- payment_settlement_mark_v1 itself). This section proves the two paths that
-- live in detect_payment_settlement_risks_v1: overdue-expected settlements
-- and paid-but-unsettled purchases, plus idempotency and the admin-only gate.

-- Fixture: an 'expected' settlement whose expected_settlement_at is already
-- in the past (overdue).
DO $$
DECLARE v_tp uuid; v_ps uuid;
v_org uuid := '33333333-3333-3333-3333-333333333333'::uuid;
v_cust uuid := 'aaaaaaaa-0000-0000-0000-000000000003'::uuid;
BEGIN
  v_tp := pg_temp.mk_tp('PF-F-OVERDUE', 'payfast', 'completed', v_org, v_cust);
  v_ps := pg_temp.mk_ps(v_tp, v_org, 'PF-F-OVERDUE', now() - interval '5 days');
  PERFORM pg_temp.set_fid('ps_overdue', v_ps);
  PERFORM pg_temp.record_result('F', 'area F overdue fixture created', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result('F', 'area F overdue fixture created', false, SQLERRM);
END $$;

-- Fixture: a completed PayFast purchase, old enough to cross the
-- missing-settlement threshold, that intentionally has NO settlement row.
-- Created only now (after both AREA C reconciliation runs) so it is never
-- swept up by create_missing_payfast_settlements_v1.
DO $$
DECLARE v_tp uuid;
v_org uuid := '33333333-3333-3333-3333-333333333333'::uuid;
v_cust uuid := 'aaaaaaaa-0000-0000-0000-000000000003'::uuid;
BEGIN
  v_tp := pg_temp.mk_tp('PF-F-MISSING-SETTLEMENT', 'payfast', 'completed', v_org, v_cust, now() - interval '48 hours');
  PERFORM pg_temp.set_fid('tp_missing_settlement', v_tp);
  PERFORM pg_temp.record_result('F', 'area F missing-settlement fixture created (48h-old completed purchase, no settlement row)', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result('F', 'area F missing-settlement fixture created (48h-old completed purchase, no settlement row)', false, SQLERRM);
END $$;

DO $$
DECLARE v_first int; v_second int;
v_overdue_count int; v_missing_count int;
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001'::uuid);
  SELECT inserted INTO v_first FROM public.detect_payment_settlement_risks_v1(2, 24);

  SELECT count(*) INTO v_overdue_count FROM public.admin_risk_items
    WHERE dedup_key = 'payfast_settlement_overdue:' || pg_temp.fid('ps_overdue')::text;
  SELECT count(*) INTO v_missing_count FROM public.admin_risk_items
    WHERE dedup_key = 'payfast_paid_no_settlement_record:' || pg_temp.fid('tp_missing_settlement')::text;

  IF v_overdue_count = 1 AND v_missing_count = 1 THEN
    PERFORM pg_temp.record_result('F', 'overdue expected-settlement and paid-no-settlement-record are both detected', true, 'inserted=' || v_first);
  ELSE
    PERFORM pg_temp.record_result('F', 'overdue expected-settlement and paid-no-settlement-record are both detected', false, 'overdue_count=' || v_overdue_count || ' missing_count=' || v_missing_count);
  END IF;

  SELECT inserted INTO v_second FROM public.detect_payment_settlement_risks_v1(2, 24);
  SELECT count(*) INTO v_overdue_count FROM public.admin_risk_items
    WHERE dedup_key = 'payfast_settlement_overdue:' || pg_temp.fid('ps_overdue')::text;
  SELECT count(*) INTO v_missing_count FROM public.admin_risk_items
    WHERE dedup_key = 'payfast_paid_no_settlement_record:' || pg_temp.fid('tp_missing_settlement')::text;

  IF v_overdue_count = 1 AND v_missing_count = 1 THEN
    PERFORM pg_temp.record_result('F', 'risk detection is idempotent/deduplicated on re-run (same dedup_key, no duplicate rows)', true, 'second_run_inserted=' || v_second);
  ELSE
    PERFORM pg_temp.record_result('F', 'risk detection is idempotent/deduplicated on re-run (same dedup_key, no duplicate rows)', false, 'overdue_count=' || v_overdue_count || ' missing_count=' || v_missing_count);
  END IF;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record_result('F', 'overdue expected-settlement and paid-no-settlement-record are both detected', false, SQLERRM);
  PERFORM pg_temp.record_result('F', 'risk detection is idempotent/deduplicated on re-run (same dedup_key, no duplicate rows)', false, 'not reached: ' || SQLERRM);
END $$;

-- Ordinary customer cannot run risk detection (admin-only, same as
-- create_missing_payfast_settlements_v1's forbidden-when-uid-set gate).
DO $$
BEGIN
  CALL pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003'::uuid);
  EXECUTE 'SET ROLE authenticated';
  BEGIN
    PERFORM public.detect_payment_settlement_risks_v1(2, 24);
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.record_result('F', 'ordinary customer cannot run detect_payment_settlement_risks_v1', false, 'RPC unexpectedly succeeded');
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.record_result('F', 'ordinary customer cannot run detect_payment_settlement_risks_v1', true, SQLERRM);
  END;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.record_result('F', 'ordinary customer cannot run detect_payment_settlement_risks_v1', false, SQLERRM);
END $$;

-- NOTE ON COVERAGE: this section proves both detection paths implemented in
-- PR #31 (overdue-expected, paid-no-settlement-record), idempotency, and the
-- admin-only gate. It does not simulate severity/alert-routing/notification
-- delivery, because PR #31 does not implement any such delivery layer --
-- detect_payment_settlement_risks_v1 only writes to admin_risk_items. This
-- is recorded as a limitation in the accompanying report, not left silent.

-- ============================================================================
-- AREA G -- no wallet / ledger / payment-confirmation mutation proof
-- ============================================================================
-- Compares the original AREA C token_purchases fixture rows, plus
-- token_ledger and token_balances row counts, against their pre-proof
-- snapshots (captured in AREA C before any RPC ran). Every RPC exercised
-- above (reconciliation creator, admin update, list, risk detection) has now
-- run at least once against these fixtures.

DO $$
DECLARE v_before text; v_after text;
BEGIN
  v_before := pg_temp.get_snap('tp_fixture_checksum_before');
  SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) INTO v_after
  FROM public.token_purchases t
  WHERE t.id IN (
    pg_temp.fid('tp_completed_1'), pg_temp.fid('tp_failed'), pg_temp.fid('tp_abandoned'),
    pg_temp.fid('tp_pending'), pg_temp.fid('tp_paystack'), pg_temp.fid('tp_noref')
  );
  IF v_before IS NOT NULL AND v_before = v_after THEN
    PERFORM pg_temp.record_result('G', 'token_purchases fixture rows byte-identical before/after all RPC calls (no mutation)', true);
  ELSE
    PERFORM pg_temp.record_result('G', 'token_purchases fixture rows byte-identical before/after all RPC calls (no mutation)', false, 'before=' || coalesce(v_before,'NULL') || ' after=' || coalesce(v_after,'NULL'));
  END IF;
END $$;

DO $$
DECLARE v_before text; v_after text;
BEGIN
  v_before := pg_temp.get_snap('token_ledger_count_before');
  IF to_regclass('public.token_ledger') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::text FROM public.token_ledger' INTO v_after;
  ELSE
    v_after := 'table_not_present';
  END IF;
  IF v_before = v_after THEN
    PERFORM pg_temp.record_result('G', 'token_ledger row count unchanged before/after all RPC calls', true, 'count=' || v_after);
  ELSE
    PERFORM pg_temp.record_result('G', 'token_ledger row count unchanged before/after all RPC calls', false, 'before=' || v_before || ' after=' || v_after);
  END IF;
END $$;

DO $$
DECLARE v_before text; v_after text;
BEGIN
  v_before := pg_temp.get_snap('token_balances_count_before');
  IF to_regclass('public.token_balances') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::text FROM public.token_balances' INTO v_after;
  ELSE
    v_after := 'table_not_present';
  END IF;
  IF v_before = v_after THEN
    PERFORM pg_temp.record_result('G', 'token_balances (wallet) row count unchanged before/after all RPC calls', true, 'count=' || v_after);
  ELSE
    PERFORM pg_temp.record_result('G', 'token_balances (wallet) row count unchanged before/after all RPC calls', false, 'before=' || v_before || ' after=' || v_after);
  END IF;
END $$;

-- The admin-update RPC calls above (AREA D) targeted purchases that were
-- never part of the reconciliation-eligible fixture set checksummed above,
-- so as a second, independent no-mutation check: confirm none of the AREA D
-- / AREA F token_purchases rows have been touched by anything except their
-- own initial INSERT (updated_at should equal created_at for every one of
-- them, since only an UPDATE would move updated_at away from created_at via
-- trg_token_purchases_updated_at).
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.token_purchases
  WHERE provider_reference LIKE 'PF-D-%' OR provider_reference LIKE 'PF-F-%'
  AND updated_at <> created_at;
  IF v_bad = 0 THEN
    PERFORM pg_temp.record_result('G', 'admin-update / risk-detection RPCs never UPDATE token_purchases (updated_at still equals created_at)', true);
  ELSE
    PERFORM pg_temp.record_result('G', 'admin-update / risk-detection RPCs never UPDATE token_purchases (updated_at still equals created_at)', false, 'rows_with_updated_at_moved=' || v_bad);
  END IF;
END $$;

-- ============================================================================
-- FINAL GATE -- fail the job (non-zero psql exit) if any check above failed
-- ============================================================================
DO $$
DECLARE r record;
v_total int;
v_failed int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT passed) INTO v_total, v_failed FROM pg_temp.proof_results;

  RAISE NOTICE '=== PayFast Settlement Tracking Phase 1 -- Runtime Proof Results ===';
  FOR r IN SELECT area, check_name, passed, detail FROM pg_temp.proof_results ORDER BY seq LOOP
    RAISE NOTICE '[%] % -- % %', r.area, CASE WHEN r.passed THEN 'PASS' ELSE 'FAIL' END, r.check_name, coalesce('(' || r.detail || ')', '');
  END LOOP;
  RAISE NOTICE '=== % / % checks passed ===', (v_total - v_failed), v_total;

  IF v_failed > 0 THEN
    RAISE EXCEPTION 'RUNTIME_PROOF_FAILED: % of % checks failed', v_failed, v_total;
  ELSE
    RAISE NOTICE 'RUNTIME_PROOF_PASSED: all % checks passed', v_total;
  END IF;
END $$;
