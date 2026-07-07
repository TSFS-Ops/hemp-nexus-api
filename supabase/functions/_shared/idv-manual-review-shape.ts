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


/**
 * Batch V-UI-Fix-4 -- maps an admin manual-review decision onto the
 * gate-readable IDV status written to p5scr_idv_records.state (via the
 * p5scr_record_idv RPC). This is intentionally a DIFFERENT mapping
 * from mapToP5ScrDecisionColumn above, which only targets the
 * constrained p5scr_manual_reviews.decision column.
 *
 * manual_review_accepted is the ONLY decision that releases a
 * controlled-action gate (see idvReleasesControlledAction in
 * idv-gate.ts). Every other decision maps to a still-blocking
 * InternalIdvStatus so no decision can silently widen the release
 * conditions beyond what Batch V already defines.
 */
export function mapDecisionToGateState(
  d: IdvManualReviewDecision,
  ): "manual_review_accepted" | "failed" | "alternative_document_required" | "retry_required" | "blocked_pending_admin_decision" {
  switch (d) {
    case "manual_review_accepted":
      return "manual_review_accepted";
    case "manual_review_rejected":
      return "failed";
    case "more_information_required":
    case "alternative_document_required":
      return "alternative_document_required";
    case "provider_retry_required":
      return "retry_required";
    case "blocked_pending_admin_decision":
      return "blocked_pending_admin_decision";
    case "waived_with_reason":
      // Batch V-UI-Fix-4: deliberately conservative. A "waiver" is an
  // admin policy call that this batch does NOT auto-release, to
  // avoid widening gate-release conditions without explicit product
  // sign-off. Still routed to blocked_pending_admin_decision so a
  // further admin action is required. See the Fix-4 evidence file.
  return "blocked_pending_admin_decision";
  }
}
