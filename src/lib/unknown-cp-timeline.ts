/**
 * P012 — Unknown-Counterparty User-Facing Timeline (SSOT, browser mirror).
 *
 * Pinned by:
 *   - scripts/check-unknown-cp-status-parity.mjs (TS ↔ DB CHECK constraint)
 *   - scripts/check-unknown-cp-audit-names.mjs (TS ↔ Deno parity)
 *   - scripts/check-unknown-cp-copy-drift.mjs (forbidden words / internal status leakage)
 *
 * NEVER hand-edit copy strings in components — import from here.
 * Mirror of supabase/functions/_shared/unknown-cp-timeline.ts.
 */

export const UNKNOWN_CP_STATUS_ORDER = [
  "poi_created",
  "facilitation_case_opened",
  "details_under_review",
  "more_information_required",
  "additional_information_received",
  "outreach_prepared", // INTERNAL-ONLY — must never reach requester UI
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

/** Canonical, verbatim user-facing copy. Approved by client (P012). */
export const UNKNOWN_CP_STATUS_LABEL: Record<UnknownCpStatus, string> = {
  poi_created: "POI created",
  facilitation_case_opened: "Facilitation case opened",
  details_under_review: "Details under review",
  more_information_required: "More information required",
  additional_information_received: "Additional information received",
  outreach_prepared: "Outreach prepared", // internal only
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
  outreach_prepared: "", // never rendered to requester
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

export const UNKNOWN_CP_BLOCKED_PROGRESSION_COPY =
  "This action is not available while the counterparty is unknown, unresponsive, declined, unreachable or not yet linked to this engagement.";

export const UNKNOWN_CP_SLA_NOTE =
  "Izenzo help desk intake is available 24/7. Human review and counterparty outreach are handled during business hours unless separately agreed. Izenzo aims to review new unknown-counterparty cases within 1 business day.";

export const UNKNOWN_CP_FEATURE_NAME = "Izenzo facilitation timeline";
export const UNKNOWN_CP_PANEL_HEADING = "Unknown-counterparty facilitation";
export const UNKNOWN_CP_PANEL_SUBHEADING =
  "Track Izenzo support progress while the counterparty is not yet known or engaged on the platform.";

/** Words that may not appear in user-facing copy unless the underlying event is real. */
export const UNKNOWN_CP_FORBIDDEN_WORDS = [
  "guaranteed",
  "verified",
  "approved",
  "cleared",
  "accepted",
  "contacted",
  "onboarded",
] as const;

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

export interface AllowedActions {
  addMoreInformation: boolean;
  contactSupport: boolean;
  cancelRequest: boolean;
  progressToWaD: boolean;
  disabledMessage: string;
}

const ALL_CLOSED = new Set<UnknownCpStatus>(["cancelled_by_requester", "closed_by_izenzo"]);

export function getAllowedActions(status: UnknownCpStatus): AllowedActions {
  const closed = ALL_CLOSED.has(status);
  const convertedOnly = status === "converted_to_known_counterparty";
  const outcomeBlocked: UnknownCpStatus[] = [
    "counterparty_declined",
    "no_response",
    "unreachable",
    "invalid_counterparty_details",
  ];
  const isOutcomeBlocked = (outcomeBlocked as readonly UnknownCpStatus[]).includes(status);

  let disabledMessage = UNKNOWN_CP_BLOCKED_PROGRESSION_COPY;
  switch (status) {
    case "poi_created":
    case "facilitation_case_opened":
    case "details_under_review":
      disabledMessage = "Counterparty engagement is not yet confirmed.";
      break;
    case "more_information_required":
      disabledMessage = "More information is required before facilitation can continue.";
      break;
    case "additional_information_received":
      disabledMessage = "Izenzo must review the additional information first.";
      break;
    case "outreach_started":
    case "awaiting_counterparty_response":
    case "counterparty_invited":
      disabledMessage = "The counterparty has not yet completed the required engagement step.";
      break;
    case "counterparty_onboarding_in_progress":
      disabledMessage = "Counterparty onboarding is still in progress.";
      break;
    case "converted_to_known_counterparty":
      disabledMessage = "Workflow gates still apply.";
      break;
    case "counterparty_declined":
    case "no_response":
    case "unreachable":
    case "invalid_counterparty_details":
      disabledMessage = "This outcome cannot progress without new reviewed information or admin reopening.";
      break;
    case "cancelled_by_requester":
    case "closed_by_izenzo":
      disabledMessage = "This case is closed. Contact support if new information is available.";
      break;
  }

  return {
    addMoreInformation: !closed && !convertedOnly,
    contactSupport: true,
    cancelRequest: !closed && !convertedOnly,
    progressToWaD: convertedOnly, // still subject to other POI/WaD gates upstream
    disabledMessage,
  };
}

export function isUserVisibleStatus(status: UnknownCpStatus): boolean {
  return !UNKNOWN_CP_INTERNAL_ONLY_STATUSES.has(status);
}

/** Reason codes accepted for "Add more information" submissions. */
export const UNKNOWN_CP_USER_MESSAGE_REASONS = [
  "corrected_details",
  "supporting_document",
  "urgency",
  "cancellation_question",
  "other",
] as const;
export type UnknownCpUserMessageReason = (typeof UNKNOWN_CP_USER_MESSAGE_REASONS)[number];

export const UNKNOWN_CP_ATTACHMENT_MIME_ALLOWLIST = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
] as const;
export const UNKNOWN_CP_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const UNKNOWN_CP_MESSAGE_MIN_CHARS = 20;
export const UNKNOWN_CP_ATTACHMENT_WARNING =
  "Do not upload bank details or identity documents unless Izenzo specifically requested them.";
