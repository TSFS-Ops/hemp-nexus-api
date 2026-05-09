-- Batch C — Phase 3E demo fixtures (FIXTURE-ONLY, NOT A MIGRATION)
--
-- Purpose: Seed six deterministic demo matches each carrying one
-- Match Challenge in a distinct state so non-technical reviewers can
-- self-serve walkthrough the Challenge Workflow.
--
-- Safety:
--   * Idempotent. Deterministic UUIDs. Re-runnable.
--   * Wrapped in a single transaction.
--   * Touches ONLY: public.matches, public.match_challenges, public.audit_logs.
--   * Does NOT touch: edge functions, RLS, RPCs, ratings, notifications,
--     legacy disputes, challenge outcome labels, schema.
--
-- Pre-existing references (must already exist in target DB):
--   ORG_BUYER  = 26acc60f-fdc0-491a-bfa9-bb94404646d4  (Batch A Counterparty Ltd)
--   ORG_SELLER = a8a686c0-0c41-4fb4-8812-db512c002805  (New Organisation)
--   U_BUYER_ADMIN  = 5a49c9f6-ad99-4faf-853b-30e2aaecf2b2  (trade@izenzo.co.za)
--   U_SELLER_ADMIN = 0019e453-0fd8-4dca-9d30-f4352078796f  (uat-billing-…)
--   U_PLATFORM     = 47fffafa-ae53-4e63-b273-e0f4950bd6db  (james@izenzo.co.za)
--
-- Match UUIDs (deterministic):
--   F-C-OPEN              0e3e0001-0001-0001-0001-000000000001
--   F-C-UNDER-REVIEW      0e3e0002-0002-0002-0002-000000000002
--   F-C-OUTCOME-RECORDED  0e3e0003-0003-0003-0003-000000000003
--   F-C-CLOSED-NO-ACTION  0e3e0004-0004-0004-0004-000000000004
--   F-C-WITHDRAWN         0e3e0005-0005-0005-0005-000000000005
--   F-C-ADMIN-OVERRIDE    0e3e0006-0006-0006-0006-000000000006
--
-- Challenge UUIDs are derived as `c0xx…` mirroring the match UUID tail.

\set ON_ERROR_STOP on

BEGIN;

-- Reviewer should adapt the column list below if the local `matches`
-- schema differs. Only the columns required to render the demo are set.
-- Other NOT NULL columns must already have defaults in the target DB.

WITH frame AS (
  SELECT
    '26acc60f-fdc0-491a-bfa9-bb94404646d4'::uuid AS buyer_org,
    'a8a686c0-0c41-4fb4-8812-db512c002805'::uuid AS seller_org
)
INSERT INTO public.matches (id, buyer_org_id, seller_org_id, status, state, created_at)
SELECT m.id, f.buyer_org, f.seller_org, 'matched', 'discovery', now()
FROM frame f, (VALUES
  ('0e3e0001-0001-0001-0001-000000000001'::uuid),
  ('0e3e0002-0002-0002-0002-000000000002'::uuid),
  ('0e3e0003-0003-0003-0003-000000000003'::uuid),
  ('0e3e0004-0004-0004-0004-000000000004'::uuid),
  ('0e3e0005-0005-0005-0005-000000000005'::uuid),
  ('0e3e0006-0006-0006-0006-000000000006'::uuid)
) AS m(id)
ON CONFLICT (id) DO NOTHING;

-- F-C-OPEN: buyer org admin raised, currently open.
INSERT INTO public.match_challenges (
  id, match_id, org_id, raised_by_org_id, raised_by_user_id, raised_by_role,
  subject_code, summary, status, break_glass_override_used, rating_impact_emitted, created_at
) VALUES (
  'c03e0001-0001-0001-0001-000000000001',
  '0e3e0001-0001-0001-0001-000000000001',
  '26acc60f-fdc0-491a-bfa9-bb94404646d4',
  '26acc60f-fdc0-491a-bfa9-bb94404646d4',
  '5a49c9f6-ad99-4faf-853b-30e2aaecf2b2',
  'buyer_org_admin',
  'terms_disagreement',
  'The delivery window shown on the match does not match the agreed term sheet. Requesting clarification before progressing.',
  'open', false, false, now()
) ON CONFLICT (id) DO NOTHING;

-- F-C-UNDER-REVIEW
INSERT INTO public.match_challenges (
  id, match_id, org_id, raised_by_org_id, raised_by_user_id, raised_by_role,
  subject_code, summary, status, under_review_at,
  break_glass_override_used, rating_impact_emitted, created_at
) VALUES (
  'c03e0002-0002-0002-0002-000000000002',
  '0e3e0002-0002-0002-0002-000000000002',
  '26acc60f-fdc0-491a-bfa9-bb94404646d4',
  '26acc60f-fdc0-491a-bfa9-bb94404646d4',
  '5a49c9f6-ad99-4faf-853b-30e2aaecf2b2',
  'buyer_org_admin',
  'evidence_quality_concern',
  'Quality certificate provided is illegible. Awaiting platform admin review.',
  'under_review', now(), false, false, now()
) ON CONFLICT (id) DO NOTHING;

-- F-C-OUTCOME-RECORDED: corrected_and_proceed
INSERT INTO public.match_challenges (
  id, match_id, org_id, raised_by_org_id, raised_by_user_id, raised_by_role,
  subject_code, summary, status, under_review_at,
  outcome_code, outcome_summary, closed_at, closed_by_user_id,
  break_glass_override_used, rating_impact_emitted, created_at
) VALUES (
  'c03e0003-0003-0003-0003-000000000003',
  '0e3e0003-0003-0003-0003-000000000003',
  'a8a686c0-0c41-4fb4-8812-db512c002805',
  'a8a686c0-0c41-4fb4-8812-db512c002805',
  '0019e453-0fd8-4dca-9d30-f4352078796f',
  'seller_org_admin',
  'terms_disagreement',
  'Incoterms text on the match summary differed from the signed term sheet.',
  'outcome_recorded', now() - interval '2 hours',
  'corrected_and_proceed',
  'Term sheet text reconciled with the match summary; both parties confirmed in writing.',
  now(), '47fffafa-ae53-4e63-b273-e0f4950bd6db',
  false, false, now() - interval '3 hours'
) ON CONFLICT (id) DO NOTHING;

-- F-C-CLOSED-NO-ACTION
INSERT INTO public.match_challenges (
  id, match_id, org_id, raised_by_org_id, raised_by_user_id, raised_by_role,
  subject_code, summary, status, under_review_at,
  outcome_code, outcome_summary, closed_at, closed_by_user_id,
  break_glass_override_used, rating_impact_emitted, created_at
) VALUES (
  'c03e0004-0004-0004-0004-000000000004',
  '0e3e0004-0004-0004-0004-000000000004',
  '26acc60f-fdc0-491a-bfa9-bb94404646d4',
  '26acc60f-fdc0-491a-bfa9-bb94404646d4',
  '5a49c9f6-ad99-4faf-853b-30e2aaecf2b2',
  'buyer_org_admin',
  'compliance_concern',
  'Asked platform admin to confirm a compliance flag visible on the counterparty profile.',
  'closed_no_action', now() - interval '1 day',
  'no_action_required',
  'Flag was a stale advisory note. No action required; match may proceed.',
  now() - interval '20 hours', '47fffafa-ae53-4e63-b273-e0f4950bd6db',
  false, false, now() - interval '1 day 2 hours'
) ON CONFLICT (id) DO NOTHING;

-- F-C-WITHDRAWN
INSERT INTO public.match_challenges (
  id, match_id, org_id, raised_by_org_id, raised_by_user_id, raised_by_role,
  subject_code, summary, status,
  outcome_code, outcome_summary, closed_at, closed_by_user_id,
  break_glass_override_used, rating_impact_emitted, created_at
) VALUES (
  'c03e0005-0005-0005-0005-000000000005',
  '0e3e0005-0005-0005-0005-000000000005',
  'a8a686c0-0c41-4fb4-8812-db512c002805',
  'a8a686c0-0c41-4fb4-8812-db512c002805',
  '0019e453-0fd8-4dca-9d30-f4352078796f',
  'seller_org_admin',
  'other',
  'Raised in error — counterparty had already updated the volume figure.',
  'withdrawn',
  'withdrawn_by_raiser',
  'Raiser withdrew after counterparty confirmation.',
  now() - interval '6 hours', '0019e453-0fd8-4dca-9d30-f4352078796f',
  false, false, now() - interval '7 hours'
) ON CONFLICT (id) DO NOTHING;

-- F-C-ADMIN-OVERRIDE
INSERT INTO public.match_challenges (
  id, match_id, org_id, raised_by_org_id, raised_by_user_id, raised_by_role,
  subject_code, summary, status, under_review_at,
  outcome_code, outcome_summary, closed_at, closed_by_user_id,
  break_glass_override_used, rating_impact_emitted, created_at
) VALUES (
  'c03e0006-0006-0006-0006-000000000006',
  '0e3e0006-0006-0006-0006-000000000006',
  '26acc60f-fdc0-491a-bfa9-bb94404646d4',
  '26acc60f-fdc0-491a-bfa9-bb94404646d4',
  '5a49c9f6-ad99-4faf-853b-30e2aaecf2b2',
  'buyer_org_admin',
  'delivery_or_settlement_concern',
  'Counterparty unresponsive for 14 days; requested administrative closure.',
  'outcome_recorded', now() - interval '12 hours',
  'admin_override_recorded',
  'Platform admin closed the challenge under override authority. Audit recorded.',
  now() - interval '1 hour', '47fffafa-ae53-4e63-b273-e0f4950bd6db',
  true, false, now() - interval '14 hours'
) ON CONFLICT (id) DO NOTHING;

-- Mandatory audit row for the override fixture.
-- Uses the existing public.audit_logs table; no schema change.
INSERT INTO public.audit_logs (action, actor_id, target_type, target_id, metadata, created_at)
SELECT
  'challenge.admin_override_recorded',
  '47fffafa-ae53-4e63-b273-e0f4950bd6db',
  'match_challenge',
  'c03e0006-0006-0006-0006-000000000006',
  jsonb_build_object(
    'match_id', '0e3e0006-0006-0006-0006-000000000006',
    'fixture', 'F-C-ADMIN-OVERRIDE',
    'outcome_code', 'admin_override_recorded',
    'break_glass_override_used', true
  ),
  now() - interval '1 hour'
WHERE NOT EXISTS (
  SELECT 1 FROM public.audit_logs
  WHERE action = 'challenge.admin_override_recorded'
    AND target_id = 'c03e0006-0006-0006-0006-000000000006'
);

COMMIT;

-- Verification (read-only):
SELECT id, status, outcome_code, break_glass_override_used
FROM public.match_challenges
WHERE id::text LIKE 'c03e%'
ORDER BY id;
