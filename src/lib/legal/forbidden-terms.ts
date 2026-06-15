/**
 * DEC-005 / DEC-006 / DEC-010 - single source of forbidden wording.
 *
 * Pre-acceptance wording must avoid any term that implies legal finality,
 * mutual acceptance, completed transaction, settlement, execution, or WaD.
 *
 * Whole-word matching (case-insensitive). Used by both client (vitest)
 * and server (Deno) via the `_shared/legal-wording.ts` twin which
 * re-declares the same array (Deno cannot import from src/).
 */

export const FORBIDDEN_PRE_ACCEPTANCE_TERMS: readonly string[] = [
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
];

/**
 * DEC-010 - phrases that may never appear on public marketing, docs,
 * UI, email, generated-document, or investor-facing surfaces.
 *
 * Phase 1 expands this list with the explicit DEC-010 prohibited prose
 * (Izenzo replaces legal/financial/regulatory/human review;
 * production-grade audit; regulator-ready audit; demo/test data
 * presented as live traction).
 *
 * Manual-review-required phrases (e.g. "enterprise-ready") are NOT
 * on this list - they are classified in
 * `src/lib/legal/claims-register.ts` under
 * `MANUAL_REVIEW_REQUIRED_CLAIMS` and are not auto-blocked.
 */
export const FORBIDDEN_PUBLIC_CLAIM_PHRASES: readonly string[] = [
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
  // DEC-010 Phase 1 additions - prohibited prose claims.
  "Izenzo replaces legal review",
  "Izenzo replaces financial review",
  "Izenzo replaces regulatory review",
  "Izenzo replaces human review",
  "replaces legal review",
  "replaces financial review",
  "replaces regulatory review",
  "replaces human review",
  "production-grade audit",
  "regulator-ready audit",
  "demo data is live traction",
  "test data is live traction",
  "controlled demo records are live commercial traction",
  "live production traction from demo records",
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Returns the list of forbidden terms that appear in `text`.
 * Whole-word and case-insensitive. Substring-of-larger-word matches
 * (e.g. "completely" containing "complete") are NOT flagged.
 */
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

/**
 * Phrase scanner - does NOT enforce word boundaries (phrases may include
 * punctuation/spaces). Case-insensitive substring search.
 */
export function findForbiddenPhrases(
  text: string,
  phrases: readonly string[] = FORBIDDEN_PUBLIC_CLAIM_PHRASES,
): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  return phrases.filter((p) => lower.includes(p.toLowerCase()));
}
