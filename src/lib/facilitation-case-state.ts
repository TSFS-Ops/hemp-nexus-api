/**
 * Facilitation Case State Machine - Single Source of Truth (browser mirror).
 *
 * Batch 3: aligned with client questionnaire (intake, statuses, outcomes,
 * user-facing labels). No SLA, no notifications, no outreach/POI
 * conversion logic introduced here.
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
  "profile_verification_in_progress",
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

/**
 * User-facing milestone wording approved by client questionnaire.
 * The requester only ever sees these labels - never internal status,
 * compliance reasoning, duplicate detail, or do-not-contact data.
 */
export const USER_FACING_LABELS: Record<FacilitationUserFacingStatus, string> = {
  request_received: "Izenzo has received your request and is reviewing it.",
  reviewing: "Izenzo has received your request and is reviewing it.",
  more_information_needed: "More information is required before Izenzo can continue.",
  under_internal_review: "Your request is undergoing verification checks.",
  preparing_contact: "Izenzo is attempting to verify and contact the counterparty.",
  contact_attempted: "Izenzo is attempting to verify and contact the counterparty.",
  waiting_for_response: "Izenzo is attempting to verify and contact the counterparty.",
  counterparty_responded: "The counterparty response and profile information are being assessed.",
  counterparty_declined: "Izenzo was unable to proceed with this counterparty.",
  ready_to_proceed: "The counterparty is ready for POI.",
  poi_started: "This opportunity has been converted into a known-counterparty POI.",
  unable_to_proceed: "Izenzo was unable to proceed with this request.",
  cancelled: "This request was cancelled.",
  closed: "This request has been closed.",
};

/**
 * Mapping from the internal admin status to the requester-visible milestone.
 * Use this in every requester-facing surface to avoid leaking internal state.
 */
export const INTERNAL_TO_USER_FACING: Record<FacilitationInternalStatus, FacilitationUserFacingStatus> = {
  new: "request_received",
  awaiting_assignment: "request_received",
  admin_reviewing: "reviewing",
  more_information_needed: "more_information_needed",
  compliance_review_required: "under_internal_review",
  blocked_by_compliance: "unable_to_proceed",
  duplicate_review: "under_internal_review",
  ready_for_contact: "preparing_contact",
  contact_attempted: "contact_attempted",
  awaiting_counterparty_response: "waiting_for_response",
  counterparty_responded: "counterparty_responded",
  profile_verification_in_progress: "under_internal_review",
  counterparty_declined: "counterparty_declined",
  ready_for_known_counterparty_poi: "ready_to_proceed",
  converted_to_known_counterparty_poi: "poi_started",
  unable_to_proceed: "unable_to_proceed",
  cancelled_by_requester: "cancelled",
  closed: "closed",
};

export const INTERNAL_STATUS_LABELS: Record<FacilitationInternalStatus, string> = {
  new: "New - Unassigned",
  awaiting_assignment: "New - Unassigned",
  admin_reviewing: "Triage in progress",
  more_information_needed: "More information needed",
  compliance_review_required: "Compliance review required",
  blocked_by_compliance: "Blocked by compliance",
  duplicate_review: "Duplicate review",
  ready_for_contact: "Outreach approved",
  contact_attempted: "Contact attempted",
  awaiting_counterparty_response: "Awaiting counterparty response",
  counterparty_responded: "Counterparty responded",
  profile_verification_in_progress: "Profile verification in progress",
  counterparty_declined: "Counterparty declined",
  ready_for_known_counterparty_poi: "Ready for POI",
  converted_to_known_counterparty_poi: "Converted to known-counterparty POI",
  unable_to_proceed: "Closed - Unable to proceed",
  cancelled_by_requester: "Closed - Cancelled by requester",
  closed: "Closed",
};

export const ROLE_LABELS: Record<FacilitationRole, string> = {
  buyer: "Buyer",
  seller: "Seller",
  service_provider: "Service provider",
  funder: "Funder",
  other: "Other",
};

export const RELATIONSHIP_STATUS_LABELS: Record<FacilitationRelationshipStatus, string> = {
  no_prior_contact: "No prior contact",
  prior_contact: "Prior contact",
  referral: "Referral",
  known_but_not_verified: "Known but not verified",
};

// ─── Canonical audit names (mirror of Deno SSOT) ─────────────────────────
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
