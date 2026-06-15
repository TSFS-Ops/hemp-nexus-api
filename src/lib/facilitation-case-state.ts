/**
 * Facilitation Case State Machine - Single Source of Truth (browser mirror).
 *
 * Phase 1 only: unknown-counterparty facilitation queue. No outreach, no SLA,
 * no reporting, no email/notification send paths. UI MUST use these constants
 * to render and validate transitions; never inline string comparisons against
 * `internal_status` literals.
 *
 * Mirror of supabase/functions/_shared/facilitation-case-state.ts - both
 * files are pinned by scripts/check-facilitation-status-drift.mjs.
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
  "counterparty_declined",
  "ready_for_known_counterparty_poi",
  "converted_to_known_counterparty_poi",
  "unable_to_proceed",
  "cancelled_by_requester",
  "closed",
] as const;
export type FacilitationInternalStatus = (typeof INTERNAL_STATUSES)[number];

export const USER_FACING_STATUSES = [
  "request_received",
  "reviewing",
  "more_information_needed",
  "under_internal_review",
  "preparing_contact",
  "contact_attempted",
  "waiting_for_response",
  "counterparty_responded",
  "counterparty_declined",
  "ready_to_proceed",
  "poi_started",
  "unable_to_proceed",
  "cancelled",
  "closed",
] as const;
export type FacilitationUserFacingStatus = (typeof USER_FACING_STATUSES)[number];

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
] as const;
export type FacilitationOutcome = (typeof OUTCOMES)[number];

export const TERMINAL_STATUSES: ReadonlySet<FacilitationInternalStatus> = new Set([
  "converted_to_known_counterparty_poi",
  "unable_to_proceed",
  "cancelled_by_requester",
  "closed",
]);

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
  counterparty_responded: ["ready_for_known_counterparty_poi", "more_information_needed", "unable_to_proceed", "closed"],
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
  counterparty_declined: [],
  ready_for_known_counterparty_poi: ["cancelled_by_requester"],
  converted_to_known_counterparty_poi: [],
  unable_to_proceed: [],
  cancelled_by_requester: [],
  closed: [],
};

export function allowedNextStatuses(
  current: FacilitationInternalStatus,
  role: "admin" | "requester",
): readonly FacilitationInternalStatus[] {
  if (role === "admin") return ADMIN_TRANSITIONS[current] ?? [];
  return REQUESTER_TRANSITIONS[current] ?? [];
}

export function isTransitionAllowed(
  from: FacilitationInternalStatus,
  to: FacilitationInternalStatus,
  role: "admin" | "requester",
): boolean {
  return allowedNextStatuses(from, role).includes(to);
}

export function isTerminal(status: FacilitationInternalStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export const USER_FACING_LABELS: Record<FacilitationUserFacingStatus, string> = {
  request_received: "Request received",
  reviewing: "Reviewing",
  more_information_needed: "More information needed",
  under_internal_review: "Under internal review",
  preparing_contact: "Preparing to contact counterparty",
  contact_attempted: "Contact attempted",
  waiting_for_response: "Waiting for counterparty response",
  counterparty_responded: "Counterparty responded",
  counterparty_declined: "Counterparty declined",
  ready_to_proceed: "Ready to proceed",
  poi_started: "Proof of Intent started",
  unable_to_proceed: "Unable to proceed",
  cancelled: "Cancelled",
  closed: "Closed",
};

export const INTERNAL_STATUS_LABELS: Record<FacilitationInternalStatus, string> = {
  new: "New",
  awaiting_assignment: "Awaiting assignment",
  admin_reviewing: "Admin reviewing",
  more_information_needed: "More information needed",
  compliance_review_required: "Compliance review required",
  blocked_by_compliance: "Blocked by compliance",
  duplicate_review: "Duplicate review",
  ready_for_contact: "Ready for contact",
  contact_attempted: "Contact attempted",
  awaiting_counterparty_response: "Awaiting counterparty response",
  counterparty_responded: "Counterparty responded",
  counterparty_declined: "Counterparty declined",
  ready_for_known_counterparty_poi: "Ready for known-counterparty POI",
  converted_to_known_counterparty_poi: "Converted to known-counterparty POI",
  unable_to_proceed: "Unable to proceed",
  cancelled_by_requester: "Cancelled by requester",
  closed: "Closed",
};

// ─── Canonical audit names (mirror of Deno SSOT) ─────────────────────────
export const FACILITATION_AUDIT_NAMES = [
  "facilitation_case.created",
  "facilitation_case.assigned",
  "facilitation_case.status_changed",
  "facilitation_case.note_added",
  "facilitation_case.evidence_uploaded",
  "facilitation_case.closed",
  "facilitation_case.cancelled_by_requester",
] as const;
export type FacilitationAuditName = (typeof FACILITATION_AUDIT_NAMES)[number];
