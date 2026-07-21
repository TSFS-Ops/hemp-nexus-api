-- Hide internal-only columns of registry_company_records from anonymous and authenticated readers.
-- Row-level RLS still allows reading public records, but Postgres column-level privileges
-- prevent selecting internal operational fields. Service role (used by admin edge functions)
-- retains full access via its table-level GRANT ALL.
REVOKE SELECT (
  internal_confidence_notes,
  disabled_at,
  disabled_by,
  archived_at,
  archived_by,
  claim_suspended_at,
  claim_suspended_by
) ON public.registry_company_records FROM anon;

REVOKE SELECT (
  internal_confidence_notes,
  disabled_at,
  disabled_by,
  archived_at,
  archived_by,
  claim_suspended_at,
  claim_suspended_by
) ON public.registry_company_records FROM authenticated;