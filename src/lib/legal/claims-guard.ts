/**
 * DEC-010 - Claims guard.
 *
 * Server-side validator for admin-edited copy (outreach body, notification
 * titles, claim-bearing admin fields). Static public pages are policed
 * by the prebuild check (scripts/check-legal-claims.mjs), not this guard.
 */

import {
  FORBIDDEN_PUBLIC_CLAIM_PHRASES,
  FORBIDDEN_PRE_ACCEPTANCE_TERMS,
  findForbiddenPhrases,
  findForbiddenTerms,
} from "./forbidden-terms";
import type { AssertResult } from "./pre-acceptance-wording";

export interface ClaimContext {
  surface: "outreach_body" | "notification_title" | "admin_claim_field" | string;
  accepted?: boolean;
}

export function assertClaimSafe(text: string, context: ClaimContext): AssertResult {
  const phraseHits = findForbiddenPhrases(text, FORBIDDEN_PUBLIC_CLAIM_PHRASES);
  const termHits = context.accepted
    ? []
    : findForbiddenTerms(text, FORBIDDEN_PRE_ACCEPTANCE_TERMS);
  const blockedTerms = [...new Set([...phraseHits, ...termHits])];
  return blockedTerms.length === 0
    ? { ok: true, blockedTerms: [] }
    : {
        ok: false,
        blockedTerms,
        warning:
          "This claim is not approved. Remove finality, binding, or fully-automated language until the underlying capability is evidenced.",
      };
}
