/**
 * D3 — Plain-English "Why this is blocked / what to do next" copy for
 * pending engagements that have been parked by the D2a/D2b server controls.
 *
 * The admin panel surfaces these strings beside the row so an operator can
 * triage without reading source. Keep wording crisp and action-led.
 */

export type AdminEngagementBlockedReason =
  | "binding_review_required"
  | "disputed_being_named"
  | "cancelled_email_change"
  | "contact_incomplete"
  | "late_acceptance_pending_initiator_reconfirmation";

export interface AdminEngagementBlockedCopy {
  /** Short label rendered as a coloured chip. */
  label: string;
  /** One-line explanation of what to do next. */
  next: string;
}

export const ADMIN_ENGAGEMENT_BLOCKED_COPY: Record<
  AdminEngagementBlockedReason,
  AdminEngagementBlockedCopy
> = {
  binding_review_required: {
    label: "Binding review required",
    next: "Resolve binding review before outreach.",
  },
  disputed_being_named: {
    label: "Disputed — being named",
    next: "Dispute must be resolved before progression.",
  },
  cancelled_email_change: {
    label: "Cancelled for email change",
    next: "Create a replacement engagement.",
  },
  contact_incomplete: {
    label: "Contact incomplete",
    next: "Add missing contact details.",
  },
  late_acceptance_pending_initiator_reconfirmation: {
    label: "Late acceptance",
    next: "Initiator must reconfirm.",
  },
};

/**
 * Pick the single most-relevant blocked reason for a row. Order is the
 * server's hard-block order: binding review > dispute > cancelled-email >
 * late-acceptance > contact-incomplete > none.
 */
export function pickAdminEngagementBlockedReason(input: {
  operational_state?: string | null;
  binding_candidates?: unknown;
  binding_resolution?: string | null;
  engagement_status?: string | null;
  contact_blocked?: boolean;
}): AdminEngagementBlockedReason | null {
  const opState = input.operational_state ?? null;
  const status = input.engagement_status ?? null;

  // Binding review (D2b)
  if (
    !input.binding_resolution &&
    (opState === "binding_review_required" || input.binding_candidates != null)
  ) {
    return "binding_review_required";
  }

  // Dispute (D2a)
  if (
    status === "disputed_being_named" ||
    opState === "disputed_being_named"
  ) {
    return "disputed_being_named";
  }

  // Cancel-for-email-change (D2a)
  if (
    status === "cancelled_email_change" ||
    opState === "cancelled_for_email_change"
  ) {
    return "cancelled_email_change";
  }

  if (status === "late_acceptance_pending_initiator_reconfirmation") {
    return "late_acceptance_pending_initiator_reconfirmation";
  }

  if (input.contact_blocked) return "contact_incomplete";

  return null;
}
