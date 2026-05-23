/**
 * DEC-010 — Deno twin of src/lib/legal/claims-guard.ts. Used by edge
 * functions that accept admin-edited copy (outreach body, notification
 * titles).
 */

import { FORBIDDEN_PRE_ACCEPTANCE_TERMS, findForbiddenTerms } from "./legal-wording.ts";

export const FORBIDDEN_PUBLIC_CLAIM_PHRASES = [
  "binding POI",
  "sealed POI",
  "POI sealed",
  "tamper-proof Proof of Intent",
  "completed transaction",
  "final trade",
  "terms are now immutable",
  "automated compliance",
  "continuous sanctions screening",
  "real-time compliance",
  "fully automated end-to-end",
  "guarantees compliance",
  "prevents all fraud",
] as const;

export function findForbiddenPhrases(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  return FORBIDDEN_PUBLIC_CLAIM_PHRASES.filter((p) => lower.includes(p.toLowerCase()));
}

export interface ClaimAssertResult {
  ok: boolean;
  blockedTerms: string[];
  warning?: string;
}

export function assertClaimSafe(
  text: string,
  context: { surface: string; accepted?: boolean },
): ClaimAssertResult {
  const phraseHits = findForbiddenPhrases(text);
  const termHits = context.accepted ? [] : findForbiddenTerms(text, FORBIDDEN_PRE_ACCEPTANCE_TERMS);
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
