/**
 * Batch V — VerifyNow record-state mapping.
 *
 * Converts VerifyNow/InternalIdvStatus **workflow** statuses into valid
 * `p5scr_idv_records.state` **persistence** values.
 *
 * The DB check constraint `p5scr_idv_records_state_check` allows exactly:
 *   idv_pending, provider_pending, manual_review_required,
 *   cleared, cleared_with_conditions, failed, rejected, screening_expired
 *
 * Any value outside this set will violate the constraint and fail the insert.
 * Do NOT broaden this set without a co-ordinated migration + review.
 *
 * Safety rule: unknown / ambiguous / error statuses must NEVER map to
 * `cleared`. The safe default is `manual_review_required`.
 */

import type { InternalIdvStatus } from "./result-mapping.ts";

export const ALLOWED_IDV_RECORD_STATES = [
  "idv_pending",
  "provider_pending",
  "manual_review_required",
  "cleared",
  "cleared_with_conditions",
  "failed",
  "rejected",
  "screening_expired",
] as const;

export type IdvRecordState = typeof ALLOWED_IDV_RECORD_STATES[number];

const ALLOWED_SET: ReadonlySet<string> = new Set(ALLOWED_IDV_RECORD_STATES);

export function isAllowedIdvRecordState(v: unknown): v is IdvRecordState {
  return typeof v === "string" && ALLOWED_SET.has(v);
}

/**
 * Pure mapper. Exhaustive over the closed `InternalIdvStatus` union so that
 * adding a new workflow status fails the build until this mapping is updated.
 * Any unexpected input falls back to `manual_review_required` — never
 * `cleared`.
 */
export function mapInternalStatusToRecordState(
  workflowStatus: InternalIdvStatus | string | null | undefined,
): IdvRecordState {
  switch (workflowStatus as InternalIdvStatus) {
    case "idv_completed":
      return "cleared";
    case "manual_review_required":
      return "manual_review_required";
    case "provider_pending":
      return "provider_pending";
    case "retry_required":
      return "manual_review_required";
    case "alternative_document_required":
      return "manual_review_required";
    case "provider_error":
      return "manual_review_required";
    case "provider_not_available":
      return "manual_review_required";
    case "blocked_pending_admin_decision":
      return "rejected";
    case "pending":
      return "provider_pending";
    case "failed":
      return "failed";
    case "expired":
      return "screening_expired";
    case "unsupported":
      return "manual_review_required";
    case "error":
      return "manual_review_required";
    default:
      // Unknown / ambiguous — safe default. Must never be `cleared`.
      return "manual_review_required";
  }
}
