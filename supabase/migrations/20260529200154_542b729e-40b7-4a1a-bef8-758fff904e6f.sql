-- DATA-004 Batch 9B — fixture cleanup
DELETE FROM public.retention_flags
WHERE flag_type = 'data-004-batch9b-fixture'
  AND id IN (
    'b9b0f1a0-0000-4000-8000-000000000001',
    'b9b0f1a0-0000-4000-8000-000000000003',
    'b9b0f1a0-0000-4000-8000-000000000004'
  );

DELETE FROM public.screening_results
WHERE id IN (
  'b9b00001-0000-4000-8000-000000000001',
  'b9b00001-0000-4000-8000-000000000003'
)
  AND provider = 'fixture'
  AND is_demo = true;