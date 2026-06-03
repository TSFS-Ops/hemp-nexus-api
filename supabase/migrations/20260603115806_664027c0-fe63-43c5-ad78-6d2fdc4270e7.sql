-- DATA-004 Batch 13 Phase 2 cleanup: remove fixture rows.
-- Preserves retention_run_evidence (audit) and storage objects.
DELETE FROM public.retention_flags
WHERE id IN (
  'b13a2222-2222-4222-8222-222222222222'::uuid,
  'b13b3333-3333-4333-8333-333333333333'::uuid,
  'b13d4444-4444-4444-8444-444444444444'::uuid
);
DELETE FROM public.compliance_cases
WHERE id = 'b13a1111-1111-4111-8111-111111111111'::uuid;