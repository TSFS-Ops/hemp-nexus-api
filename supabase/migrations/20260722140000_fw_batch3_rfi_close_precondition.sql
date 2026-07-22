-- =====================================================================
-- Institutional Funder Evidence Workspace -- Batch 3 verification pass
-- (RFI lifecycle). Corrective, additive fix only.
--
-- Gap found: the approved V1 walkthrough spec
-- (docs/funder-workspace/authenticated-browser-walkthrough-DRAFT.md,
-- "Close RFI" row) documents the precondition "RFI must be answered"
-- before an RFI may be marked Closed. The original Batch 5 migration
-- (20260712091031) only rejected closing an RFI that was already
-- terminal (closed/withdrawn); it did not require an answer to have
-- been recorded, so an RFI could be closed straight from
-- open/assigned/in_progress with no answer ever given. Withdraw is
-- unaffected and intentionally remains available at any non-terminal
-- status (cancelling a request that is no longer needed does not
-- require an answer).
--
-- Fix: CREATE OR REPLACE the existing SECURITY DEFINER RPC to add the
-- missing status check. Strictly additive/corrective -- no table,
-- column, enum, grant or other RPC signature is touched. Verified
-- against the existing Batch 5/10 test suite (funder-workspace-batch5-
-- workflow.test.ts): only static RPC-name allow-list tests reference
-- this function by name; none assert the previous, looser behaviour,
-- so this is a safe correctness fix rather than a breaking change.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fw_funder_close_rfi_v1(p_rfi_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_org uuid; v_release uuid; v_status text; v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;

  SELECT funder_organisation_id, release_id, status INTO v_org, v_release, v_status
  FROM public.funder_workspace_rfis WHERE id = p_rfi_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'rfi_not_found'; END IF;

  v_role := public.fw_v1_role_for_release(v_release);
  IF v_role IS NULL THEN RAISE EXCEPTION 'not_a_funder_user_for_release'; END IF;
  IF v_role NOT IN ('admin','approver','reviewer') THEN RAISE EXCEPTION 'insufficient_role'; END IF;
  IF v_status IN ('closed','withdrawn') THEN RAISE EXCEPTION 'rfi_terminal'; END IF;
  IF v_status <> 'answered' THEN RAISE EXCEPTION 'rfi_not_answered'; END IF;

  UPDATE public.funder_workspace_rfis
  SET status = 'closed', closed_by = v_uid, closed_at = now()
  WHERE id = p_rfi_id;

  PERFORM public.fw_audit('fw_rfi_closed', v_org, 'funder_workspace_rfi', p_rfi_id,
        jsonb_build_object('status', v_status), jsonb_build_object('status', 'closed'), p_reason);
  PERFORM public.fw_record_usage(v_org, NULL, v_release, NULL, 'rfi_closed',
        jsonb_build_object('rfi_id', p_rfi_id));
END; $$;

REVOKE ALL ON FUNCTION public.fw_funder_close_rfi_v1(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fw_funder_close_rfi_v1(uuid, text) TO authenticated;
