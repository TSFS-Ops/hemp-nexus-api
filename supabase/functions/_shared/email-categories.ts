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
