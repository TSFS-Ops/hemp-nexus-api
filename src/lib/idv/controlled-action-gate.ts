/**
 * Batch V / V-Wire — Controlled-action gate helper (browser-safe copy).
 *
 * A single predicate consumed by every controlled-action call site:
 *   - WaD seal          (Batch V)
 *   - Finality action           (V-Wire)
 *   - Funder-ready grant        (V-Wire)
 *   - API ready=true            (V-Wire)
 *   - Binding POI action        (V-Wire; POI drafting stays light)
 *   - Controlled evidence approval  (V-Wire)
 *   - Controlled transaction approval (V-Wire)
 *
 *   isIdvBlocking(status) === true  → BLOCK the controlled action.
 *
 * `manual_review_accepted` is a RELEASE signal (may unlock gates where
 * policy allows) but is NEVER rendered as "verified". Live-provider
 * completion is the only source of `idv_completed`.
 *
 * The server mirror at supabase/functions/_shared/idv-gate.ts is kept in
 * sync by src/tests/batch-v-controlled-action-gate.test.ts.
 */

import type { InternalIdvStatus } from "./result-mapping";

export const IDV_BLOCKING_STATUSES = Object.freeze<InternalIdvStatus[]>([
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

export const IDV_COMPLETED_STATUSES = Object.freeze<InternalIdvStatus[]>([
  "idv_completed",
]);

/**
 * Release signal from the manual-review fallback. Not part of
 * InternalIdvStatus (which is provider-derived); persisted separately
 * in `p5scr_manual_reviews.decision`. See src/lib/idv/manual-review.ts.
 */
export type IdvReleaseSignal = "manual_review_accepted";

export function isIdvBlocking(status: string | null | undefined): boolean {
  if (!status) return true; // absent status → treat as pending / blocking
  if (status === "manual_review_accepted") return false;
  return IDV_BLOCKING_STATUSES.includes(status as InternalIdvStatus);
}

export function isIdvCompleted(status: string | null | undefined): boolean {
  return !!status && IDV_COMPLETED_STATUSES.includes(status as InternalIdvStatus);
}

/**
 * True when the effective IDV state releases controlled-action gates —
 * either a live-provider completion OR a recorded manual-review
 * acceptance. This is the predicate every gate should call.
 *
 * NOTE: `manual_review_accepted` is a release-only signal. It does NOT
 * promote the person to "verified" wording anywhere — see Batch O /
 * O-Remainder trust-signal guards.
 */
export function idvReleasesControlledAction(
  status: string | null | undefined,
): boolean {
  if (isIdvCompleted(status)) return true;
  if (status === "manual_review_accepted") return true;
  return false;
}

/** Human-readable, user-safe reason for a block. Provider-neutral. */
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
    case "failed":
    case "unsupported":
    case "error":
    default:
      return "Identity verification required";
  }
}

/**
 * Controlled-action call sites. Kept as a typed union so tests can
 * enumerate them and prove every site is gated.
 */
export type ControlledAction =
  | "wad_seal"
  | "finality_action"
  | "funder_ready_grant"
  | "api_ready_true"
  | "poi_bind_party"
  | "evidence_approval"
  | "transaction_approval";

export const CONTROLLED_ACTIONS: readonly ControlledAction[] = Object.freeze([
  "wad_seal",
  "finality_action",
  "funder_ready_grant",
  "api_ready_true",
  "poi_bind_party",
  "evidence_approval",
  "transaction_approval",
]);

/** Safe blocker codes surfaced to UI / funder / API. Provider-neutral. */
export type IdvBlockerCode =
  | "IDV_REQUIRED"
  | "IDV_PROVIDER_PENDING"
  | "IDV_MANUAL_REVIEW_REQUIRED"
  | "IDV_PROVIDER_NOT_AVAILABLE"
  | "IDV_RETRY_REQUIRED"
  | "IDV_BLOCKED_PENDING_ADMIN_DECISION";

export function idvBlockerCode(
  status: string | null | undefined,
): IdvBlockerCode {
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

/**
 * Per-controlled-action safe blocker code. Where a site needs a scoped
 * variant (e.g. "IDV_REQUIRED_WAD_SEAL"), callers may suffix; this
 * helper returns the un-suffixed generic code.
 */
export function idvActionBlockerCode(
  action: ControlledAction,
  status: string | null | undefined,
): string {
  const base = idvBlockerCode(status);
  if (base !== "IDV_REQUIRED") return base;
  switch (action) {
    case "wad_seal":            return "IDV_REQUIRED_WAD_SEAL";
    case "finality_action":     return "IDV_REQUIRED_FINALITY";
    case "funder_ready_grant":  return "IDV_REQUIRED_FUNDER_READY";
    case "api_ready_true":      return "IDV_REQUIRED";
    case "poi_bind_party":      return "IDV_REQUIRED_POI_BIND";
    case "evidence_approval":   return "IDV_REQUIRED_EVIDENCE_APPROVAL";
    case "transaction_approval":return "IDV_REQUIRED_TRANSACTION_APPROVAL";
  }
}

/**
 * API-safe projection. Never exposes raw provider payloads, ID numbers,
 * biometrics or manual-review notes. Callers embed this in their
 * `ready`/`blocker_*` response object.
 */
export interface ApiIdvProjection {
  idv_status: "idv_completed" | "manual_review_accepted" | "blocking";
  idv_required_action: boolean;
  idv_provider_state: "pending" | "not_available" | "error" | "n/a";
  ready: boolean;
  blocker_code: string | null;
  blocker_label: string | null;
}

export function buildApiIdvProjection(
  status: string | null | undefined,
): ApiIdvProjection {
  if (idvReleasesControlledAction(status)) {
    return {
      idv_status: status === "manual_review_accepted"
        ? "manual_review_accepted"
        : "idv_completed",
      idv_required_action: false,
      idv_provider_state: "n/a",
      ready: true,
      blocker_code: null,
      blocker_label: null,
    };
  }
  const s = (status ?? "pending") as InternalIdvStatus;
  const providerState: ApiIdvProjection["idv_provider_state"] =
    s === "provider_pending" || s === "pending"
      ? "pending"
      : s === "provider_not_available"
      ? "not_available"
      : s === "provider_error" || s === "error"
      ? "error"
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
