-- Admin Export Controls Batch 2: link export_requests to Governance Records + redaction mode.
-- Additive only. No data migration. No destructive changes.

ALTER TABLE public.export_requests
  ADD COLUMN IF NOT EXISTS governance_record_id uuid NULL,
  ADD COLUMN IF NOT EXISTS redaction_mode text NULL;

-- Restrict redaction_mode domain. Allow NULL so existing rows remain valid.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'export_requests_redaction_mode_domain'
  ) THEN
    ALTER TABLE public.export_requests
      ADD CONSTRAINT export_requests_redaction_mode_domain
      CHECK (
        redaction_mode IS NULL
        OR redaction_mode IN (
          'redacted_client_safe',
          'evidence_only',
          'metadata_only',
          'full_internal'
        )
      );
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS export_requests_governance_record_idx
  ON public.export_requests (governance_record_id)
  WHERE governance_record_id IS NOT NULL;

-- New SECURITY DEFINER RPC: request_admin_governance_export.
-- Wraps the existing admin_export contract and additionally persists
-- governance_record_id + redaction_mode. Defaults redaction_mode to the
-- safest mode ('redacted_client_safe') when caller omits it.
CREATE OR REPLACE FUNCTION public.request_admin_governance_export(
  p_requester_user_id   uuid,
  p_governance_record_id uuid,
  p_purpose             text,
  p_reason              text,
  p_requested_categories text[],
  p_target_org_id       uuid    DEFAULT NULL,
  p_redaction_mode      text    DEFAULT 'redacted_client_safe',
  p_date_range          jsonb   DEFAULT NULL,
  p_legal_hold_context  jsonb   DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id uuid;
  v_mode text;
BEGIN
  IF p_governance_record_id IS NULL THEN
    RAISE EXCEPTION 'GOVERNANCE_RECORD_ID_REQUIRED'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_purpose IS NULL OR length(coalesce(p_reason, '')) < 10 THEN
    RAISE EXCEPTION 'admin_export requires purpose and reason (>=10 chars)'
      USING ERRCODE = 'check_violation';
  END IF;
  v_mode := coalesce(p_redaction_mode, 'redacted_client_safe');
  IF v_mode NOT IN (
    'redacted_client_safe', 'evidence_only', 'metadata_only', 'full_internal'
  ) THEN
    RAISE EXCEPTION 'INVALID_REDACTION_MODE: %', v_mode
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.export_requests (
    kind, requester_user_id, subject_user_id, target_org_id, status,
    requested_categories, purpose, reason, date_range,
    governance_record_id, redaction_mode, verification
  ) VALUES (
    'admin_export', p_requester_user_id, NULL, p_target_org_id,
    'awaiting_approval',
    coalesce(p_requested_categories, '{}'),
    p_purpose, p_reason, p_date_range,
    p_governance_record_id, v_mode,
    coalesce(
      jsonb_build_object('legal_hold_context', p_legal_hold_context),
      '{}'::jsonb
    )
  ) RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_admin_governance_export(
  uuid, uuid, text, text, text[], uuid, text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_admin_governance_export(
  uuid, uuid, text, text, text[], uuid, text, jsonb, jsonb
) TO service_role;