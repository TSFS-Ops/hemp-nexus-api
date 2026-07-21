-- RECOVERED from Cloud version 20260721014006 (drift-audit reconciliation).
-- Idempotent: REVOKE on already-revoked privilege is a no-op.

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
