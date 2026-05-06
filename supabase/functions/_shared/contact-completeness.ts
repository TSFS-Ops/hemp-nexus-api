/**
 * Batch A — Counterparty contact-completeness helper (edge-function mirror)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * EXACT MIRROR of `src/lib/contact-completeness.ts`. Edge functions cannot
 * import from `src/`, so the rule lives in two files. Both MUST stay in
 * lockstep — the test `src/tests/contact-completeness.test.ts` pins the
 * web-side behaviour, and `supabase/functions/poi-engagements/index_test.ts`
 * pins this side. Any change to one file must be applied to the other in
 * the same commit.
 *
 * See the web file for full doc-block on rules, returned states, and the
 * binding client correction (06 May 2026): email-only with no
 * organisation/name is "contact_incomplete", never "organisation_contact".
 */

export type ContactState =
  | "organisation_contact"
  | "named_individual_contact"
  | "email_missing"
  | "contact_incomplete";

export interface ContactEngagementInput {
  counterparty_email?: string | null;
  counterparty_org_id?: string | null;
  contact_name?: string | null;
  contact_type?: string | null;
  counterparty_org?: { id?: string | null; name?: string | null } | null;
}

export interface ContactMatchInput {
  buyer_name?: string | null;
  seller_name?: string | null;
  buyer_org_id?: string | null;
  seller_org_id?: string | null;
}

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

export function getContactState(
  engagement: ContactEngagementInput,
  match?: ContactMatchInput | null,
): ContactState {
  const emailUsable = isUsableContactEmail(engagement.counterparty_email);
  const orgLinked = !!(engagement.counterparty_org_id && String(engagement.counterparty_org_id).trim());
  const orgName = resolveOrgName(engagement, match ?? null);
  const hasOrganisation = orgLinked || !!orgName;
  const explicitNamedIndividual = engagement.contact_type === "named_individual";
  const contactName = (engagement.contact_name ?? "").trim();
  const hasNamedIndividual = explicitNamedIndividual && !!contactName;
  const hasAnyName = hasOrganisation || hasNamedIndividual || !!contactName;

  if (!emailUsable) {
    if (hasAnyName) return "email_missing";
    return "contact_incomplete";
  }
  if (hasNamedIndividual) return "named_individual_contact";
  if (hasOrganisation) return "organisation_contact";
  return "contact_incomplete";
}

export function isOutreachBlocked(state: ContactState): boolean {
  return state === "email_missing" || state === "contact_incomplete";
}

export function contactStateLabel(state: ContactState): string {
  switch (state) {
    case "organisation_contact": return "Organisation-level contact";
    case "named_individual_contact": return "Named individual contact";
    case "email_missing": return "Email missing";
    case "contact_incomplete": return "Contact incomplete";
  }
}

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

export function contactBlockCode(state: ContactState): "CONTACT_EMAIL_MISSING" | "CONTACT_INCOMPLETE" | null {
  switch (state) {
    case "email_missing": return "CONTACT_EMAIL_MISSING";
    case "contact_incomplete": return "CONTACT_INCOMPLETE";
    default: return null;
  }
}
