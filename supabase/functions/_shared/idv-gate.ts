/**
 * Batch V / V-Wire — Controlled-action IDV gate (server mirror).
 *
 * Kept in sync with src/lib/idv/controlled-action-gate.ts by
 * src/tests/batch-v-controlled-action-gate.test.ts.
 *
 * Consumed at every controlled-action call site:
 *   wad_seal, finality_action, funder_ready_grant, api_ready_true,
 *   poi_bind_party, evidence_approval, transaction_approval.
 *
 * `manual_review_accepted` is a RELEASE signal. It may unlock gates
 * where policy allows but is NEVER rendered as "verified".
 */

// deno-lint-ignore no-explicit-any
type AdminClient = any;

import type { InternalIdvStatus } from "./verifynow/result-mapping.ts";

export const IDV_BLOCKING_STATUSES: readonly InternalIdvStatus[] = Object.freeze([
  "pending",
  "provider_pending",
  "provider_not_available",
  "retry_required",
  "alternative_document_required",
  "manual_review_required",
  "blocked_pending_admin_decision",
  "provider_error",
  "failed",
  "expired",
  "unsupported",
  "error",
]);

export const IDV_COMPLETED_STATUSES: readonly InternalIdvStatus[] = Object.freeze([
  "idv_completed",
]);

export function isIdvBlocking(status: string | null | undefined): boolean {
  if (!status) return true;
  if (status === "manual_review_accepted") return false;
  return IDV_BLOCKING_STATUSES.includes(status as InternalIdvStatus);
}

export function isIdvCompleted(status: string | null | undefined): boolean {
  return !!status && IDV_COMPLETED_STATUSES.includes(status as InternalIdvStatus);
}

export function idvReleasesControlledAction(
  status: string | null | undefined,
): boolean {
  if (isIdvCompleted(status)) return true;
  if (status === "manual_review_accepted") return true;
  return false;
}

export type ControlledAction =
  | "wad_seal"
  | "finality_action"
  | "funder_ready_grant"
  | "api_ready_true"
  | "poi_bind_party"
  | "evidence_approval"
  | "transaction_approval";

export type IdvBlockerCode =
  | "IDV_REQUIRED"
  | "IDV_PROVIDER_PENDING"
  | "IDV_MANUAL_REVIEW_REQUIRED"
  | "IDV_PROVIDER_NOT_AVAILABLE"
  | "IDV_RETRY_REQUIRED"
  | "IDV_BLOCKED_PENDING_ADMIN_DECISION";

export function idvBlockerCode(status: string | null | undefined): IdvBlockerCode {
  const s = (status ?? "pending") as InternalIdvStatus;
  switch (s) {
    case "provider_pending":
    case "pending":
      return "IDV_PROVIDER_PENDING";
    case "manual_review_required":
    case "provider_error":
      return "IDV_MANUAL_REVIEW_REQUIRED";
    case "provider_not_available":
      return "IDV_PROVIDER_NOT_AVAILABLE";
    case "retry_required":
    case "alternative_document_required":
      return "IDV_RETRY_REQUIRED";
    case "blocked_pending_admin_decision":
      return "IDV_BLOCKED_PENDING_ADMIN_DECISION";
    default:
      return "IDV_REQUIRED";
  }
}

export function idvBlockUserWording(status: string | null | undefined): string {
  const s = (status ?? "pending") as InternalIdvStatus;
  switch (s) {
    case "manual_review_required":
    case "provider_not_available":
    case "provider_error":
    case "blocked_pending_admin_decision":
      return "Manual review required";
    case "retry_required":
    case "alternative_document_required":
      return "Alternative document required";
    case "provider_pending":
    case "pending":
      return "Identity verification pending";
    case "expired":
      return "Identity verification required";
    default:
      return "Identity verification required";
  }
}

export interface ApiIdvProjection {
  idv_status: "idv_completed" | "manual_review_accepted" | "blocking";
  idv_required_action: boolean;
  idv_provider_state: "pending" | "not_available" | "error" | "n/a";
  ready: boolean;
  blocker_code: string | null;
  blocker_label: string | null;
}

export function buildApiIdvProjection(status: string | null | undefined): ApiIdvProjection {
  if (idvReleasesControlledAction(status)) {
    return {
      idv_status: status === "manual_review_accepted" ? "manual_review_accepted" : "idv_completed",
      idv_required_action: false,
      idv_provider_state: "n/a",
      ready: true,
      blocker_code: null,
      blocker_label: null,
    };
  }
  const s = (status ?? "pending") as InternalIdvStatus;
  const providerState: ApiIdvProjection["idv_provider_state"] =
    s === "provider_pending" || s === "pending" ? "pending"
    : s === "provider_not_available" ? "not_available"
    : s === "provider_error" || s === "error" ? "error"
    : "n/a";
  return {
    idv_status: "blocking",
    idv_required_action: true,
    idv_provider_state: providerState,
    ready: false,
    blocker_code: idvBlockerCode(status),
    blocker_label: idvBlockUserWording(status),
  };
}

export class IdvGateError extends Error {
  constructor(
    public readonly code:
      | "IDV_REQUIRED"
      | "IDV_PENDING"
      | "IDV_MANUAL_REVIEW"
      | "IDV_BLOCKED",
    message: string,
    public readonly status: string | null,
    public readonly action: ControlledAction,
  ) {
    super(message);
    this.name = "IdvGateError";
  }
}

function classify(status: string | null | undefined): IdvGateError["code"] {
  const s = (status ?? "pending") as InternalIdvStatus;
  if (s === "manual_review_required" || s === "provider_error") return "IDV_MANUAL_REVIEW";
  if (s === "blocked_pending_admin_decision") return "IDV_BLOCKED";
  if (s === "provider_pending" || s === "pending") return "IDV_PENDING";
  return "IDV_REQUIRED";
}

export async function assertIdvGate(
  admin: AdminClient,
  subjectId: string | null | undefined,
  action: ControlledAction,
): Promise<void> {
  if (!subjectId) return;
  const { data, error } = await admin
    .from("p5scr_idv_records")
    .select("state")
    .eq("subject_id", subjectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new IdvGateError("IDV_REQUIRED", "Identity verification lookup failed", null, action);
  }
  const state: string | null = data?.state ?? null;
  if (idvReleasesControlledAction(state)) return;
  if (!state || isIdvBlocking(state)) {
    throw new IdvGateError(classify(state), "Identity verification required", state, action);
  }
}

/**
 * V-Wire — the single controlled-action assertion. All six new gate
 * sites (finality, funder-ready, API ready, POI-bind, evidence-approval,
 * transaction-approval) should call this. `wad_seal` continues to use
 * the older wad-seal-specific wrapper for backwards compatibility.
 */
export async function assertControlledActionIdvGate(
  admin: AdminClient,
  subjectId: string | null | undefined,
  action: ControlledAction,
): Promise<void> {
  return assertIdvGate(admin, subjectId, action);
}
