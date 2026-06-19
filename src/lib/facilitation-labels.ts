/**
 * Plain-English label maps for the Facilitation Phase 2 UI.
 *
 * Raw enum/code strings (e.g. `dnc_org_name_warning`, `blocked`,
 * `suppressed`, `email_domain`) are written by the server and persisted
 * in audit/event logs as the source of truth. They must never be
 * rendered verbatim to operators - every visible label is mapped here.
 */

export const OUTREACH_STATE_LABEL: Record<string, string> = {
  new: "New",
  blocked: "Cannot contact",
  escalated: "Escalated to compliance",
  sent: "Sent",
  suppressed: "Address suppressed",
};

export function outreachStateLabel(s: string | null | undefined): string {
  if (!s) return "Unknown";
  return OUTREACH_STATE_LABEL[s] ?? s.replace(/_/g, " ");
}

export const GATE_RESULT_LABEL = {
  allow: "Cleared to contact",
  warn: "Needs acknowledgement",
  block: "Cannot contact",
  unevaluated: "Not yet checked",
} as const;

export const GATE_REASON_LABEL: Record<string, string> = {
  dnc_org_name_warning:
    "Organisation name matches a do-not-contact rule (acknowledgement required).",
  duplicate_soft_name_match:
    "A similar candidate was contacted recently (acknowledgement required).",
  dnc_email_block: "This email address is on the do-not-contact list.",
  dnc_domain_block: "This email domain is on the do-not-contact list.",
  suppressed_email:
    "This email address has previously bounced or unsubscribed.",
  open_escalation_blocks_send:
    "An open compliance escalation must be resolved before contacting this candidate.",
};

export function gateReasonLabel(code: string): string {
  return GATE_REASON_LABEL[code] ?? code.replace(/_/g, " ");
}

export const DNC_RULE_TYPE_LABEL: Record<string, string> = {
  email: "Specific email address",
  email_domain: "Email domain",
  org_name: "Organisation name",
};

export const DNC_SEVERITY_LABEL: Record<string, string> = {
  block: "Blocks contact",
  warn: "Warning only",
};

export const DNC_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  revoked: "Revoked",
};

export const TEMPLATE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  approved: "Approved",
  archived: "Archived",
};

export const SEND_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  sent: "Sent",
  failed: "Failed",
  replay: "Duplicate (not re-sent)",
};

export const ESCALATION_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  resolved: "Resolved",
};

/**
 * Timeline / event-log action codes written by edge functions.
 * Keep raw codes in audit logs; only the labels here are shown in the UI.
 */
export const TIMELINE_ACTION_LABEL: Record<string, string> = {
  "facilitation_case.created": "Case created",
  "facilitation_case.assigned": "Owner assigned",
  "facilitation_case.status_changed": "Status changed",
  "facilitation_case.intake_updated": "Intake updated",
  "facilitation_case.note_added": "Internal note added",
  "facilitation_case.evidence_uploaded": "Evidence uploaded",
  "facilitation_case.source_added": "Source / evidence item added",
  "facilitation_case.milestone_changed": "Requester milestone changed",
  "facilitation_case.outcome_set": "Final outcome set",
  "facilitation_case.closed": "Case closed",
  "facilitation_case.cancelled_by_requester": "Cancelled by requester",
  "facilitation_case.more_information_requested": "More information requested from requester",
  "facilitation_case.more_information_submitted": "Requester submitted more information",
  "facilitation_case.registry_check_recorded": "Registry / KYB check recorded",
  "facilitation_case.sanctions_pep_recorded": "Sanctions / PEP screening recorded",
  "facilitation_case.contact_attempt_recorded": "Call / contact attempt recorded",
  "facilitation_case.organisation_linked": "Linked to an existing organisation",
  "facilitation_case.profile_created_recorded": "Counterparty profile recorded",
  "facilitation_case.ready_for_poi_marked": "Marked ready for POI",
  "facilitation_case.poi_conversion_recorded": "POI conversion recorded",
};


export function timelineActionLabel(action: string): string {
  return (
    TIMELINE_ACTION_LABEL[action] ??
    action
      .replace(/^facilitation_case\./, "")
      .replace(/[._]/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

// ─── Batch 5 — manual check & contact-attempt result labels ─────────────
export const REGISTRY_RESULT_LABEL: Record<string, string> = {
  clear: "Clear",
  possible_match: "Possible match",
  no_match: "No match",
  unavailable: "Source unavailable",
  failed: "Lookup failed",
};
export const CONFIDENCE_LABEL: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  unknown: "Unknown",
};
export const SANCTIONS_RESULT_LABEL: Record<string, string> = {
  clear: "Clear",
  possible_match: "Possible match",
  confirmed_match: "Confirmed match",
  unavailable: "Source unavailable",
  failed: "Screening failed",
};
export const RISK_LEVEL_LABEL: Record<string, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
  critical: "Critical risk",
  unknown: "Unknown risk",
};
export const COMPLIANCE_DECISION_LABEL: Record<string, string> = {
  no_issue: "No issue",
  review_required: "Review required",
  blocked: "Blocked",
  cleared_after_review: "Cleared after review",
};
export const CONTACT_CHANNEL_LABEL: Record<string, string> = {
  phone: "Phone",
  email_outside_system: "Email (outside the system)",
  meeting: "Meeting",
  other: "Other",
};
export const CONTACT_RESULT_LABEL: Record<string, string> = {
  no_answer: "No answer",
  left_message: "Left a message",
  reached_counterparty: "Reached counterparty",
  wrong_contact: "Wrong contact",
  declined: "Declined",
  requested_more_information: "Requested more information",
  other: "Other",
};
function plainLabel(map: Record<string, string>, v: string | null | undefined): string {
  if (!v) return "-";
  return map[v] ?? v.replace(/_/g, " ");
}
export const registryResultLabel = (v: string | null | undefined) => plainLabel(REGISTRY_RESULT_LABEL, v);
export const confidenceLabel = (v: string | null | undefined) => plainLabel(CONFIDENCE_LABEL, v);
export const sanctionsResultLabel = (v: string | null | undefined) => plainLabel(SANCTIONS_RESULT_LABEL, v);
export const riskLevelLabel = (v: string | null | undefined) => plainLabel(RISK_LEVEL_LABEL, v);
export const complianceDecisionLabel = (v: string | null | undefined) => plainLabel(COMPLIANCE_DECISION_LABEL, v);
export const contactChannelLabel = (v: string | null | undefined) => plainLabel(CONTACT_CHANNEL_LABEL, v);
export const contactResultLabel = (v: string | null | undefined) => plainLabel(CONTACT_RESULT_LABEL, v);

/**
 * Final-outcome enum values surfaced in the case drawer dropdown and timeline.
 */
export const OUTCOME_LABEL: Record<string, string> = {
  converted_to_known_counterparty_poi: "Converted to known-counterparty POI",
  linked_to_existing_organisation: "Linked to existing organisation",
  new_counterparty_profile_created: "Counterparty profile created",
  more_information_not_provided: "More information not received",
  counterparty_declined: "Counterparty declined",
  unable_to_contact: "Unable to contact",
  blocked_by_compliance: "Blocked by compliance",
  duplicate_case: "Duplicate",
  cancelled_by_requester: "Cancelled by requester",
  outside_supported_scope: "Out of scope / unsupported",
  closed_by_admin_decision: "Closed by admin decision",
  no_authority_confirmed: "No authority confirmed",
  closed_admin: "Closed by admin",
};

export function outcomeLabel(value: string | null | undefined): string {
  if (!value) return "-";
  return OUTCOME_LABEL[value] ?? value.replace(/_/g, " ");
}

/**
 * Internal user/role tokens. Never render the raw token (e.g. `platform_admin`)
 * directly - always pass through `roleLabel`.
 */
export const ROLE_LABEL: Record<string, string> = {
  platform_admin: "Platform admin",
  compliance_analyst: "Compliance analyst",
  compliance_officer: "Compliance officer",
  org_admin: "Organisation admin",
  org_member: "Organisation member",
  billing_admin: "Billing admin",
  api_admin: "API admin",
  director: "Director",
  auditor: "Auditor",
  legal: "Legal",
  requester: "Requester",
  trader: "Trader",
};

export function roleLabel(token: string | null | undefined): string {
  if (!token) return "";
  return (
    ROLE_LABEL[token] ??
    token
      .replace(/_/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

export function rolesLabel(tokens: readonly string[] | null | undefined): string {
  if (!tokens || tokens.length === 0) return "";
  return Array.from(new Set(tokens.map(roleLabel).filter(Boolean))).join(", ");
}

/**
 * Wraps `parseEdgeError` with a Phase-2-specific fallback so toasts never
 * leak the generic "Edge Function returned a non-2xx status code".
 *
 * Pass `functionName` to append a diagnostic trailer of the form:
 *   "<message> [fn: <name> · 500 · req: <id>]"
 * This makes it possible to correlate a failed toast with the exact edge
 * function + Supabase request id without exposing internals when the call
 * succeeds.
 */
import { parseEdgeError } from "@/lib/edge-error";

export async function friendlyFacilitationError(
  err: unknown,
  fallback: string,
  functionName?: string,
): Promise<string> {
  let base = fallback;
  let parsed: Awaited<ReturnType<typeof parseEdgeError>> | null = null;
  try {
    parsed = await parseEdgeError(err);
    const raw = parsed.message?.trim();
    if (raw && !/non-2xx status code/i.test(raw)) {
      base =
        parsed.code && GATE_REASON_LABEL[parsed.code]
          ? GATE_REASON_LABEL[parsed.code]
          : raw;
    }
  } catch {
    // fall through with `base = fallback`
  }

  if (!functionName) return base;

  const bits: string[] = [`fn: ${functionName}`];
  if (parsed?.status != null) bits.push(String(parsed.status));
  if (parsed?.code) bits.push(parsed.code);
  if (parsed?.requestId) bits.push(`req: ${parsed.requestId}`);
  return `${base} [${bits.join(" · ")}]`;
}

