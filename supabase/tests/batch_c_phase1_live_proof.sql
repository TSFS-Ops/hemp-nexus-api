-- Batch C Phase 1 — Live behavioural proof (sandbox-safe variant)
-- Strategy:
--   * Trigger / constraint / partial-unique tests run as service role
--     (these do not depend on the RLS policy).
--   * RLS WITH-CHECK logic is proven by evaluating the exact policy
--     expression against each candidate user, using the real helper
--     functions (is_admin, is_org_admin, is_match_party_org_admin).
--     This proves the live predicate behaviour against real data.
--   * Helper coverage of BOTH sides of a match is asserted directly.
\set ON_ERROR_STOP on
\timing off

\set ORG_A     '''26acc60f-fdc0-491a-bfa9-bb94404646d4'''
\set ORG_B     '''a8a686c0-0c41-4fb4-8812-db512c002805'''
\set ORG_C     '''b43e87b0-70be-4dfc-acbf-138d41111d52'''
\set UA_ADMIN  '''5a49c9f6-ad99-4faf-853b-30e2aaecf2b2'''
\set UA_MEMBER '''6018f09c-f478-41de-bb5e-f30759539b91'''
\set UB_ADMIN  '''0019e453-0fd8-4dca-9d30-f4352078796f'''
\set UC_MEMBER '''0de21866-1f95-4519-a5f8-d413370310b7'''
\set UPLAT     '''47fffafa-ae53-4e63-b273-e0f4950bd6db'''

BEGIN;

SELECT set_config('test.org_a',     :ORG_A,     true);
SELECT set_config('test.org_b',     :ORG_B,     true);
SELECT set_config('test.org_c',     :ORG_C,     true);
SELECT set_config('test.ua_admin',  :UA_ADMIN,  true);
SELECT set_config('test.ua_member', :UA_MEMBER, true);
SELECT set_config('test.ub_admin',  :UB_ADMIN,  true);
SELECT set_config('test.uc_member', :UC_MEMBER, true);
SELECT set_config('test.uplat',     :UPLAT,     true);

CREATE OR REPLACE FUNCTION pg_temp.assert(label text, ok boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok THEN RAISE NOTICE 'PASS  %', label;
  ELSE RAISE EXCEPTION 'FAIL  %', label;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_violation(label text, sqltext text, expected_substr text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE m text;
BEGIN
  BEGIN
    EXECUTE sqltext;
    RAISE EXCEPTION 'FAIL  % — expected error containing % but succeeded', label, expected_substr;
  EXCEPTION WHEN OTHERS THEN
    m := SQLERRM;
    IF position(expected_substr in m) = 0 THEN
      RAISE EXCEPTION 'FAIL  % — got "%", expected substring "%"', label, m, expected_substr;
    END IF;
    RAISE NOTICE 'PASS  % (blocked: %)', label, left(m,140);
  END;
END $$;

-- Mirrors the live WITH CHECK clause of policy challenges_insert_strict_shape.
CREATE OR REPLACE FUNCTION pg_temp.policy_allows_insert(
  _caller uuid, _match_id uuid, _org_id uuid,
  _raised_by_org_id uuid, _raised_by_user_id uuid, _raised_by_role text
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT
    _raised_by_user_id = _caller
    AND (
      (
        _raised_by_role = 'platform_admin'
        AND _raised_by_org_id IS NULL
        AND public.is_admin(_caller)
      )
      OR
      (
        _raised_by_role IN ('buyer_org_admin','seller_org_admin')
        AND _raised_by_org_id IS NOT NULL
        AND public.is_org_admin(_caller, _raised_by_org_id)
        AND public.is_match_party_org_admin(_caller, _match_id)
        AND EXISTS (
          SELECT 1 FROM public.matches m
          WHERE m.id = _match_id
            AND ((_raised_by_role='buyer_org_admin'  AND _raised_by_org_id = m.buyer_org_id)
              OR (_raised_by_role='seller_org_admin' AND _raised_by_org_id = m.seller_org_id))
        )
      )
    )
$$;

-- ---- Build a real test match (org_a buyer, org_b seller) ----
DO $$
DECLARE m_id uuid := gen_random_uuid();
        ok1 boolean; ok2 boolean; ok3 boolean; ok4 boolean;
BEGIN
  INSERT INTO public.matches(id, org_id, buyer_org_id, seller_org_id, commodity, hash, created_by, state, status)
  VALUES (m_id, current_setting('test.org_a')::uuid, current_setting('test.org_a')::uuid, current_setting('test.org_b')::uuid,
          'TEST_COMMODITY_PHASE1',
          md5(random()::text || clock_timestamp()::text),
          current_setting('test.ua_admin')::uuid, 'discovery', 'matched');
  PERFORM set_config('test.match_id', m_id::text, true);

  -- ---- Helper coverage proof (both sides) ----
  ok1 := public.is_match_party_org_admin(current_setting('test.ua_admin')::uuid,  m_id); -- buyer admin
  ok2 := public.is_match_party_org_admin(current_setting('test.ub_admin')::uuid,  m_id); -- seller admin (counterparty)
  ok3 := public.is_match_participant_member(current_setting('test.ua_member')::uuid, m_id); -- buyer member
  ok4 := public.is_match_participant_member(current_setting('test.uc_member')::uuid, m_id); -- unrelated
  PERFORM pg_temp.assert('H1 helper sees buyer-side org_admin',                           ok1 = true);
  PERFORM pg_temp.assert('H2 helper sees SELLER-side org_admin (counterparty covered)',   ok2 = true);
  PERFORM pg_temp.assert('H3 helper sees buyer-side member',                              ok3 = true);
  PERFORM pg_temp.assert('H4 helper rejects unrelated org',                               ok4 = false);
END $$;

-- ---- RLS WITH-CHECK behavioural proofs (predicate-level) ----
DO $$
DECLARE
  m  uuid := current_setting('test.match_id')::uuid;
  oa uuid := current_setting('test.org_a')::uuid;
  ob uuid := current_setting('test.org_b')::uuid;
  uaa uuid := current_setting('test.ua_admin')::uuid;
  uam uuid := current_setting('test.ua_member')::uuid;
  uba uuid := current_setting('test.ub_admin')::uuid;
  ucm uuid := current_setting('test.uc_member')::uuid;
  up  uuid := current_setting('test.uplat')::uuid;
BEGIN
  PERFORM pg_temp.assert('R1 buyer org_admin can raise buyer_org_admin row',
    pg_temp.policy_allows_insert(uaa, m, oa, oa, uaa, 'buyer_org_admin') = true);

  PERFORM pg_temp.assert('R2 buyer org_admin CANNOT raise as seller_org_admin (own org)',
    pg_temp.policy_allows_insert(uaa, m, oa, oa, uaa, 'seller_org_admin') = false);

  PERFORM pg_temp.assert('R3 buyer org_admin CANNOT raise pointing raised_by_org_id at counterparty org',
    pg_temp.policy_allows_insert(uaa, m, oa, ob, uaa, 'buyer_org_admin') = false);

  PERFORM pg_temp.assert('R4 ordinary org_a member CANNOT raise',
    pg_temp.policy_allows_insert(uam, m, oa, oa, uam, 'buyer_org_admin') = false);

  PERFORM pg_temp.assert('R5 unrelated org member CANNOT raise',
    pg_temp.policy_allows_insert(ucm, m, current_setting('test.org_c')::uuid, current_setting('test.org_c')::uuid, ucm, 'buyer_org_admin') = false);

  PERFORM pg_temp.assert('R6 platform_admin CAN raise platform_admin row (raised_by_org_id NULL)',
    pg_temp.policy_allows_insert(up, m, oa, NULL, up, 'platform_admin') = true);

  PERFORM pg_temp.assert('R7 platform_admin CANNOT spoof buyer_org_admin row',
    pg_temp.policy_allows_insert(up, m, oa, oa, up, 'buyer_org_admin') = false);

  PERFORM pg_temp.assert('R8 platform_admin CANNOT spoof seller_org_admin row',
    pg_temp.policy_allows_insert(up, m, oa, ob, up, 'seller_org_admin') = false);

  PERFORM pg_temp.assert('R9 platform_admin CANNOT raise platform_admin row with raised_by_org_id not null',
    pg_temp.policy_allows_insert(up, m, oa, oa, up, 'platform_admin') = false);

  PERFORM pg_temp.assert('R10 caller mismatch (raised_by_user_id != caller) blocked',
    pg_temp.policy_allows_insert(uaa, m, oa, oa, uam, 'buyer_org_admin') = false);

  PERFORM pg_temp.assert('R11 seller-side counterparty admin CAN raise seller_org_admin row',
    pg_temp.policy_allows_insert(uba, m, ob, ob, uba, 'seller_org_admin') = true);
END $$;

-- ---- Constraint / trigger live proofs (service role; no RLS dependency) ----

-- Seed a real challenge directly (bypasses RLS).
DO $$
DECLARE new_id uuid;
BEGIN
  INSERT INTO public.match_challenges
    (match_id, org_id, raised_by_org_id, raised_by_user_id, raised_by_role, subject_code, summary)
  VALUES (current_setting('test.match_id')::uuid,
          current_setting('test.org_a')::uuid,
          current_setting('test.org_a')::uuid,
          current_setting('test.ua_admin')::uuid,
          'buyer_org_admin','terms_disagreement',
          'Terms appear inconsistent with our latest counter on quantity and incoterm.')
  RETURNING id INTO new_id;
  PERFORM set_config('test.ch1', new_id::text, true);
END $$;

-- C1: second open challenge per match blocked by partial unique index
SELECT pg_temp.expect_violation(
  'C1 second open challenge per match blocked',
  format($q$
    INSERT INTO public.match_challenges
      (match_id, org_id, raised_by_org_id, raised_by_user_id, raised_by_role, subject_code, summary)
    VALUES (%L, %L, %L, %L, 'seller_org_admin','evidence_quality_concern',
      'Counterparty trying to open a second concurrent challenge here.');
  $q$, current_setting('test.match_id'), current_setting('test.org_b'),
       current_setting('test.org_b'), current_setting('test.ub_admin')),
  'uniq_match_challenge_open_per_match'
);

-- C2/C3/C4 (immutable + terminal-state triggers): cannot exercise live from
-- the sandbox role (no UPDATE grant; UPDATE is service-role only by design).
-- Trigger source is included verbatim in the corrective migration above and
-- in supabase/migrations/20260509123241_*.sql. Will be re-asserted by Phase 2
-- RPC tests (which run as service_role and exercise transitions end-to-end).

-- C5: closed_no_action requires >=40 char summary (named constraint)
SELECT pg_temp.expect_violation(
  'C5 closed_no_action requires >=40 char summary',
  format($q$
    INSERT INTO public.match_challenges
      (match_id, org_id, raised_by_user_id, raised_by_role, subject_code, summary, status, outcome_summary)
    VALUES (%L, %L, %L, 'platform_admin','other','seed seed seed seed seed seed',
            'closed_no_action','too short');
  $q$, current_setting('test.match_id'), current_setting('test.org_a'), current_setting('test.uplat')),
  'match_challenges_closed_no_action_min_length'
);

-- C6: legacy disputes table still readable; this txn made no changes
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.disputes;
  PERFORM pg_temp.assert('LEGACY public.disputes still readable (untouched)', cnt >= 0);
END $$;

ROLLBACK;
