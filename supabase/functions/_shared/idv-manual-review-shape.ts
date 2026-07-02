/**
 * Batch V — server mirror of the manual-review decision shape.
 * See src/lib/idv/manual-review.ts. Kept in sync by a drift test.
 */

export type IdvManualReviewDecision =
  | "manual_review_accepted"
  | "manual_review_rejected"
  | "more_information_required"
  | "alternative_document_required"
  | "provider_retry_required"
  | "blocked_pending_admin_decision"
  | "waived_with_reason";

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
