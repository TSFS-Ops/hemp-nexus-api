/**
 * Facilitation Case State Machine — Deno SSOT.
 * Mirror of src/lib/facilitation-case-state.ts. Both are pinned by
 * scripts/check-facilitation-status-drift.mjs.
 *
 * Batch 3: aligned with client questionnaire (intake, statuses, outcomes,
 * user-facing labels). Still no outreach, no SLA, no reporting.
 */

export const INTERNAL_STATUSES = [
  "new",
  "awaiting_assignment",
  "admin_reviewing",
  "more_information_needed",
  "compliance_review_required",
  "blocked_by_compliance",
  "duplicate_review",
  "ready_for_contact",
  "contact_attempted",
  "awaiting_counterparty_response",
  "counterparty_responded",
  "profile_verification_in_progress",
  "counterparty_declined",
  "ready_for_known_counterparty_poi",
  "converted_to_known_counterparty_poi",
  "unable_to_proceed",
  "cancelled_by_requester",
  "closed",
] as const;
export type FacilitationInternalStatus = (typeof INTERNAL_STATUSES)[number];

export const OUTCOMES = [
  "converted_to_known_counterparty_poi",
  "linked_to_existing_organisation",
  "new_counterparty_profile_created",
  "more_information_not_provided",
  "counterparty_declined",
  "unable_to_contact",
  "blocked_by_compliance",
  "duplicate_case",
  "cancelled_by_requester",
  "outside_supported_scope",
  "closed_by_admin_decision",
  "no_authority_confirmed",
] as const;
export type FacilitationOutcome = (typeof OUTCOMES)[number];

export const ROLES = ["buyer", "seller", "service_provider", "funder", "other"] as const;
export type FacilitationRole = (typeof ROLES)[number];

export const RELATIONSHIP_STATUSES = [
  "no_prior_contact",
  "prior_contact",
  "referral",
  "known_but_not_verified",
] as const;
export type FacilitationRelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

const ADMIN_TRANSITIONS: Record<FacilitationInternalStatus, readonly FacilitationInternalStatus[]> = {
  new: ["awaiting_assignment", "admin_reviewing", "duplicate_review", "compliance_review_required", "cancelled_by_requester", "closed"],
  awaiting_assignment: ["admin_reviewing", "duplicate_review", "compliance_review_required", "closed"],
  admin_reviewing: ["more_information_needed", "compliance_review_required", "duplicate_review", "ready_for_contact", "unable_to_proceed", "closed"],
  more_information_needed: ["admin_reviewing", "unable_to_proceed", "closed"],
  compliance_review_required: ["blocked_by_compliance", "admin_reviewing", "ready_for_contact", "closed"],
  blocked_by_compliance: ["unable_to_proceed", "closed"],
  duplicate_review: ["admin_reviewing", "unable_to_proceed", "closed"],
  ready_for_contact: ["contact_attempted", "unable_to_proceed", "closed"],
  contact_attempted: ["awaiting_counterparty_response", "unable_to_proceed", "closed"],
  awaiting_counterparty_response: ["counterparty_responded", "counterparty_declined", "unable_to_proceed", "closed"],
  counterparty_responded: ["profile_verification_in_progress", "ready_for_known_counterparty_poi", "more_information_needed", "unable_to_proceed", "closed"],
  profile_verification_in_progress: ["ready_for_known_counterparty_poi", "more_information_needed", "compliance_review_required", "unable_to_proceed", "closed"],
  counterparty_declined: ["unable_to_proceed", "closed"],
  ready_for_known_counterparty_poi: ["converted_to_known_counterparty_poi", "closed"],
  converted_to_known_counterparty_poi: [],
  unable_to_proceed: ["closed"],
  cancelled_by_requester: [],
  closed: [],
};

const REQUESTER_TRANSITIONS: Record<FacilitationInternalStatus, readonly FacilitationInternalStatus[]> = {
  new: ["cancelled_by_requester"],
  awaiting_assignment: ["cancelled_by_requester"],
  admin_reviewing: ["cancelled_by_requester"],
  more_information_needed: ["cancelled_by_requester"],
  compliance_review_required: ["cancelled_by_requester"],
  blocked_by_compliance: [],
  duplicate_review: ["cancelled_by_requester"],
  ready_for_contact: ["cancelled_by_requester"],
  contact_attempted: ["cancelled_by_requester"],
  awaiting_counterparty_response: ["cancelled_by_requester"],
  counterparty_responded: ["cancelled_by_requester"],
  profile_verification_in_progress: ["cancelled_by_requester"],
  counterparty_declined: [],
  ready_for_known_counterparty_poi: ["cancelled_by_requester"],
  converted_to_known_counterparty_poi: [],
  unable_to_proceed: [],
  cancelled_by_requester: [],
  closed: [],
};

export function isTransitionAllowed(
  from: FacilitationInternalStatus,
  to: FacilitationInternalStatus,
  role: "admin" | "requester",
): boolean {
  const map = role === "admin" ? ADMIN_TRANSITIONS : REQUESTER_TRANSITIONS;
  return (map[from] ?? []).includes(to);
}

// ─── Canonical audit names ───────────────────────────────────────────────
export const FACILITATION_AUDIT_NAMES = [
  "facilitation_case.created",
  "facilitation_case.assigned",
  "facilitation_case.status_changed",
  "facilitation_case.intake_updated",
  "facilitation_case.note_added",
  "facilitation_case.evidence_uploaded",
  "facilitation_case.source_added",
  "facilitation_case.milestone_changed",
  "facilitation_case.outcome_set",
  "facilitation_case.closed",
  "facilitation_case.cancelled_by_requester",
] as const;
export type FacilitationAuditName = (typeof FACILITATION_AUDIT_NAMES)[number];
