/**
 * DEC-005 / DEC-006 Deno twin of src/lib/legal/* — Edge runtime cannot
 * import from src/. Keep these constants in lockstep with the client.
 */

export const FORBIDDEN_PRE_ACCEPTANCE_TERMS = [
  "accepted",
  "binding",
  "sealed",
  "verified",
  "confirmed",
  "complete",
  "completed",
  "final",
  "matched by both parties",
  "mutual",
  "contracted",
  "settled",
  "executed",
] as const;

export const PENDING_ENGAGEMENT_LABEL =
  "Pending Engagement — counterparty invited, awaiting confirmation.";

export const INITIATOR_PENDING_COPY =
  "Counterparty invitation sent. This trade remains pending until the counterparty confirms participation.";

export const OUTREACH_INVITATION_COPY =
  "You have been invited to review a proposed trade on Izenzo. This invitation does not confirm your acceptance. Please review the details and confirm whether you accept or decline participation.";

export const DRAFT_POI_LABEL =
  "Draft POI — initiator-generated intent record, awaiting counterparty confirmation.";

export const ACCEPTED_POI_LABEL = "Accepted POI — mutual intent recorded.";

export const POST_ACCEPTANCE_QUALIFIER =
  "Proof of mutual intention recorded. WaD, execution, and finality remain subject to the next required workflow steps.";

export const UNSAFE_PRE_ACCEPTANCE_WARNING =
  "This wording is not approved before counterparty acceptance. Use pending, invited, awaiting counterparty confirmation, or draft wording only.";

export const UNSAFE_POI_WARNING =
  "This POI wording is not approved. A POI may not be described as binding, mutual, accepted, sealed, complete, or final before counterparty acceptance.";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function findForbiddenTerms(
  text: string,
  terms: readonly string[] = FORBIDDEN_PRE_ACCEPTANCE_TERMS,
): string[] {
  if (!text) return [];
  const hits = new Set<string>();
  for (const term of terms) {
    const pattern = new RegExp(`(?<![\\w-])${escapeRe(term)}(?![\\w-])`, "i");
    if (pattern.test(text)) hits.add(term);
  }
  return Array.from(hits);
}

export interface AssertResult {
  ok: boolean;
  blockedTerms: string[];
  warning?: string;
}

export function assertPreAcceptanceSafe(text: string): AssertResult {
  const blockedTerms = findForbiddenTerms(text);
  return blockedTerms.length === 0
    ? { ok: true, blockedTerms: [] }
    : { ok: false, blockedTerms, warning: UNSAFE_PRE_ACCEPTANCE_WARNING };
}

export function assertPoiWordingSafe(
  text: string,
  opts?: { accepted?: boolean },
): AssertResult {
  if (opts?.accepted) return { ok: true, blockedTerms: [] };
  const blockedTerms = findForbiddenTerms(text);
  return blockedTerms.length === 0
    ? { ok: true, blockedTerms: [] }
    : { ok: false, blockedTerms, warning: UNSAFE_POI_WARNING };
}

export function getPoiLabel(opts: { accepted: boolean }): {
  label: string;
  state: "draft" | "accepted";
} {
  return opts.accepted
    ? { label: ACCEPTED_POI_LABEL, state: "accepted" }
    : { label: DRAFT_POI_LABEL, state: "draft" };
}
