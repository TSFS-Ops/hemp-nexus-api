/**
 * DEC-005 — Legally safe language before counterparty acceptance.
 *
 * Signed wording constants. Import these instead of hard-coding the strings.
 */

import { FORBIDDEN_PRE_ACCEPTANCE_TERMS, findForbiddenTerms } from "./forbidden-terms";

export const PENDING_ENGAGEMENT_LABEL =
  "Pending Engagement — counterparty invited, awaiting confirmation.";

export const INITIATOR_PENDING_COPY =
  "Counterparty invitation sent. This trade remains pending until the counterparty confirms participation.";

export const OUTREACH_INVITATION_COPY =
  "You have been invited to review a proposed trade on Izenzo. This invitation does not confirm your acceptance. Please review the details and confirm whether you accept or decline participation.";

export const UNSAFE_PRE_ACCEPTANCE_WARNING =
  "This wording is not approved before counterparty acceptance. Use pending, invited, awaiting counterparty confirmation, or draft wording only.";

export interface AssertResult {
  ok: boolean;
  blockedTerms: string[];
  warning?: string;
}

/**
 * Reject admin-edited free-text that contains forbidden pre-acceptance
 * terms. Returns the offending terms; callers decide whether to 422
 * (server) or toast (client).
 */
export function assertPreAcceptanceSafe(
  text: string,
  _context?: { surface?: string; engagementId?: string },
): AssertResult {
  const blockedTerms = findForbiddenTerms(text, FORBIDDEN_PRE_ACCEPTANCE_TERMS);
  return blockedTerms.length === 0
    ? { ok: true, blockedTerms: [] }
    : {
        ok: false,
        blockedTerms,
        warning: UNSAFE_PRE_ACCEPTANCE_WARNING,
      };
}
