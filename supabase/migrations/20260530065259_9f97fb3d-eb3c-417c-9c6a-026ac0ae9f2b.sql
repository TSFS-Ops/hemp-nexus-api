-- Admin Export Controls Batch 4 — Governance Record Export Approval Shell.
-- Additive only. No destructive changes.
--
-- 1) Allow status='approved' for admin_export rows (currently the CHECK
--    constraint only permits awaiting_approval / export_preparation_required /
--    ready_for_download / downloaded / expired / destroyed / blocked_or_declined).
-- 2) Add the SECURITY DEFINER RPC public.approve_admin_governance_export.
--    Locked to service_role. Caller (edge function) enforces platform_admin + AAL2.
-- 3) Self-approval is already blocked at the DB level by
--    trg_export_requests_self_approval; we additionally check it inside the
--    RPC to surface a clean error code (SELF_APPROVAL_BLOCKED) before the
--    trigger fires.

ALTER TABLE public.export_requests
  DROP CONSTRAINT IF EXISTS export_requests_status_domain;

ALTER TABLE public.export_requests
  ADD CONSTRAINT export_requests_status_domain CHECK (
    (kind = 'user_export' AND status IN (
      'verification_required',
      'export_preparation_required',
      'ready_for_delivery',
      'delivered',
      'expired',
      'destroyed',
      'blocked_verification_failed',
      'limited_retention_or_confidentiality_required'
    ))
    OR
    (kind = 'admin_export' AND status IN (
      'awaiting_approval',
      'approved',
      'export_preparation_required',
      'ready_for_download',
      'downloaded',
      'expired',
      'destroyed',
      'blocked_or_declined'
    ))
  );

CREATE OR REPLACE FUNCTION public.approve_admin_governance_export(
  p_approver_user_id uuid,
  p_request_id       uuid,
  p_approval_note    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row    public.export_requests%ROWTYPE;
  v_now    timestamptz := now();
  v_new_approval jsonb;
BEGIN
  IF p_approver_user_id IS NULL THEN
    RAISE EXCEPTION 'APPROVER_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  -- Lock the row so a concurrent approve/decline cannot race.
  SELECT * INTO v_row
    FROM public.export_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_row.kind <> 'admin_export' THEN
    RAISE EXCEPTION 'NOT_ADMIN_EXPORT' USING ERRCODE = 'check_violation';
  END IF;
  IF v_row.governance_record_id IS NULL THEN
    RAISE EXCEPTION 'NOT_GOVERNANCE_RECORD_REQUEST' USING ERRCODE = 'check_violation';
  END IF;
  IF v_row.status <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'REQUEST_NOT_PENDING: %', v_row.status USING ERRCODE = 'check_violation';
  END IF;
  IF v_row.requester_user_id = p_approver_user_id THEN
    -- Surface a clean code before the BEFORE trigger raises its own.
    RAISE EXCEPTION 'SELF_APPROVAL_BLOCKED' USING ERRCODE = 'check_violation';
  END IF;

  v_new_approval := coalesce(v_row.approval, '{}'::jsonb)
    || jsonb_build_object(
         'approver_user_id', p_approver_user_id,
         'approved_at',      v_now,
         'approval_note',    coalesce(p_approval_note, ''),
         'previous_status',  v_row.status,
         'new_status',       'approved'
       );

  UPDATE public.export_requests
     SET status   = 'approved',
         approval = v_new_approval
   WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'request_id',           v_row.id,
    'governance_record_id', v_row.governance_record_id,
    'previous_status',      v_row.status,
    'new_status',           'approved',
    'approver_user_id',     p_approver_user_id,
    'requested_by',         v_row.requester_user_id,
    'redaction_mode',       v_row.redaction_mode,
    'approved_at',          v_now
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_admin_governance_export(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_admin_governance_export(uuid, uuid, text)
  TO service_role;