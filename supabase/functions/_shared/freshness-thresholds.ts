/**
 * COMP-002 / COMP-012 — freshness thresholds (Deno mirror).
 * Must remain string-identical to src/lib/compliance/freshness-thresholds.ts.
 * Pinned by `scripts/check-comp-002-012-thresholds.mjs`.
 */

export const SANCTIONS_FRESHNESS_DAYS = 30;
export const VERIFICATION_FRESHNESS_DAYS = 365;

export const SANCTIONS_FRESHNESS_MS = SANCTIONS_FRESHNESS_DAYS * 86_400_000;
export const VERIFICATION_FRESHNESS_MS = VERIFICATION_FRESHNESS_DAYS * 86_400_000;
