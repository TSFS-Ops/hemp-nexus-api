/**
 * P012 — Unknown-Counterparty User-Facing Timeline (SSOT, Deno mirror).
 *
 * Pinned to src/lib/unknown-cp-timeline.ts by
 * scripts/check-unknown-cp-audit-names.mjs and copy-drift guards.
 */

export const UNKNOWN_CP_STATUS_ORDER = [
  "poi_created",
  "facilitation_case_opened",
  "details_under_review",
  "more_information_required",
  "additional_information_received",
  "outreach_prepared",
  "outreach_started",
  "awaiting_counterparty_response",
  "counterparty_invited",
  "counterparty_onboarding_in_progress",
  "converted_to_known_counterparty",
  "counterparty_declined",
  "no_response",
  "unreachable",
  "invalid_counterparty_details",
  "cancelled_by_requester",
  "closed_by_izenzo",
] as const;
export type UnknownCpStatus = (typeof UNKNOWN_CP_STATUS_ORDER)[number];

export const UNKNOWN_CP_INTERNAL_ONLY_STATUSES: ReadonlySet<UnknownCpStatus> =
  new Set(["outreach_prepared"]);

export const UNKNOWN_CP_STATUS_GROUP: Record<UnknownCpStatus, "open" | "awaiting" | "outcome" | "closed"> = {
  poi_created: "open",
  facilitation_case_opened: "open",
  details_under_review: "open",
  more_information_required: "open",
  additional_information_received: "open",
  outreach_prepared: "open",
  outreach_started: "awaiting",
  awaiting_counterparty_response: "awaiting",
  counterparty_invited: "awaiting",
  counterparty_onboarding_in_progress: "awaiting",
  converted_to_known_counterparty: "outcome",
  counterparty_declined: "outcome",
  no_response: "outcome",
  unreachable: "outcome",
  invalid_counterparty_details: "outcome",
  cancelled_by_requester: "closed",
  closed_by_izenzo: "closed",
};

export const UNKNOWN_CP_STATUS_LABEL: Record<UnknownCpStatus, string> = {
  poi_created: "POI created",
  facilitation_case_opened: "Facilitation case opened",
  details_under_review: "Details under review",
  more_information_required: "More information required",
  additional_information_received: "Additional information received",
  outreach_prepared: "Outreach prepared",
  outreach_started: "Outreach started",
  awaiting_counterparty_response: "Awaiting counterparty response",
  counterparty_invited: "Counterparty invited",
  counterparty_onboarding_in_progress: "Counterparty onboarding in progress",
  converted_to_known_counterparty: "Converted to known counterparty",
  counterparty_declined: "Counterparty declined",
  no_response: "No response",
  unreachable: "Unreachable",
  invalid_counterparty_details: "Invalid counterparty details",
  cancelled_by_requester: "Cancelled by requester",
  closed_by_izenzo: "Closed by Izenzo",
};

export const UNKNOWN_CP_STATUS_COPY: Record<UnknownCpStatus, string> = {
  poi_created:
    "Your Proof of Intention has been created with an unknown counterparty. The counterparty is not yet known or engaged on the platform.",
  facilitation_case_opened:
    "Izenzo has opened a facilitation case linked to this POI. The case will be handled through the support workflow.",
  details_under_review:
    "Izenzo is reviewing the counterparty details you provided before any outreach is represented as started.",
  more_information_required:
    "We need more information before facilitation can continue. Please add the requested details or supporting documents.",
  additional_information_received:
    "Your additional information has been received and added to the facilitation case. Izenzo will review it before the next step.",
  outreach_prepared: "",
  outreach_started:
    "Izenzo has started counterparty outreach. We will show progress when there is a recorded outcome or required next step.",
  awaiting_counterparty_response:
    "Izenzo is waiting for a response from the counterparty. No acceptance or commitment should be assumed at this stage.",
  counterparty_invited:
    "A controlled invitation has been sent to the counterparty. The counterparty must still respond and complete any required onboarding.",
  counterparty_onboarding_in_progress:
    "The counterparty has started engagement or onboarding. Workflow gates still apply before this matter can progress further.",
  converted_to_known_counterparty:
    "The counterparty is now linked to this engagement as a known counterparty. You may continue only where the required POI/WaD gates are satisfied.",
  counterparty_declined:
    "The counterparty has declined to engage. This case cannot progress with that counterparty unless Izenzo reopens it after a new approved reason.",
  no_response:
    "No response was received within the outreach window. You may provide better details, cancel the request or ask support to review next steps.",
  unreachable:
    "Izenzo could not reach the counterparty using the available details. Please provide updated contact or identifying information if available.",
  invalid_counterparty_details:
    "The provided counterparty details are not sufficient or appear incorrect. Please correct the details before facilitation can continue.",
  cancelled_by_requester:
    "You cancelled this unknown-counterparty facilitation case. No further outreach will be recorded under this case.",
  closed_by_izenzo:
    "Izenzo has closed this facilitation case with a recorded reason. Contact support if you believe new information should be reviewed.",
};

export const UNKNOWN_CP_AUDIT_EVENT_NAMES = [
  "unknown_cp_case_created",
  "unknown_cp_status_changed",
  "unknown_cp_owner_assigned",
  "unknown_cp_more_info_requested",
  "unknown_cp_user_message_added",
  "unknown_cp_outreach_attempt_logged",
  "unknown_cp_invite_sent",
  "unknown_cp_counterparty_linked",
  "unknown_cp_outcome_recorded",
  "unknown_cp_case_closed",
  "unknown_cp_case_reopened",
] as const;
export type UnknownCpAuditEventName = (typeof UNKNOWN_CP_AUDIT_EVENT_NAMES)[number];

/** Map admin action verbs → resulting status + audit event. */
export const UNKNOWN_CP_ADMIN_ACTIONS = {
  start_review: { newStatus: "details_under_review", audit: "unknown_cp_status_changed" },
  request_more_information: { newStatus: "more_information_required", audit: "unknown_cp_more_info_requested" },
  record_additional_information_reviewed: { newStatus: "details_under_review", audit: "unknown_cp_status_changed" },
  log_outreach_attempt: { newStatus: "outreach_started", audit: "unknown_cp_outreach_attempt_logged" },
  send_counterparty_invite: { newStatus: "counterparty_invited", audit: "unknown_cp_invite_sent" },
  mark_onboarding_in_progress: { newStatus: "counterparty_onboarding_in_progress", audit: "unknown_cp_status_changed" },
  confirm_known_counterparty_link: { newStatus: "converted_to_known_counterparty", audit: "unknown_cp_counterparty_linked" },
  record_declined: { newStatus: "counterparty_declined", audit: "unknown_cp_outcome_recorded" },
  record_no_response: { newStatus: "no_response", audit: "unknown_cp_outcome_recorded" },
  record_unreachable: { newStatus: "unreachable", audit: "unknown_cp_outcome_recorded" },
  mark_invalid_details: { newStatus: "invalid_counterparty_details", audit: "unknown_cp_outcome_recorded" },
  close_case: { newStatus: "closed_by_izenzo", audit: "unknown_cp_case_closed" },
  reopen_case: { newStatus: "details_under_review", audit: "unknown_cp_case_reopened" },
} as const satisfies Record<string, { newStatus: UnknownCpStatus; audit: UnknownCpAuditEventName }>;
export type UnknownCpAdminAction = keyof typeof UNKNOWN_CP_ADMIN_ACTIONS;
