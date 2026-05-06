/**
 * Batch A — Counterparty contact-completeness helper
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Single source of truth for the question: "Can platform outreach be sent
 * to this counterparty, and how should the captured contact be labelled?"
 *
 * Used by:
 *   • Admin Pending Engagements panel (badge + Notify gate)
 *   • Add Contact dialog (radio constraints + post-save badge)
 *   • Match-detail Pending Engagement card (badge shown to the initiator)
 *   • Edge function `poi-engagements` (preview-outreach + send-outreach
 *     gate) — mirrored verbatim in
 *     `supabase/functions/_shared/contact-completeness.ts` because edge
 *     functions cannot import from `src/`. The two files MUST stay in
 *     lockstep; the regression test
 *     `src/tests/contact-completeness.test.ts` pins the behaviour.
 *
 * ── Decision rules (signed: David, James, Daniel — 06 May 2026) ──
 *
 * Returns one of:
 *
 *   • "organisation_contact"   — usable email present AND (counterparty_org_id
 *                                is linked OR a non-empty organisation name
 *                                is on the engagement / parent match).
 *
 *   • "named_individual_contact" — usable email present AND a non-empty
 *                                  contact_name is recorded on the engagement.
 *                                  (contact_type='named_individual' is the
 *                                  authoritative signal once captured.)
 *
 *   • "email_missing"          — a name is recorded (organisation OR
 *                                individual) BUT counterparty_email is null,
 *                                blank, malformed or .invalid.
 *
 *   • "contact_incomplete"     — neither a usable name NOR a usable email is
 *                                present. The most restrictive state.
 *
 * Outreach (preview + send) is BLOCKED for "email_missing" and
 * "contact_incomplete". Outreach is ALLOWED for "organisation_contact" and
 * "named_individual_contact".
 *
 * ── Important client correction (06 May 2026) ──
 * Email-only with no organisation name, no linked counterparty organisation,
 * AND no named individual is "contact_incomplete" — NEVER
 * "organisation_contact". Do not relax this rule without re-signing.
 */

export type ContactState =
  | "organisation_contact"
  | "named_individual_contact"
  | "email_missing"
  | "contact_incomplete";

/** Minimum engagement fields the helper inspects. */
export interface ContactEngagementInput {
  counterparty_email?: string | null;
  counterparty_org_id?: string | null;
  /** Free-text contact name on the engagement (Batch A column). */
  contact_name?: string | null;
  /** "organisation" | "named_individual" | null. */
  contact_type?: string | null;
  /** Optional embedded org row from the API (initiator/counterparty join). */
  counterparty_org?: { id?: string | null; name?: string | null } | null;
}

/** Optional parent-match fields used as a name fallback. */
export interface ContactMatchInput {
  buyer_name?: string | null;
  seller_name?: string | null;
  buyer_org_id?: string | null;
  seller_org_id?: string | null;
}

/**
 * Returns true when the email is plausibly deliverable. Mirrors
 * `isUsableOutreachEmail` in `AdminPendingEngagementsPanel.tsx` so the gate
 * is identical on every surface.
 *   • non-null, non-blank
 *   • exactly one '@' with content on both sides
 *   • domain does NOT end in `.invalid` (RFC 2606 reserved test TLD)
 */
export function isUsableContactEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const trimmed = String(email).trim().toLowerCase();
  if (!trimmed) return false;
  const at = trimmed.indexOf("@");
  if (at <= 0 || at !== trimmed.lastIndexOf("@") || at === trimmed.length - 1) return false;
  const domain = trimmed.slice(at + 1);
  if (domain.endsWith(".invalid") || domain === "invalid") return false;
  return true;
}

/**
 * Resolve the "organisation name" the engagement is associated with, if any.
 * Looks at:
 *   1. The joined counterparty_org.name (preferred — explicit FK link).
 *   2. The unregistered side of the parent match's *_name column.
 *
 * Returns the trimmed name, or null when nothing usable is recorded.
 */
function resolveOrgName(
  engagement: ContactEngagementInput,
  match?: ContactMatchInput | null,
): string | null {
  const joined = (engagement.counterparty_org?.name ?? "").trim();
  if (joined) return joined;

  if (match) {
    const buyerName = (match.buyer_name ?? "").trim();
    const sellerName = (match.seller_name ?? "").trim();
    const buyerUnregistered = !match.buyer_org_id;
    const sellerUnregistered = !match.seller_org_id;
    if (buyerUnregistered && buyerName) return buyerName;
    if (sellerUnregistered && sellerName) return sellerName;
  }
  return null;
}

/**
 * The single rule. Pure function — same inputs always yield the same state.
 */
export function getContactState(
  engagement: ContactEngagementInput,
  match?: ContactMatchInput | null,
): ContactState {
  const emailUsable = isUsableContactEmail(engagement.counterparty_email);

  // A counterparty_org_id link OR a resolved organisation name counts as
  // "organisation present".
  const orgLinked = !!(engagement.counterparty_org_id && String(engagement.counterparty_org_id).trim());
  const orgName = resolveOrgName(engagement, match ?? null);
  const hasOrganisation = orgLinked || !!orgName;

  // Named individual signal: contact_type='named_individual' wins, but a
  // non-empty contact_name alone is also accepted (back-compat for rows
  // captured before the radio existed).
  const explicitNamedIndividual = engagement.contact_type === "named_individual";
  const contactName = (engagement.contact_name ?? "").trim();
  const hasNamedIndividual = explicitNamedIndividual && !!contactName;

  // Has *any* legible name we could put on the outreach?
  const hasAnyName = hasOrganisation || hasNamedIndividual || !!contactName;

  if (!emailUsable) {
    // No usable email. Distinguish "we know who, just no email" from "we
    // know nothing".
    if (hasAnyName) return "email_missing";
    return "contact_incomplete";
  }

  // Email is usable. Now decide which label to surface.
  if (hasNamedIndividual) return "named_individual_contact";
  if (hasOrganisation) return "organisation_contact";

  // Email-only with no organisation and no named individual is INCOMPLETE.
  // This is the binding correction signed on 06 May 2026 and must not
  // silently be relaxed to "organisation_contact".
  return "contact_incomplete";
}

/**
 * True when outreach (preview or send) MUST be blocked.
 */
export function isOutreachBlocked(state: ContactState): boolean {
  return state === "email_missing" || state === "contact_incomplete";
}

/**
 * Plain-English label for badges and tooltips. Wording is part of the
 * signed spec — do not change without re-confirming with the client.
 */
export function contactStateLabel(state: ContactState): string {
  switch (state) {
    case "organisation_contact":
      return "Organisation-level contact";
    case "named_individual_contact":
      return "Named individual contact";
    case "email_missing":
      return "Email missing";
    case "contact_incomplete":
      return "Contact incomplete";
  }
}

/**
 * Why outreach is blocked, in one sentence. Returns null when outreach is
 * allowed. The same string is reused for the API error message and the UI
 * tooltip so the two surfaces never disagree.
 */
export function contactBlockReason(state: ContactState): string | null {
  switch (state) {
    case "email_missing":
      return "Cannot send outreach: a counterparty name is recorded but no usable email is on file. Add an email before sending.";
    case "contact_incomplete":
      return "Cannot send outreach: the counterparty record is incomplete. A usable email AND either an organisation name or a named individual is required.";
    default:
      return null;
  }
}

/**
 * Maps a blocked state to the typed error code surfaced by the edge
 * function. Frontend gates use the same code so error handling is uniform.
 */
export function contactBlockCode(state: ContactState): "CONTACT_EMAIL_MISSING" | "CONTACT_INCOMPLETE" | null {
  switch (state) {
    case "email_missing":
      return "CONTACT_EMAIL_MISSING";
    case "contact_incomplete":
      return "CONTACT_INCOMPLETE";
    default:
      return null;
  }
}
