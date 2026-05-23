/**
 * DEC-005 / DEC-006 / DEC-010 — single source of forbidden wording.
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
 * DEC-010 — phrases that may never appear on public marketing or docs pages
 * without explicit "in development" / "planned hardening" qualification.
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
 * Phrase scanner — does NOT enforce word boundaries (phrases may include
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
