/**
 * P-5 Batch 3 — Stage 2 funder outcome / funder-status transitions (pure TS).
 *
 * Funder outcome → funder status. Funder approval is NEVER final by itself;
 * funding decisions always require admin review downstream.
 */
import type { P5B3FunderStatus, P5B3OutcomeType } from "./constants";

export const OUTCOME_TO_STATUS: Record<P5B3OutcomeType, P5B3FunderStatus> = {
  interested: "interested",
  not_interested: "declined",
  credit_review_pending: "credit_review_pending",
  conditional_support: "conditional_support",
  term_sheet_requested: "term_sheet_requested",
  term_sheet_provided: "term_sheet_provided",
  funding_approved_subject_to_admin: "funding_decision_submitted",
  declined: "declined",
};

export function mapOutcomeToStatus(o: P5B3OutcomeType): P5B3FunderStatus {
  return OUTCOME_TO_STATUS[o];
}

/** Funder approval alone is never final — admin review required downstream. */
export function isTerminalForFunder(status: P5B3FunderStatus): boolean {
  return status === "exited" || status === "declined";
}

export function requiresAdminReview(o: P5B3OutcomeType): boolean {
  return (
    o === "funding_approved_subject_to_admin" ||
    o === "term_sheet_provided" ||
    o === "conditional_support"
  );
}
