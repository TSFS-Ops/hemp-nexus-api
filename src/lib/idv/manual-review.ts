/**
 * Batch V — Manual review fallback (record shape + decision enum).
 *
 * Persistence: server-side, into `public.p5scr_manual_reviews` with
 * category = 'idv_person'. That table constrains its `decision` column
 * to ('cleared','cleared_with_conditions','failed','rejected'), so we
 * map our seven admin decisions onto that column and preserve the full
 * decision + reason in the `notes_admin_only` JSON/text field.
 *
 * See supabase/functions/idv-manual-review/index.ts for the edge
 * function that wires this record shape into the table.
 */

export type IdvManualReviewReason =
  | "unsupported_country"
  | "unsupported_document_type"
  | "api_not_live_yet"
  | "dashboard_only_check"
  | "mismatch"
  | "record_not_found_after_retry"
  | "source_unavailable_beyond_retry_threshold"
  | "blocked_id"
  | "deceased_status"
  | "suspected_fraud"
  | "serious_inconsistency"
  | "admin_required_review";

export type IdvManualReviewDecision =
  | "manual_review_accepted"
  | "manual_review_rejected"
  | "more_information_required"
  | "alternative_document_required"
  | "provider_retry_required"
  | "blocked_pending_admin_decision"
  | "waived_with_reason";

/**
 * Map our extended decision set to the `p5scr_manual_reviews.decision`
 * check constraint (`cleared|cleared_with_conditions|failed|rejected`).
 * The full decision + reason are preserved separately in the notes JSON.
 */
export function mapToP5ScrDecisionColumn(
  d: IdvManualReviewDecision,
): "cleared" | "cleared_with_conditions" | "failed" | "rejected" {
  switch (d) {
    case "manual_review_accepted":
      return "cleared";
    case "waived_with_reason":
      return "cleared_with_conditions";
    case "more_information_required":
    case "alternative_document_required":
    case "provider_retry_required":
    case "blocked_pending_admin_decision":
      return "failed";
    case "manual_review_rejected":
      return "rejected";
  }
}

/** External wording — no forbidden trust signals. */
export const IDV_MANUAL_REVIEW_USER_WORDING: Record<IdvManualReviewDecision, string> = {
  manual_review_accepted: "Identity review completed",
  manual_review_rejected: "Identity review completed",
  more_information_required: "Additional information required",
  alternative_document_required: "Alternative document required",
  provider_retry_required: "Identity verification pending",
  blocked_pending_admin_decision: "Manual review required",
  waived_with_reason: "Identity review completed",
};

export interface IdvManualReviewRecord {
  subject_id: string;
  person_ref: string | null;
  organisation_ref: string | null;
  case_ref: string | null;
  transaction_ref: string | null;
  document_country: string;
  document_type: string;
  provider_attempted: "verifynow" | null;
  provider_status: string | null;
  reason: IdvManualReviewReason;
  supporting_evidence_refs: string[];
  reviewer_id: string | null;
  decision: IdvManualReviewDecision | null;
  decision_reason: string | null;
  decided_at: string | null;
}
