-- =====================================================================
-- BATCH 9F — Evidence Fixture Migration (DRAFT — NOT APPLIED)
-- Status:   BATCH_9F_PREP_AND_STATIC_EVIDENCE_ONLY
-- Purpose:  Seed the minimum evidence records needed for the authenticated
--           UI click-through. Designed to be applied ONLY after the project
--           owner has created the five @test.izenzo.co.za accounts in
--           Cloud → Users and supplied their auth.users.id values.
-- Apply:    DO NOT APPLY YET. Replace the five :evidence_*_uid psql vars
--           with real UUIDs, review, then submit via the migration tool.
-- =====================================================================

-- ---------------------------------------------------------------------
-- INPUTS (must be replaced before review/apply)
-- ---------------------------------------------------------------------
-- \set evidence_platform_admin_uid    '00000000-0000-0000-0000-000000000000'
-- \set evidence_compliance_uid        '00000000-0000-0000-0000-000000000000'
-- \set evidence_case_owner_uid        '00000000-0000-0000-0000-000000000000'
-- \set evidence_requester_uid         '00000000-0000-0000-0000-000000000000'
-- \set evidence_unrelated_uid         '00000000-0000-0000-0000-000000000000'

-- ---------------------------------------------------------------------
-- SCHEMA REALITY NOTE (must be acknowledged in review)
-- ---------------------------------------------------------------------
-- public.facilitation_cases  has NO `metadata` column.    Marker = case_number prefix 'EVIDENCE-9F-' + is_demo=true.
-- public.organizations       has NO `metadata` column.    Marker = name prefix 'Evidence '      + is_demo=true + demo_dataset_id.
-- public.trade_requests      HAS `metadata` jsonb.        Marker = metadata->>'evidence_fixture'='true' + is_demo=true.
-- public.notifications       HAS no `metadata` column.    Marker = entity_type='facilitation_case' + entity_id IN (fixtures) + is_demo=true.
-- public.compliance_holds    HAS `metadata` jsonb.        Marker = metadata->>'evidence_fixture'='true' + is_demo=true.
-- A single demo_dataset_id UUID is used across all rows so rollback can
-- target exactly this fixture batch.

BEGIN;

-- One UUID per fixture batch, captured for rollback.
WITH ds AS (SELECT 'b9f00000-0000-0000-0000-000000000000'::uuid AS demo_dataset_id) SELECT 1;

-- =====================================================================
-- 1. ORGANISATIONS  (3 fixtures)
-- =====================================================================
INSERT INTO public.organizations (id, name, status, data_region, cross_border_consent, frozen,
                                  token_opening_balance, clip_on_always_on, billing_hold,
                                  is_demo, demo_dataset_id)
VALUES
  ('b9f10000-0000-0000-0000-000000000001', 'Evidence Ops Org 9F',        'active', 'ZA', false, false, 0, false, false, true, 'b9f00000-0000-0000-0000-000000000000'),
  ('b9f10000-0000-0000-0000-000000000002', 'Evidence Requester Org 9F',  'active', 'ZA', false, false, 0, false, false, true, 'b9f00000-0000-0000-0000-000000000000'),
  ('b9f10000-0000-0000-0000-000000000003', 'Evidence Unrelated Org 9F',  'active', 'ZA', false, false, 0, false, false, true, 'b9f00000-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- 2. PROFILES / ORG MEMBERSHIP
-- =====================================================================
INSERT INTO public.profiles (id, user_id, org_id, email, full_name, status, is_demo, demo_dataset_id)
VALUES
  (gen_random_uuid(), :'evidence_platform_admin_uid', 'b9f10000-0000-0000-0000-000000000001', 'evidence-9f-platform-admin@test.izenzo.co.za',    'Evidence 9F Platform Admin',     'active', true, 'b9f00000-0000-0000-0000-000000000000'),
  (gen_random_uuid(), :'evidence_compliance_uid',     'b9f10000-0000-0000-0000-000000000001', 'evidence-9f-compliance-analyst@test.izenzo.co.za','Evidence 9F Compliance Analyst', 'active', true, 'b9f00000-0000-0000-0000-000000000000'),
  (gen_random_uuid(), :'evidence_case_owner_uid',     'b9f10000-0000-0000-0000-000000000001', 'evidence-9f-case-owner@test.izenzo.co.za',        'Evidence 9F Case Owner',         'active', true, 'b9f00000-0000-0000-0000-000000000000'),
  (gen_random_uuid(), :'evidence_requester_uid',      'b9f10000-0000-0000-0000-000000000002', 'evidence-9f-requester@test.izenzo.co.za',         'Evidence 9F Requester',          'active', true, 'b9f00000-0000-0000-0000-000000000000'),
  (gen_random_uuid(), :'evidence_unrelated_uid',      'b9f10000-0000-0000-0000-000000000003', 'evidence-9f-unrelated@test.izenzo.co.za',         'Evidence 9F Unrelated',          'active', true, 'b9f00000-0000-0000-0000-000000000000')
ON CONFLICT DO NOTHING;

-- =====================================================================
-- 3. USER ROLES — only the roles needed for the verification matrix.
-- No super_admin / billing_admin / unrelated roles are granted.
-- =====================================================================
INSERT INTO public.user_roles (user_id, role) VALUES
  (:'evidence_platform_admin_uid', 'platform_admin'),
  (:'evidence_compliance_uid',     'compliance_analyst'),
  (:'evidence_case_owner_uid',     'trade_operations')
ON CONFLICT (user_id, role) DO NOTHING;
-- Requester and Unrelated get NO row in user_roles (default authenticated only).

-- =====================================================================
-- 4. TRADE REQUEST anchor  (facilitation_cases.trade_request_id is NOT NULL).
-- Status = 'draft' or 'active' but never bound; no commercial side effects.
-- =====================================================================
INSERT INTO public.trade_requests (id, org_id, created_by, commodity, side, status, match_type,
                                   metadata, is_demo, demo_dataset_id)
VALUES
  ('b9f20000-0000-0000-0000-000000000001',
   'b9f10000-0000-0000-0000-000000000002',
   :'evidence_requester_uid',
   'Evidence Commodity 9F', 'buyer', 'draft', 'bilateral',
   jsonb_build_object('evidence_fixture', true, 'batch', '9F'),
   true, 'b9f00000-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- 5. FACILITATION CASES  (7 fixtures)
-- All requesting_org_id = Evidence Requester Org 9F, requesting_user_id = requester.
-- All case_owner_id = case owner (except F6 which is owned by compliance analyst).
-- =====================================================================
INSERT INTO public.facilitation_cases (
    id, case_number, requesting_org_id, requesting_user_id, trade_request_id,
    counterparty_legal_name, counterparty_country,
    product_or_commodity, role, estimated_value_amount, estimated_value_currency,
    urgency, reason, how_user_knows_counterparty,
    permission_to_contact, user_declaration_accepted, user_declaration_accepted_at,
    internal_status, user_facing_status, case_owner_id,
    closing_reason, final_outcome,
    is_overdue, overdue_reasons,
    next_action_due_at,
    is_demo, demo_dataset_id
)
VALUES
  -- F1 — open, no final_outcome, no closing_reason → proves drawer blocks close
  ('b9f30000-0000-0000-0000-000000000001', 'EVIDENCE-9F-DRAWER-OPEN',
   'b9f10000-0000-0000-0000-000000000002', :'evidence_requester_uid', 'b9f20000-0000-0000-0000-000000000001',
   'Evidence Counterparty Alpha (FIXTURE)', 'ZA',
   'Evidence Commodity 9F', 'buyer', 0, 'USD',
   'normal', 'Evidence fixture — verification of drawer closure enforcement', 'no_prior_contact',
   false, true, now(),
   'admin_reviewing', 'in_review', :'evidence_case_owner_uid',
   NULL, NULL,
   false, ARRAY[]::text[],
   now() + interval '3 days',
   true, 'b9f00000-0000-0000-0000-000000000000'),

  -- F2 — open, ready to attempt sensitive closure outcome
  ('b9f30000-0000-0000-0000-000000000002', 'EVIDENCE-9F-SENSITIVE-CLOSURE',
   'b9f10000-0000-0000-0000-000000000002', :'evidence_requester_uid', 'b9f20000-0000-0000-0000-000000000001',
   'Evidence Counterparty Bravo (FIXTURE)', 'ZA',
   'Evidence Commodity 9F', 'buyer', 0, 'USD',
   'normal', 'Evidence fixture — sensitive closure reason gate', 'no_prior_contact',
   false, true, now(),
   'admin_reviewing', 'in_review', :'evidence_case_owner_uid',
   NULL, NULL,
   false, ARRAY[]::text[],
   now() + interval '3 days',
   true, 'b9f00000-0000-0000-0000-000000000000'),

  -- F3 — positive counterparty response recorded → next-step panel visible
  ('b9f30000-0000-0000-0000-000000000003', 'EVIDENCE-9F-POSITIVE-RESPONSE',
   'b9f10000-0000-0000-0000-000000000002', :'evidence_requester_uid', 'b9f20000-0000-0000-0000-000000000001',
   'Evidence Counterparty Charlie (FIXTURE)', 'ZA',
   'Evidence Commodity 9F', 'buyer', 0, 'USD',
   'normal', 'Evidence fixture — positive response next steps', 'no_prior_contact',
   false, true, now(),
   'counterparty_responded', 'in_review', :'evidence_case_owner_uid',
   NULL, NULL,
   false, ARRAY[]::text[],
   now() + interval '3 days',
   true, 'b9f00000-0000-0000-0000-000000000000'),

  -- F4 — requester-safe notification milestone
  ('b9f30000-0000-0000-0000-000000000004', 'EVIDENCE-9F-REQUESTER-NOTIF',
   'b9f10000-0000-0000-0000-000000000002', :'evidence_requester_uid', 'b9f20000-0000-0000-0000-000000000001',
   'Evidence Counterparty Delta (FIXTURE)', 'ZA',
   'Evidence Commodity 9F', 'buyer', 0, 'USD',
   'normal', 'Evidence fixture — requester safe notification body', 'no_prior_contact',
   false, true, now(),
   'admin_reviewing', 'in_review', :'evidence_case_owner_uid',
   NULL, NULL,
   false, ARRAY[]::text[],
   now() + interval '3 days',
   true, 'b9f00000-0000-0000-0000-000000000000'),

  -- F5 — breached deadline (next_action_due_at in the past, is_overdue=true)
  ('b9f30000-0000-0000-0000-000000000005', 'EVIDENCE-9F-BREACHED',
   'b9f10000-0000-0000-0000-000000000002', :'evidence_requester_uid', 'b9f20000-0000-0000-0000-000000000001',
   'Evidence Counterparty Echo (FIXTURE)', 'ZA',
   'Evidence Commodity 9F', 'buyer', 0, 'USD',
   'high', 'Evidence fixture — breached deadline KPI', 'no_prior_contact',
   false, true, now(),
   'admin_reviewing', 'in_review', :'evidence_case_owner_uid',
   NULL, NULL,
   true, ARRAY['initial_triage_due_at']::text[],
   now() - interval '2 days',
   true, 'b9f00000-0000-0000-0000-000000000000'),

  -- F6 — compliance block, owned by compliance analyst
  ('b9f30000-0000-0000-0000-000000000006', 'EVIDENCE-9F-COMPLIANCE-BLOCK',
   'b9f10000-0000-0000-0000-000000000002', :'evidence_requester_uid', 'b9f20000-0000-0000-0000-000000000001',
   'Evidence Counterparty Foxtrot (FIXTURE)', 'ZA',
   'Evidence Commodity 9F', 'buyer', 0, 'USD',
   'normal', 'Evidence fixture — compliance block behaviour', 'no_prior_contact',
   false, true, now(),
   'blocked_by_compliance', 'in_review', :'evidence_compliance_uid',
   NULL, NULL,
   false, ARRAY[]::text[],
   now() + interval '3 days',
   true, 'b9f00000-0000-0000-0000-000000000000'),

  -- F7 — near breach (next_action_due_at within near-breach window)
  ('b9f30000-0000-0000-0000-000000000007', 'EVIDENCE-9F-NEAR-BREACH',
   'b9f10000-0000-0000-0000-000000000002', :'evidence_requester_uid', 'b9f20000-0000-0000-0000-000000000001',
   'Evidence Counterparty Golf (FIXTURE)', 'ZA',
   'Evidence Commodity 9F', 'buyer', 0, 'USD',
   'normal', 'Evidence fixture — near-breach KPI', 'no_prior_contact',
   false, true, now(),
   'admin_reviewing', 'in_review', :'evidence_case_owner_uid',
   NULL, NULL,
   false, ARRAY[]::text[],
   now() + interval '6 hours',
   true, 'b9f00000-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- 6. FACILITATION CASE EVENTS  (positive response on F3 only)
-- Audit names reconfirmed against scripts/check-facilitation-case-audit-names.mjs
-- (canonical namespace is `facilitation_case.*` with an underscore).
--   * facilitation_case.status_changed              — admin_reviewing → counterparty_responded
--   * facilitation_case.positive_response_recorded  — Batch 9B positive response
--   * facilitation_case.next_step_created           — emitted in §7 row's audit trail
-- =====================================================================
INSERT INTO public.facilitation_case_events (id, case_id, actor_user_id, action, from_status, to_status, payload)
VALUES
  (gen_random_uuid(), 'b9f30000-0000-0000-0000-000000000003', :'evidence_case_owner_uid',
   'facilitation_case.status_changed', 'admin_reviewing', 'counterparty_responded',
   jsonb_build_object('evidence_fixture', true)),
  (gen_random_uuid(), 'b9f30000-0000-0000-0000-000000000003', :'evidence_case_owner_uid',
   'facilitation_case.positive_response_recorded', 'counterparty_responded', 'counterparty_responded',
   jsonb_build_object('evidence_fixture', true, 'sentiment', 'positive'));

-- =====================================================================
-- 7. NEXT STEPS  (positive-response task on F3)
-- Paired event `facilitation_case.next_step_created` is recorded for audit parity.
-- =====================================================================
INSERT INTO public.facilitation_case_next_steps (
    id, case_id, created_by, assigned_to, status, next_step_type, title, description, required_actions
)
VALUES
  (gen_random_uuid(), 'b9f30000-0000-0000-0000-000000000003', :'evidence_case_owner_uid', :'evidence_case_owner_uid',
   'pending', 'positive_response_followup',
   'Evidence 9F — positive response follow-up',
   'Evidence fixture: confirm contact details and arrange next conversation.',
   ARRAY['Confirm contact details', 'Schedule follow-up call']);

INSERT INTO public.facilitation_case_events (id, case_id, actor_user_id, action, from_status, to_status, payload)
VALUES
  (gen_random_uuid(), 'b9f30000-0000-0000-0000-000000000003', :'evidence_case_owner_uid',
   'facilitation_case.next_step_created', 'counterparty_responded', 'counterparty_responded',
   jsonb_build_object('evidence_fixture', true, 'next_step_type', 'positive_response_followup'));



-- =====================================================================
-- 8. REQUESTER-SAFE NOTIFICATION  (F4)
-- Body MUST pass src/tests/facilitation-batch9c-requester-notifications.test.ts
-- (no SLA / breach / overdue / compliance / sanctions / PEP / risk / owner /
-- assignee / escalation / audit / evidence pack / staff names).
-- =====================================================================
INSERT INTO public.notifications (id, user_id, org_id, type, title, body, link, read,
                                  entity_type, entity_id, is_demo, demo_dataset_id)
VALUES
  (gen_random_uuid(), :'evidence_requester_uid', 'b9f10000-0000-0000-0000-000000000002',
   'facilitation.case.update',
   'Update on your facilitation request',
   'We have received an update on your request. Please open the case to see the latest status.',
   '/desk/facilitation/b9f30000-0000-0000-0000-000000000004',
   false, 'facilitation_case', 'b9f30000-0000-0000-0000-000000000004',
   true, 'b9f00000-0000-0000-0000-000000000000');

-- =====================================================================
-- 9. COMPLIANCE HOLD MARKER  (F6)
-- Non-binding marker only; no automatic clearance / sanctions / PEP write.
-- =====================================================================
INSERT INTO public.compliance_holds (id, org_id, hold_type, reason, status, opened_at, opened_by,
                                     metadata, is_demo, demo_dataset_id)
VALUES
  (gen_random_uuid(), 'b9f10000-0000-0000-0000-000000000002',
   'facilitation_evidence_fixture',
   'Evidence 9F fixture — compliance block UI verification only.',
   'open', now(), :'evidence_compliance_uid',
   jsonb_build_object('evidence_fixture', true, 'case_id', 'b9f30000-0000-0000-0000-000000000006'),
   true, 'b9f00000-0000-0000-0000-000000000000');

COMMIT;

-- =====================================================================
-- HARD BOUNDARIES (confirm before apply): this draft does NOT touch
--   pois, poi_engagements, poi_events, wads, wad_attestations, p3_wads,
--   attestations, screening_runs, screening_results, dd_approval_*,
--   facilitation_outreach_sends, email_send_log, email_send_state,
--   notification_dispatches, suppressed_emails,
--   token_balances, token_ledger, token_purchases, token_transactions,
--   token_wallets, fund_flows, refund_requests, payment_disputes,
--   matches, deal_terms, trade_orders, collapse_ledger,
--   acceptance_receipts, acceptance_receipt_acknowledgements.
-- =====================================================================
