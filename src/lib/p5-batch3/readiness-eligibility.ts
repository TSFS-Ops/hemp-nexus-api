/**
 * P-5 Batch 3 — Stage 2 readiness/finality/Memory eligibility (pure TS).
 *
 * Funder actions FEED review/finality/Memory eligibility, but never
 * directly mutate governance, compliance, readiness or finality.
 * Finality cannot be reached on funder action alone.
 */
import type { P5B3OutcomeType } from "./constants";

export interface P5B3ReadinessSignal {
  funder_outcome: P5B3OutcomeType;
  acting_org: string;
  acting_user: string;
  at: string;
  released_pack_version: number;
}

export interface P5B3FinalityEligibility {
  funder_signal_present: boolean;
  admin_review_complete: boolean;
  compliance_clearance_complete: boolean;
}

export function isFinalityEligible(e: P5B3FinalityEligibility): boolean {
  // Funder signal is necessary BUT NOT sufficient — admin + compliance required.
  return (
    e.funder_signal_present &&
    e.admin_review_complete &&
    e.compliance_clearance_complete
  );
}

export function fundsAlonePermitFinality(): boolean {
  return false;
}

/** Memory must never carry private funder notes or unreleased credit material. */
export interface P5B3MemoryCandidate {
  is_private_funder_note: boolean;
  is_unreleased_internal_credit: boolean;
  is_admin_released: boolean;
}

export function isMemoryEligible(c: P5B3MemoryCandidate): boolean {
  if (c.is_private_funder_note) return false;
  if (c.is_unreleased_internal_credit) return false;
  return c.is_admin_released;
}
