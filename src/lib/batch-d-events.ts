/**
 * Batch D — D4a Event Catalogue (single source of truth)
 *
 * Canonical list of every notification / audit event introduced by
 * Batch D (Pending Engagement controls). Used by:
 *   - the wording guard (`src/tests/d4a-wording-guard.test.ts`) to
 *     refuse any safe-wording string containing a banned token;
 *   - the catalogue test (`src/tests/d4a-event-catalogue.test.ts`)
 *     to prove every event has exactly one entry and every entry is
 *     `emailEnabled: false` in D4a;
 *   - future D4b/D4c notification wiring (NOT in scope yet).
 *
 * D4a contract: NO event in this catalogue is allowed to dispatch
 * outbound email (`emailEnabled: false`). D4b will flip the admin-only
 * digest events to `true` after Daniel signs off on the wording.
 *
 * Forbidden tokens (enforced by the wording guard):
 *   accusation, accuse, guilty, liable, liability, wrongdoing,
 *   fraud, fraudulent, upheld, dismissed, winner, loser, blame,
 *   fault, violation, breach (case-insensitive)
 */

export type RecipientGroup =
  | "platform_admin"
  | "initiating_org_admin"
  | "counterparty_org_admin"
  | "ordinary_org_member"
  | "external_unregistered_counterparty"
  | "disputed_counterparty";

export type NotificationRecommendation =
  | "audit_only"
  | "admin_queue"
  | "admin_email_candidate"
  | "deferred";

export interface BatchDEventEntry {
  /** Canonical dotted event name. Must be globally unique. */
  event: string;
  /** Short plain-English label for admin-facing surfaces. */
  label: string;
  /** Notification recommendation per the D4 preflight. */
  recommendation: NotificationRecommendation;
  /** Recipient groups that MAY receive a future D4b/D4c message. */
  allowedRecipients: readonly RecipientGroup[];
  /** Recipient groups that MUST NEVER be contacted for this event. */
  forbiddenRecipients: readonly RecipientGroup[];
  /**
   * Neutral, non-accusatory short wording. Scanned by the wording
   * guard. Use "paused", "under review", "pending platform review".
   * Never imply blame, fault, fraud, guilt, or wrongdoing.
   */
  safeWording: string;
  /**
   * D4a hard rule: every event ships with `false`. D4b is the first
   * phase allowed to flip select admin-only events to `true`.
   */
  emailEnabled: false;
}

export const BATCH_D_EVENTS: readonly BatchDEventEntry[] = [
  {
    event: "engagement.binding_review_required",
    label: "Binding review required",
    recommendation: "admin_queue",
    allowedRecipients: ["platform_admin"],
    forbiddenRecipients: [
      "initiating_org_admin",
      "counterparty_org_admin",
      "ordinary_org_member",
      "external_unregistered_counterparty",
      "disputed_counterparty",
    ],
    safeWording:
      "A Pending Engagement requires a binding-review decision and is awaiting platform review.",
    emailEnabled: false,
  },
  {
    event: "engagement.binding_review_resolved",
    label: "Binding review resolved",
    recommendation: "audit_only",
    allowedRecipients: ["platform_admin"],
    forbiddenRecipients: [
      "counterparty_org_admin",
      "ordinary_org_member",
      "external_unregistered_counterparty",
      "disputed_counterparty",
    ],
    safeWording:
      "Binding review resolved. The engagement state has been updated by the platform.",
    emailEnabled: false,
  },
  {
    event: "engagement.disputed_being_named",
    label: "Counterparty dispute received",
    recommendation: "admin_queue",
    allowedRecipients: ["platform_admin"],
    forbiddenRecipients: [
      "ordinary_org_member",
      "external_unregistered_counterparty",
      "disputed_counterparty",
    ],
    safeWording:
      "A counterparty has queried being named on a Pending Engagement. The engagement is paused for platform review.",
    emailEnabled: false,
  },
  {
    event: "engagement.cancelled_email_change",
    label: "Cancelled for email change",
    recommendation: "admin_queue",
    allowedRecipients: ["platform_admin", "initiating_org_admin"],
    forbiddenRecipients: [
      "external_unregistered_counterparty",
      "disputed_counterparty",
    ],
    safeWording:
      "Pending Engagement cancelled for email change. The initiating organisation may create a replacement engagement.",
    emailEnabled: false,
  },
  {
    event: "engagement.email_change_blocked",
    label: "Email change requires cancel-and-recreate",
    recommendation: "audit_only",
    allowedRecipients: ["initiating_org_admin"],
    forbiddenRecipients: [
      "counterparty_org_admin",
      "external_unregistered_counterparty",
      "disputed_counterparty",
    ],
    safeWording:
      "The contact email cannot be edited on this engagement. Please cancel and recreate the engagement with the corrected address.",
    emailEnabled: false,
  },
  {
    event: "outreach.blocked.contact_incomplete",
    label: "Outreach blocked — contact incomplete",
    recommendation: "audit_only",
    allowedRecipients: ["initiating_org_admin"],
    forbiddenRecipients: [
      "counterparty_org_admin",
      "external_unregistered_counterparty",
      "disputed_counterparty",
    ],
    safeWording:
      "Outreach is paused until the counterparty contact details are complete.",
    emailEnabled: false,
  },
  {
    event: "outreach.blocked.binding_review_pending",
    label: "Outreach blocked — binding review pending",
    recommendation: "audit_only",
    allowedRecipients: ["initiating_org_admin"],
    forbiddenRecipients: [
      "counterparty_org_admin",
      "external_unregistered_counterparty",
      "disputed_counterparty",
    ],
    safeWording:
      "Outreach is paused while the platform confirms the registered organisation linked to this contact.",
    emailEnabled: false,
  },
  {
    event: "outreach.blocked.disputed_being_named",
    label: "Outreach blocked — counterparty query under review",
    recommendation: "audit_only",
    allowedRecipients: ["initiating_org_admin"],
    forbiddenRecipients: [
      "counterparty_org_admin",
      "external_unregistered_counterparty",
      "disputed_counterparty",
    ],
    safeWording:
      "Outreach is paused while a counterparty query is under platform review. No action is required from you.",
    emailEnabled: false,
  },
] as const;

/**
 * Forbidden wording tokens. Case-insensitive. Used by both the
 * Vitest wording guard and the lightweight CLI scanner.
 */
export const BATCH_D_FORBIDDEN_WORDS: readonly string[] = [
  "accusation",
  "accuse",
  "guilty",
  "liable",
  "liability",
  "wrongdoing",
  "fraud",
  "fraudulent",
  "upheld",
  "dismissed",
  "winner",
  "loser",
  "blame",
  "fault",
  "violation",
  "breach",
] as const;

export function getBatchDEvent(
  eventName: string,
): BatchDEventEntry | undefined {
  return BATCH_D_EVENTS.find((e) => e.event === eventName);
}

/**
 * Returns the list of forbidden tokens found in `text` (case-insensitive,
 * whole-word match). Empty array means the string is safe.
 */
export function findForbiddenWords(text: string): string[] {
  const hits: string[] = [];
  for (const word of BATCH_D_FORBIDDEN_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    if (re.test(text)) hits.push(word);
  }
  return hits;
}
