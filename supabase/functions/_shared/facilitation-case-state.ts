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
  // Batch 9A — master-spec closure-vocabulary aliases.
  "no_response",
  "invalid_details",
  "closed_by_admin",
] as const;
export type FacilitationOutcome = (typeof OUTCOMES)[number];

// Batch 9A — sensitive outcomes that require an evidenced closing_reason.
// Enforced server-side in facilitation-case-admin-action (status_change).
export const SENSITIVE_OUTCOMES_REQUIRING_REASON: ReadonlySet<FacilitationOutcome> = new Set<FacilitationOutcome>([
  "blocked_by_compliance",
  "invalid_details",
  "duplicate_case",
  "unable_to_contact",
  "no_response",
  "more_information_not_provided",
]);
export const CLOSURE_REASON_MIN_LENGTH = 10;

// Batch 9D — outcomes/statuses that count as a successful conversion for the
// management conversion-rate KPI. Master-spec asks for converted_to_known
// _counterparty_poi, converted_to_known_counterparty, ready_for_next_step and
// ready_for_poi_review; we map those to the existing accepted vocabulary.
export const SUCCESSFUL_FINAL_OUTCOMES: ReadonlySet<FacilitationOutcome> = new Set<FacilitationOutcome>([
  "converted_to_known_counterparty_poi",
  "linked_to_existing_organisation",
  "new_counterparty_profile_created",
]);
export const SUCCESSFUL_INTERNAL_STATUSES: ReadonlySet<FacilitationInternalStatus> = new Set<FacilitationInternalStatus>([
  "converted_to_known_counterparty_poi",
  "ready_for_known_counterparty_poi",
]);

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
  "facilitation_case.more_information_requested",
  "facilitation_case.more_information_submitted",
  "facilitation_case.registry_check_recorded",
  "facilitation_case.sanctions_pep_recorded",
  "facilitation_case.contact_attempt_recorded",
  "facilitation_case.organisation_linked",
  "facilitation_case.profile_created_recorded",
  "facilitation_case.ready_for_poi_marked",
  "facilitation_case.poi_conversion_recorded",
  // Batch 7 — SLA tracking & reminders.
  "facilitation_case.sla_evaluated",
  "facilitation_case.overdue_marked",
  "facilitation_case.overdue_cleared",
  "facilitation_case.reminder_sent",
  // Batch 9B — positive-response next-step tasks.
  "facilitation_case.positive_response_recorded",
  "facilitation_case.next_step_created",
  "facilitation_case.next_step_assigned",
  "facilitation_case.next_step_status_changed",
  "facilitation_case.next_step_completed",
  // Batch 9C — requester-facing in-app notifications.
  "facilitation_case.requester_notification_emitted",
  // Batch 10 — tamper-evident SHA-256 sealing of exported evidence packs.
  "facilitation_case.evidence_pack_sealed",
  // Batch 11 — invite-unopened auto-detector (internal-only flag).
  "facilitation_case.invite_unopened_flagged",
] as const;

// ─── Batch 16 — Controlled POI conversion audit names ───────────────────
// Distinct namespace (`facilitation.poi_conversion.*`) to clearly separate
// the human-confirmed conversion workflow from generic case events.
// Pinned by scripts/check-facilitation-poi-conversion-audit-names.mjs.
export const FACILITATION_POI_CONVERSION_AUDIT_NAMES = [
  "facilitation.poi_conversion.eligibility_checked",
  "facilitation.poi_conversion.blocked",
  "facilitation.poi_conversion.confirmed",
  "facilitation.poi_conversion.created",
  "facilitation.poi_conversion.linked_existing",
] as const;
export type FacilitationPoiConversionAuditName =
  (typeof FACILITATION_POI_CONVERSION_AUDIT_NAMES)[number];

// ─── Batch 17 — Controlled organisation merge audit names ───────────────
// Distinct namespace (`facilitation.organisation_merge.*`).
// Pinned by scripts/check-facilitation-organisation-merge-audit-names.mjs.
export const FACILITATION_ORGANISATION_MERGE_AUDIT_NAMES = [
  "facilitation.organisation_merge.eligibility_checked",
  "facilitation.organisation_merge.blocked",
  "facilitation.organisation_merge.confirmed",
  "facilitation.organisation_merge.completed",
] as const;
export type FacilitationOrganisationMergeAuditName =
  (typeof FACILITATION_ORGANISATION_MERGE_AUDIT_NAMES)[number];

// Batch 11 — internal-only next-step kind emitted by the
// invite-unopened auto-detector. Pure constant — pinned by
// scripts/check-invite-unopened-detector-contract.mjs.
export const INVITE_UNOPENED_NEXT_STEP_KIND = "invite_unopened_3bd" as const;

export type FacilitationAuditName = (typeof FACILITATION_AUDIT_NAMES)[number];

// ─── Batch 9B — positive-response next-step tasks ────────────────────────
export const NEXT_STEP_TYPES = ["positive_response_followup"] as const;
export type FacilitationNextStepType = (typeof NEXT_STEP_TYPES)[number];

export const NEXT_STEP_STATUSES = ["open","in_progress","completed","cancelled"] as const;
export type FacilitationNextStepStatus = (typeof NEXT_STEP_STATUSES)[number];

/** Default required-actions checklist created when a positive counterparty
 *  response is recorded. Each action is internal-only and never auto-executes
 *  POI, WaD, verification, compliance clearance or external outreach.
 */
export const POSITIVE_RESPONSE_REQUIRED_ACTIONS: readonly string[] = [
  "Verify basic counterparty details against the recorded response",
  "Create or update the counterparty organisation record if appropriate",
  "Invite the counterparty to Izenzo where appropriate",
  "Link the counterparty to the relevant trade request or match",
  "Notify the requester using approved safe wording",
  "Prepare the next POI-related step (subject to the existing POI verification gate)",
];

/** Positive-response signals that should create a next-step task.
 *  Negative results (no answer, wrong contact, declined, etc.) must NOT
 *  create a task.
 */
export const POSITIVE_CONTACT_RESULTS = ["reached_counterparty"] as const;
export type FacilitationPositiveContactResult = (typeof POSITIVE_CONTACT_RESULTS)[number];

// ─── Batch 9C — Requester-facing in-app notifications ────────────────────
/**
 * Map of internal status -> requester-safe notification trigger. Only the
 * four approved milestones are listed. Every other transition is internal-
 * only and must NEVER emit a requester notification.
 *
 * Content rules (enforced by `assertRequesterSafeNotification` below):
 *   - title & body MUST contain only neutral, plain-English wording
 *   - MUST NOT mention SLA / breach / overdue / compliance / sanctions /
 *     PEP / risk / internal / owner / assignee / escalation / audit /
 *     evidence pack / outreach wording / staff names
 *   - MUST NOT imply verification, approval, POI readiness or compliance
 *     clearance beyond the literal milestone
 */
export interface RequesterSafeNotification {
  readonly key: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
}

export const REQUESTER_SAFE_NOTIFICATION_TRIGGERS: Record<string, RequesterSafeNotification> = {
  counterparty_responded: {
    key: "counterparty_responded",
    type: "facilitation_case.requester.counterparty_responded",
    title: "Counterparty response received",
    body: "There has been a response on your unknown-counterparty request. Izenzo is reviewing the next step.",
  },
  ready_for_known_counterparty_poi: {
    key: "ready_for_next_step",
    type: "facilitation_case.requester.ready_for_next_step",
    title: "Request ready for next step",
    body: "Your unknown-counterparty request is ready for the next step. Please review the latest status.",
  },
  unable_to_proceed: {
    key: "unable_to_proceed",
    type: "facilitation_case.requester.unable_to_proceed",
    title: "Unable to proceed",
    body: "Izenzo is unable to proceed with this unknown-counterparty request at this stage. Please review the status for next steps.",
  },
  closed: {
    key: "closed",
    type: "facilitation_case.requester.closed",
    title: "Request closed",
    body: "Your unknown-counterparty request has been closed. Please review the final status.",
  },
};

export const REQUESTER_NOTIFICATION_FORBIDDEN_SUBSTRINGS: readonly string[] = [
  "sla", "breach", "overdue", "deadline",
  "compliance", "sanction", "pep", "risk score",
  "owner", "assignee", "assigned to", "escalat",
  "audit", "internal note", "evidence pack",
  "platform admin", "compliance analyst",
];

export function getRequesterSafeNotification(internalStatus: string): RequesterSafeNotification | null {
  return REQUESTER_SAFE_NOTIFICATION_TRIGGERS[internalStatus] ?? null;
}

export function assertRequesterSafeNotification(n: RequesterSafeNotification): void {
  const haystack = `${n.title}\n${n.body}`.toLowerCase();
  for (const term of REQUESTER_NOTIFICATION_FORBIDDEN_SUBSTRINGS) {
    if (haystack.includes(term)) {
      throw new Error(`Requester-safe notification "${n.key}" contains forbidden term "${term}"`);
    }
  }
}


