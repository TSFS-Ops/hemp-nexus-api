/**
 * P-5 Batch 1 — Stage 4 RPC wrappers.
 *
 * Thin typed wrappers around the Stage 3 `p5_*` Security Definer RPCs.
 * Admin dialogs and panels must call these wrappers rather than mutating
 * `p5_governance_*` tables directly, so that audit + transition + role
 * checks remain server-enforced.
 */
import { supabase } from "@/integrations/supabase/client";
import type { P5ProviderStatus, P5ReasonCode, P5Status } from "./constants";

type Uuid = string;

async function call<T = unknown>(
  fn: Parameters<typeof supabase.rpc>[0],
  args: Record<string, unknown>,
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const p5Rpc = {
  applyHold: (a: {
    case_id: Uuid;
    hold_type: string;
    reason_code: P5ReasonCode;
    note: string;
    owner_user_id?: Uuid;
    review_date?: string;
    correlation_id?: string;
  }) =>
    call("p5_apply_hold", {
      _case_id: a.case_id,
      _hold_type: a.hold_type,
      _reason_code: a.reason_code,
      _note: a.note,
      _owner_user_id: a.owner_user_id,
      _review_date: a.review_date,
      _correlation_id: a.correlation_id,
    }),

  releaseHold: (a: { case_id: Uuid; reason_code: P5ReasonCode; note: string; correlation_id?: string }) =>
    call("p5_release_hold", {
      _case_id: a.case_id,
      _reason_code: a.reason_code,
      _note: a.note,
      _correlation_id: a.correlation_id,
    }),

  waive: (a: {
    case_id: Uuid;
    scope: string;
    reason_code: P5ReasonCode;
    note: string;
    risk_acceptance_note?: string;
    expires_at?: string;
    correlation_id?: string;
  }) =>
    call("p5_waive", {
      _case_id: a.case_id,
      _scope: a.scope,
      _reason_code: a.reason_code,
      _note: a.note,
      _risk_acceptance_note: a.risk_acceptance_note,
      _expires_at: a.expires_at,
      _correlation_id: a.correlation_id,
    }),

  override: (a: {
    case_id: Uuid;
    scope: string;
    reason_code: P5ReasonCode;
    note: string;
    risk_acceptance_note?: string;
    expires_at?: string;
    correlation_id?: string;
  }) =>
    call("p5_override", {
      _case_id: a.case_id,
      _scope: a.scope,
      _reason_code: a.reason_code,
      _note: a.note,
      _risk_acceptance_note: a.risk_acceptance_note,
      _expires_at: a.expires_at,
      _correlation_id: a.correlation_id,
    }),

  escalate: (a: {
    case_id: Uuid;
    reason_code: P5ReasonCode;
    note: string;
    owner_user_id?: Uuid;
    due_at?: string;
    correlation_id?: string;
  }) =>
    call("p5_escalate", {
      _case_id: a.case_id,
      _reason_code: a.reason_code,
      _note: a.note,
      _owner_user_id: a.owner_user_id,
      _due_at: a.due_at,
      _correlation_id: a.correlation_id,
    }),

  requestMoreInfo: (a: {
    case_id: Uuid;
    reason_code: P5ReasonCode;
    note: string;
    owner_user_id?: Uuid;
    due_at?: string;
    correlation_id?: string;
  }) =>
    call("p5_request_more_info", {
      _case_id: a.case_id,
      _reason_code: a.reason_code,
      _note: a.note,
      _owner_user_id: a.owner_user_id,
      _due_at: a.due_at,
      _correlation_id: a.correlation_id,
    }),

  reject: (a: { case_id: Uuid; reason_code: P5ReasonCode; note: string; evidence_item_id?: Uuid; correlation_id?: string }) =>
    call("p5_reject", {
      _case_id: a.case_id,
      _reason_code: a.reason_code,
      _note: a.note,
      _evidence_item_id: a.evidence_item_id,
      _correlation_id: a.correlation_id,
    }),

  approveReadyToProceed: (a: { case_id: Uuid; note: string; correlation_id?: string }) =>
    call("p5_approve_ready_to_proceed", {
      _case_id: a.case_id,
      _note: a.note,
      _correlation_id: a.correlation_id,
    }),

  approveInternally: (a: { case_id: Uuid; correlation_id?: string }) =>
    call<P5Status>("p5_approve_internally", {
      _case_id: a.case_id,
      _correlation_id: a.correlation_id,
    }),

  reviewEvidence: (a: {
    evidence_item_id: Uuid;
    decision: "approve" | "reject" | "request_correction";
    reason_code?: P5ReasonCode;
    note?: string;
    customer_safe_note?: string;
    correlation_id?: string;
  }) =>
    call("p5_review_evidence", {
      _evidence_item_id: a.evidence_item_id,
      _decision: a.decision,
      _reason_code: a.reason_code,
      _note: a.note,
      _customer_safe_note: a.customer_safe_note,
      _correlation_id: a.correlation_id,
    }),

  recordProviderResult: (a: {
    case_id: Uuid;
    provider_reference: string;
    provider_status: P5ProviderStatus;
    provider_checked_at?: string;
    is_high_risk_domain?: boolean;
    correlation_id?: string;
  }) =>
    call("p5_record_provider_result", {
      _case_id: a.case_id,
      _provider_reference: a.provider_reference,
      _provider_status: a.provider_status,
      _provider_checked_at: a.provider_checked_at,
      _is_high_risk_domain: a.is_high_risk_domain,
      _correlation_id: a.correlation_id,
    }),

  assignOwner: (a: { case_id: Uuid; new_owner_user_id: Uuid; correlation_id?: string }) =>
    call("p5_assign_owner", {
      _case_id: a.case_id,
      _new_owner_user_id: a.new_owner_user_id,
      _correlation_id: a.correlation_id,
    }),

  startReview: (a: { case_id: Uuid; reviewer_id: Uuid; correlation_id?: string }) =>
    call("p5_start_review", {
      _case_id: a.case_id,
      _reviewer_id: a.reviewer_id,
      _correlation_id: a.correlation_id,
    }),

  reopen: (a: { case_id: Uuid; reason_code: P5ReasonCode; note: string; correlation_id?: string }) =>
    call("p5_reopen", {
      _case_id: a.case_id,
      _reason_code: a.reason_code,
      _note: a.note,
      _correlation_id: a.correlation_id,
    }),

  archiveSuperseded: (a: { case_id: Uuid; reason_code: P5ReasonCode; note: string; correlation_id?: string }) =>
    call("p5_archive_superseded", {
      _case_id: a.case_id,
      _reason_code: a.reason_code,
      _note: a.note,
      _correlation_id: a.correlation_id,
    }),
};

export type P5RpcClient = typeof p5Rpc;
