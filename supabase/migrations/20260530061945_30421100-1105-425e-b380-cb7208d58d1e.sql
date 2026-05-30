INSERT INTO public.compliance_cases (id, org_id, entity_id, status, decision_notes)
VALUES (
  'b13a1111-1111-4111-8111-111111111111'::uuid,
  '8fc9ee52-ce88-456f-8ef9-c6984fc6fae1'::uuid,
  '235d10ae-98c0-4c0b-895f-d3f40c95d253'::uuid,
  'APPROVED',
  'data-004-batch13-cold-storage-positive-live:fixture-A'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.retention_flags (
  id, table_name, record_id, record_created_at, retention_expires_at,
  flag_type, retention_status, org_id, archive_storage_path
) VALUES (
  'b13a2222-2222-4222-8222-222222222222'::uuid,
  'compliance_cases',
  'b13a1111-1111-4111-8111-111111111111'::uuid,
  now() - interval '8 years',
  now() - interval '1 year',
  'expired',
  'archived',
  '8fc9ee52-ce88-456f-8ef9-c6984fc6fae1'::uuid,
  NULL
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.retention_flags (
  id, table_name, record_id, record_created_at, retention_expires_at,
  flag_type, retention_status, org_id,
  archive_storage_path, archive_hash, archive_size_bytes, archived_at
) VALUES (
  'b13b3333-3333-4333-8333-333333333333'::uuid,
  'compliance_cases',
  'b13b9999-9999-4999-8999-999999999999'::uuid,
  now() - interval '8 years',
  now() - interval '1 year',
  'expired',
  'archived',
  '8fc9ee52-ce88-456f-8ef9-c6984fc6fae1'::uuid,
  'compliance_cases/2018/8fc9ee52-ce88-456f-8ef9-c6984fc6fae1/b13b9999-9999-4999-8999-999999999999.json',
  'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  256,
  now() - interval '30 days'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.retention_flags (
  id, table_name, record_id, record_created_at, retention_expires_at,
  flag_type, retention_status, org_id, archive_storage_path
) VALUES (
  'b13d4444-4444-4444-8444-444444444444'::uuid,
  'compliance_cases',
  'b13d8888-8888-4888-8888-888888888888'::uuid,
  now() - interval '8 years',
  now() - interval '1 year',
  'expired',
  'archived',
  '8fc9ee52-ce88-456f-8ef9-c6984fc6fae1'::uuid,
  NULL
)
ON CONFLICT (id) DO NOTHING;