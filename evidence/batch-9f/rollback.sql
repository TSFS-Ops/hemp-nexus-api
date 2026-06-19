-- =====================================================================
-- BATCH 9F — Evidence Fixture Rollback (DRAFT — NOT APPLIED)
-- Scope is strict:
--   * the fixed demo_dataset_id 'b9f00000-0000-0000-0000-000000000000', AND/OR
--   * the seven case_number values prefixed 'EVIDENCE-9F-', AND/OR
--   * the five evidence user UUIDs the project owner supplied, AND/OR
--   * metadata->>'evidence_fixture' = 'true' on tables that have a metadata jsonb.
-- Nothing outside that scope is touched.
-- =====================================================================

BEGIN;

-- 9. Compliance hold marker
DELETE FROM public.compliance_holds
 WHERE demo_dataset_id = 'b9f00000-0000-0000-0000-000000000000'
   AND metadata->>'evidence_fixture' = 'true';

-- 8. Requester-safe notification
DELETE FROM public.notifications
 WHERE demo_dataset_id = 'b9f00000-0000-0000-0000-000000000000'
   AND entity_type = 'facilitation_case'
   AND entity_id::text LIKE 'b9f30000-0000-0000-0000-%';

-- 7. Next steps
DELETE FROM public.facilitation_case_next_steps
 WHERE case_id IN (
   SELECT id FROM public.facilitation_cases WHERE case_number LIKE 'EVIDENCE-9F-%'
 );

-- 6. Case events
DELETE FROM public.facilitation_case_events
 WHERE case_id IN (
   SELECT id FROM public.facilitation_cases WHERE case_number LIKE 'EVIDENCE-9F-%'
 );

-- 5. Facilitation cases
DELETE FROM public.facilitation_cases
 WHERE case_number LIKE 'EVIDENCE-9F-%'
   AND demo_dataset_id = 'b9f00000-0000-0000-0000-000000000000';

-- 4. Trade request anchor
DELETE FROM public.trade_requests
 WHERE demo_dataset_id = 'b9f00000-0000-0000-0000-000000000000'
   AND metadata->>'evidence_fixture' = 'true';

-- 3. User roles  (only the roles this fixture granted)
DELETE FROM public.user_roles
 WHERE (user_id, role) IN (
   (:'evidence_platform_admin_uid', 'platform_admin'),
   (:'evidence_compliance_uid',     'compliance_analyst'),
   (:'evidence_case_owner_uid',     'trade_operations')
 );

-- 2. Profiles
DELETE FROM public.profiles
 WHERE demo_dataset_id = 'b9f00000-0000-0000-0000-000000000000';

-- 1. Organisations
DELETE FROM public.organizations
 WHERE demo_dataset_id = 'b9f00000-0000-0000-0000-000000000000'
   AND name LIKE 'Evidence %';

COMMIT;

-- NOTE: After rollback, the five evidence auth.users rows should be
-- DISABLED (not deleted) in Cloud → Users to preserve audit traceability.
