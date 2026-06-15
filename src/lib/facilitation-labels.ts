/**
 * Plain-English label maps for the Facilitation Phase 2 UI.
 *
 * Raw enum/code strings (e.g. `dnc_org_name_warning`, `blocked`,
 * `suppressed`, `email_domain`) are written by the server and persisted
 * in audit/event logs as the source of truth. They must never be
 * rendered verbatim to operators — every visible label is mapped here.
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
 * Wraps `parseEdgeError` with a Phase-2-specific fallback so toasts never
 * leak the generic "Edge Function returned a non-2xx status code".
 */
import { parseEdgeError } from "@/lib/edge-error";

export async function friendlyFacilitationError(
  err: unknown,
  fallback: string,
): Promise<string> {
  try {
    const parsed = await parseEdgeError(err);
    const raw = parsed.message?.trim();
    if (!raw || /non-2xx status code/i.test(raw)) return fallback;
    // If the server returned a code we have a friendlier label for, prefer it.
    if (parsed.code && GATE_REASON_LABEL[parsed.code]) {
      return GATE_REASON_LABEL[parsed.code];
    }
    return raw;
  } catch {
    return fallback;
  }
}
