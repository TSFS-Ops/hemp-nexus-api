/**
 * P-5 Batch 5 — Phase 5
 * Approved + banned wording for finality / Memory UI surfaces.
 *
 * Re-exports the canonical banned-word list from `outcomes.ts` and adds
 * the approved phrase set used by UI banners, dialogs and tooltips.
 *
 * The companion drift guard `scripts/check-p5-batch5-ui-wording.mjs`
 * scans `src/pages/admin/p5-batch5/`, `src/pages/desk/p5-batch5/`,
 * `src/pages/funder/p5-batch5/` and `src/components/p5-batch5/` for any
 * banned phrase and fails the prebuild if one appears.
 */
import { P5B5_FORBIDDEN_WORDS } from "./outcomes";

export { P5B5_FORBIDDEN_WORDS };

/** Approved short phrases — safe to render verbatim in UI. */
export const P5B5_APPROVED_PHRASES = {
  FINALITY_CREATED: "Finality record created.",
  FINAL_OUTCOME_RECORDED: "Final outcome recorded.",
  RECORDED_IN_MEMORY: "Recorded in Memory.",
  NOT_RECORDED_IN_MEMORY: "Not recorded in Memory.",
  MEMORY_PAUSED:
    "Memory reuse paused pending dispute resolution.",
  CORRECTION_ADDED: "Correction record added.",
  EVIDENCE_BASIS:
    "This outcome is based on accepted evidence and approvals available at the time of finality.",
  SUPERSEDED:
    "This record has been superseded. Use the current finality record for reliance.",
  PROVIDER_DEPENDENCY:
    "Provider dependency affected this outcome.",
  RATING_LOCKED: "Evidence rating locked at finality.",
  UNDER_DISPUTE_SHORT: "Under Dispute — do not rely without review.",
  CORRECTED_SHORT: "Corrected — see correction record.",
  EXCLUDED_FROM_MEMORY: "Excluded from Memory.",
  TEST_OR_INVALID: "Flagged as test or invalid. Not reliable.",
} as const;

/** Approved tooltip copy. */
export const P5B5_APPROVED_TOOLTIPS = {
  WHAT_IS_FINALITY:
    "A locked platform record showing the outcome selected by an authorised user after required evidence, approvals and controls were completed or waived.",
  WHAT_IS_MEMORY:
    "The platform history layer. It records approved final outcomes and correction history. It is not a guarantee and must be read with dispute, correction and permission status.",
  WHAT_IS_DISPUTE:
    "This record has been challenged. Do not rely on it as a clean signal until the dispute is resolved.",
  WHAT_IS_CORRECTION:
    "A later approved correction exists. The original remains preserved for audit.",
} as const;

/**
 * Runtime guard — returns the banned phrases found inside admin-edited
 * copy (reason fields, notes). Server-side enforcement is done by the
 * Phase 1-3 RPCs; this is a defensive client-side check for inputs.
 */
export function findP5B5BannedPhrases(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  return P5B5_FORBIDDEN_WORDS.filter((p) => lower.includes(p.toLowerCase()));
}
