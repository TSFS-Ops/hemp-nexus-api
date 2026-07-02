/**
 * Batch V — Controlled-action gate helper (browser-safe copy).
 *
 * A single predicate consumed by every controlled-action call site
 * (WaD sealing, finality, funder-ready, API ready=true, POI binding).
 *
 *   isIdvBlocking(status) === true  → BLOCK the controlled action.
 *
 * The list of blocking statuses is exhaustive and covers every non-
 * completed state that Batch V produces via the VerifyNow adapter, the
 * route table, and the manual-review fallback.
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

export function isIdvBlocking(status: string | null | undefined): boolean {
  if (!status) return true; // absent status → treat as pending / blocking
  return IDV_BLOCKING_STATUSES.includes(status as InternalIdvStatus);
}

export function isIdvCompleted(status: string | null | undefined): boolean {
  return !!status && IDV_COMPLETED_STATUSES.includes(status as InternalIdvStatus);
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
 * List of controlled-action call sites. Kept as a typed union so tests
 * can enumerate them and prove every site is checked.
 */
export type ControlledAction =
  | "wad_seal"
  | "finality_action"
  | "funder_ready_grant"
  | "api_ready_true"
  | "poi_bind_party";

export const CONTROLLED_ACTIONS: readonly ControlledAction[] = Object.freeze([
  "wad_seal",
  "finality_action",
  "funder_ready_grant",
  "api_ready_true",
  "poi_bind_party",
]);
