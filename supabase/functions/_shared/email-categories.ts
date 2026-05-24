/**
 * email-categories
 * ----------------
 * Batch M Fix 1: every transactional template MUST have an explicit category
 * so that suppression (unsubscribe) and notification preferences can be
 * enforced safely.
 *
 * Categories
 *  - security:      auth, password reset, MFA, account self-deletion etc.
 *                   Bypasses unsubscribe and preferences (cannot be opted out).
 *  - compliance:    KYB, sanctions, audit, dispute, WaD, retention etc.
 *                   Bypasses unsubscribe and preferences (cannot be opted out).
 *  - transactional: receipts, state-transition, POI issuance, engagement
 *                   acknowledgements. Bypasses unsubscribe (user expects them
 *                   based on a specific action they took), but a per-key
 *                   preference MAY suppress them.
 *  - optional:      digests, weekly summaries, marketing-adjacent product
 *                   nudges. Honour unsubscribe AND preferences.
 *
 * Mapping is intentionally conservative — when in doubt classify as
 * `transactional` (still respects preferences), never `optional` by mistake.
 */

export type EmailCategory = "security" | "compliance" | "transactional" | "optional";

/** Templates known to the system and their safe-default category. */
export const TEMPLATE_CATEGORY: Record<string, EmailCategory> = {
  // Transactional receipts & acknowledgements
  "match-notification": "transactional",
  "state-transition": "transactional",
  "poi-issuance": "transactional",
  "poi-invite": "transactional",
  "poi-counterparty-notify": "transactional",
  "poi-support-desk-notify": "transactional",
  "acceptance-receipt": "transactional",
  "revenue-event-notify": "transactional",
  "batch-d-initiator-alert": "transactional",
  // Optional / digest-style
  "outreach-intent-to-trade": "optional",
  "outreach-sla-digest": "optional",
};

/**
 * Map a template name to the user notification_preferences key it should
 * honour. Return null when the template is category=security|compliance
 * or simply has no per-user preference toggle.
 */
export const TEMPLATE_PREFERENCE_KEY: Record<string, string | null> = {
  "poi-issuance": "poi_sealed",
  "poi-counterparty-notify": "counterparty_action",
  "poi-support-desk-notify": null, // admin desk visibility — not user-toggleable
  "acceptance-receipt": "counterparty_action",
  "state-transition": "counterparty_action",
  "match-notification": "new_counterparty",
  "outreach-intent-to-trade": "new_counterparty",
  "outreach-sla-digest": "weekly_summary",
  "revenue-event-notify": null, // billing/compliance-adjacent — see compliance_status if ever toggled
  "batch-d-initiator-alert": null,
  "poi-invite": null,
};

export function getCategoryForTemplate(templateName: string): EmailCategory {
  // Conservative default: unknown templates are treated as transactional so
  // they continue to honour suppression but cannot be silently re-categorised
  // as optional and dropped.
  return TEMPLATE_CATEGORY[templateName] ?? "transactional";
}

export function getPreferenceKeyForTemplate(templateName: string): string | null {
  return TEMPLATE_PREFERENCE_KEY[templateName] ?? null;
}

/**
 * Should suppression-list (unsubscribe / bounce / complaint) block this
 * category? Security and compliance bypass; transactional and optional do
 * NOT bypass — but transactional templates rarely apply unsubscribe in
 * practice because the user explicitly triggered them.
 *
 * Per Batch M Fix 3 acceptance: optional emails are blocked by unsubscribe,
 * security/compliance bypass, and transactional follows the explicit
 * template rule (today: blocked, matching prior behaviour, until a future
 * client decision relaxes specific templates).
 */
export function isBlockedByUnsubscribe(category: EmailCategory): boolean {
  return category === "optional" || category === "transactional";
}

/**
 * Should the per-user notification preference toggle be allowed to block
 * this category? Only optional. Security/compliance never blocked.
 * Transactional preferences exist (e.g. weekly_summary applies to a
 * transactional-flavoured digest) but the helper treats transactional as
 * unblocked-by-pref unless caller explicitly passes a prefKey AND the
 * template is in TEMPLATE_PREFERENCE_KEY — caller decides.
 */
export function isBlockedByPreference(category: EmailCategory): boolean {
  return category === "optional";
}

// =====================================================================
// NOT-008 / DEC-009 — Signed-form 7-category classification
// ---------------------------------------------------------------------
// The signed Client Decision Form defines seven canonical notification
// categories. The legacy 4-category EmailCategory above remains the
// suppression/preference SSOT for transactional-email rendering. The
// SignedCategory layer below is an ADDITIONAL classification used only
// to decide what to AUDIT and whether an essential notice sent to an
// unsubscribed user must carry the mandated disclaimer footer.
//
// Decision matrix (recipient is in suppressed_emails):
//   marketing     → suppress, emit marketing_suppressed_unsubscribed_user
//   non_essential → suppress, emit marketing_suppressed_unsubscribed_user
//   transactional → SEND with disclaimer, emit transactional_sent_…
//   security      → SEND with disclaimer, emit transactional_sent_…
//   payment       → SEND with disclaimer, emit transactional_sent_…
//   compliance    → SEND with disclaimer, emit transactional_sent_…
//   admin_only    → SEND only when template has a fixed `to` (admin desk);
//                   never to a normal user recipient; emit transactional_sent_…
// In every suppressed-recipient evaluation, also emit
// notification.send_evaluated_unsubscribed_user as the umbrella audit.
// =====================================================================

export type SignedCategory =
  | "marketing"
  | "non_essential"
  | "transactional"
  | "security"
  | "payment"
  | "compliance"
  | "admin_only";

/**
 * Signed-form category for every registered template. Defaults to
 * `transactional` (the conservative essential-notice path) for unknown
 * templates, matching the legacy default for the 4-cat helper.
 */
export const SIGNED_TEMPLATE_CATEGORY: Record<string, SignedCategory> = {
  "match-notification": "transactional",
  "state-transition": "transactional",
  "poi-issuance": "transactional",
  "poi-invite": "transactional",
  "poi-counterparty-notify": "transactional",
  "poi-support-desk-notify": "admin_only",
  "acceptance-receipt": "transactional",
  "revenue-event-notify": "payment",
  "batch-d-initiator-alert": "transactional",
  "outreach-intent-to-trade": "non_essential",
  "outreach-sla-digest": "non_essential",
};

export function getSignedCategoryForTemplate(templateName: string): SignedCategory {
  return SIGNED_TEMPLATE_CATEGORY[templateName] ?? "transactional";
}

/** Categories that MAY still send to an unsubscribed user (essential notices). */
const ESSENTIAL_SIGNED: ReadonlySet<SignedCategory> = new Set([
  "transactional",
  "security",
  "payment",
  "compliance",
]);

/** Categories that MUST be suppressed for an unsubscribed user. */
const SUPPRESSED_FOR_UNSUBSCRIBED: ReadonlySet<SignedCategory> = new Set([
  "marketing",
  "non_essential",
]);

export type UnsubscribedDisposition =
  | { action: "send" }
  | { action: "send_with_disclaimer"; auditAction: "notification.transactional_sent_to_unsubscribed_user" }
  | { action: "suppress"; auditAction: "notification.marketing_suppressed_unsubscribed_user" }
  | { action: "admin_only_skip"; auditAction: "notification.marketing_suppressed_unsubscribed_user" };

/**
 * Decide what to do with a send to a recipient that IS on the suppression
 * list, given the template's signed category. For admin_only, the caller
 * must pass `recipientIsFixedAdminTo=true` if `template.to` matched the
 * effective recipient (fixed admin desk address); otherwise the notice is
 * skipped to honour "admin_only notices do not go to normal users".
 */
export function evaluateUnsubscribedDisposition(
  signed: SignedCategory,
  recipientIsFixedAdminTo: boolean,
): UnsubscribedDisposition {
  if (SUPPRESSED_FOR_UNSUBSCRIBED.has(signed)) {
    return {
      action: "suppress",
      auditAction: "notification.marketing_suppressed_unsubscribed_user",
    };
  }
  if (signed === "admin_only") {
    if (recipientIsFixedAdminTo) {
      return {
        action: "send_with_disclaimer",
        auditAction: "notification.transactional_sent_to_unsubscribed_user",
      };
    }
    return {
      action: "admin_only_skip",
      auditAction: "notification.marketing_suppressed_unsubscribed_user",
    };
  }
  if (ESSENTIAL_SIGNED.has(signed)) {
    return {
      action: "send_with_disclaimer",
      auditAction: "notification.transactional_sent_to_unsubscribed_user",
    };
  }
  // Defensive default — should be unreachable.
  return {
    action: "suppress",
    auditAction: "notification.marketing_suppressed_unsubscribed_user",
  };
}

/**
 * Mandated NOT-008 disclaimer appended to ANY essential notice that is
 * delivered to a recipient on the suppression list. Wording is fixed by
 * the signed Decision Form — do not rephrase.
 */
export const UNSUBSCRIBED_ESSENTIAL_FOOTER =
  "You are receiving this message because it relates to an active Izenzo " +
  "transaction, account, security, payment, compliance, dispute, or " +
  "execution workflow. Marketing emails remain unsubscribed.";

/** HTML form of the footer for injection into rendered email bodies. */
export const UNSUBSCRIBED_ESSENTIAL_FOOTER_HTML =
  `<hr style="margin:24px 0;border:none;border-top:1px solid #E2E8F0" />` +
  `<p style="font-family:Inter,Arial,sans-serif;font-size:12px;color:#475569;line-height:1.5;margin:0">` +
  UNSUBSCRIBED_ESSENTIAL_FOOTER +
  `</p>`;

/** Umbrella audit action emitted for every evaluation against an unsubscribed recipient. */
export const AUDIT_SEND_EVALUATED_UNSUBSCRIBED = "notification.send_evaluated_unsubscribed_user" as const;
export const AUDIT_MARKETING_SUPPRESSED_UNSUBSCRIBED = "notification.marketing_suppressed_unsubscribed_user" as const;
export const AUDIT_TRANSACTIONAL_SENT_UNSUBSCRIBED = "notification.transactional_sent_to_unsubscribed_user" as const;

