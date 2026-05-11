/**
 * Batch E — Initiator-facing neutral copy for paused / outreach-blocked
 * Pending Engagement states.
 *
 * Mirror of the admin chip copy in `admin-engagement-blocked-reasons.ts`,
 * but worded for the INITIATING-org user (org admin / member). Strictly:
 *
 *   - No counterparty name, email, or org name.
 *   - No candidate-org identity (binding review must never reveal which
 *     orgs the platform is choosing between).
 *   - No disputed-counterparty identity, dispute reason, or dispute text.
 *   - No commercial details (commodity, price, quantity, location).
 *   - No accusatory or fault-implying language. Wording is checked
 *     against `BATCH_D_FORBIDDEN_WORDS` by the Batch E test.
 *
 * Pure helper. No UI wiring in Phase 1 — this exists so future
 * initiator-side surfaces (MatchDetails engagement card, disabled
 * "Send outreach" tooltip, etc.) consume one SSOT.
 */

import type { EngagementGuardCode } from "./engagement-progression-guard";

export interface InitiatorBlockedCopy {
  /** One-line headline suitable for a banner or chip. */
  headline: string;
  /** Plain-English explanation. Two short sentences max. */
  body: string;
  /** Optional next-step hint for the initiator. */
  next?: string;
}

/**
 * Codes that represent an outreach- or progression-block initiated by
 * the platform's Batch D controls. Codes outside this map are handled
 * upstream (e.g. plain ENGAGEMENT_NOT_ACCEPTED is a counterparty-side
 * state, not a platform pause).
 */
export type InitiatorBlockedCode = Extract<
  EngagementGuardCode,
  | "DISPUTED_BEING_NAMED"
  | "BINDING_REVIEW_PENDING"
  | "CANCELLED_EMAIL_CHANGE"
  | "LATE_ACCEPTANCE_PENDING_INITIATOR_RECONFIRMATION"
  | "ENGAGEMENT_PENDING_RENEWED_ACCEPTANCE"
>;

export const INITIATOR_BLOCKED_COPY: Record<
  InitiatorBlockedCode,
  InitiatorBlockedCopy
> = {
  DISPUTED_BEING_NAMED: {
    headline: "Engagement paused for platform review",
    body:
      "This Pending Engagement is paused while the platform reviews a query about the recorded contact. No action is required from you while the review is open.",
    next: "We will notify you when the review concludes.",
  },
  BINDING_REVIEW_PENDING: {
    headline: "Engagement paused — confirming counterparty record",
    body:
      "Outreach is paused while the platform confirms which registered organisation the contact belongs to. No outreach has been sent on your behalf.",
    next: "We will resume outreach once the platform completes its review.",
  },
  CANCELLED_EMAIL_CHANGE: {
    headline: "Engagement cancelled — replacement required",
    body:
      "The previous Pending Engagement was cancelled because the contact email needed to change. You can create a replacement engagement with the corrected address.",
    next: "Open the match and create a new engagement to continue.",
  },
  LATE_ACCEPTANCE_PENDING_INITIATOR_RECONFIRMATION: {
    headline: "Late acceptance — your reconfirmation required",
    body:
      "The Pending Engagement expired and the counterparty's late acceptance has been recorded. Reconfirm to proceed, or decline if you no longer wish to continue. No Proof of Intent has been issued and no credit has been used.",
    next: "Reconfirm or decline from the engagement panel.",
  },
  ENGAGEMENT_PENDING_RENEWED_ACCEPTANCE: {
    headline: "Awaiting renewed counterparty acceptance",
    body:
      "A renewed engagement has been issued and is waiting for the counterparty to accept. Workflow progression is paused until acceptance is recorded.",
  },
};

/**
 * Outreach-block codes returned by `evaluateOutreachGate` /
 * `contactBlockCode`. Mapped to the same neutral copy so the admin
 * preview-outreach panel and the initiator surface stay in lockstep.
 */
export type InitiatorOutreachBlockCode =
  | "CONTACT_EMAIL_MISSING"
  | "CONTACT_INCOMPLETE";

export const INITIATOR_OUTREACH_BLOCK_COPY: Record<
  InitiatorOutreachBlockCode,
  InitiatorBlockedCopy
> = {
  CONTACT_EMAIL_MISSING: {
    headline: "Outreach paused — email missing",
    body:
      "Outreach cannot proceed because the counterparty record has a name but no usable email address. Add a usable email to continue.",
    next: "Edit the engagement to add the missing email.",
  },
  CONTACT_INCOMPLETE: {
    headline: "Outreach paused — contact incomplete",
    body:
      "Outreach cannot proceed because the counterparty record is incomplete. A usable email and either an organisation name or a named individual are required.",
    next: "Edit the engagement to complete the contact details.",
  },
};

/**
 * Resolve copy from a guard code. Returns `null` for codes that don't
 * represent a platform pause (e.g. plain ENGAGEMENT_NOT_ACCEPTED).
 */
export function getInitiatorBlockedCopy(
  code: EngagementGuardCode | null | undefined,
): InitiatorBlockedCopy | null {
  if (!code) return null;
  return (
    (INITIATOR_BLOCKED_COPY as Record<string, InitiatorBlockedCopy>)[code] ??
    null
  );
}

export function getInitiatorOutreachBlockCopy(
  code: InitiatorOutreachBlockCode | null | undefined,
): InitiatorBlockedCopy | null {
  if (!code) return null;
  return INITIATOR_OUTREACH_BLOCK_COPY[code] ?? null;
}
