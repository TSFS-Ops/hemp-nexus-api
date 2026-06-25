/**
 * P-5 Batch 5 — Finality, Memory and Outcome History
 * Closed vocabularies (single source of truth).
 *
 * Mirrored verbatim in:
 *   - Postgres enums (migration `p5b5_*`)
 *   - drift guard: scripts/check-p5-batch5-vocab-drift.mjs
 *
 * The v1 `basic_memory_records` vocab in `src/lib/basic-memory/outcomes.ts`
 * is intentionally NOT extended — Batch 5 is a separate governed layer.
 *
 * Per Batch 5 plan (Phase 1): schema/SSOT/guard only. No UI, no cron.
 */

export const P5B5_FINALITY_STATUSES = [
  "none",
  "ready_for_finality",
  "final",
  "under_dispute",
  "corrected",
  "superseded",
  "invalid_test",
] as const;
export type P5B5FinalityStatus = (typeof P5B5_FINALITY_STATUSES)[number];

export const P5B5_FINAL_OUTCOME_CODES = [
  "COMPLETED",
  "COMPLETED_WITH_EXCEPTION",
  "APPROVED_NOT_EXECUTED",
  "WITHDRAWN_BY_USER",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
  "FAILED_PROVIDER_DEPENDENCY",
  "DISPUTED",
  "SUPERSEDED",
  "TEST_OR_INVALID",
] as const;
export type P5B5FinalOutcomeCode = (typeof P5B5_FINAL_OUTCOME_CODES)[number];

export const P5B5_MEMORY_STATUSES = [
  "active",
  "paused",
  "excluded",
  "corrected",
  "superseded",
  "not_written",
] as const;
export type P5B5MemoryStatus = (typeof P5B5_MEMORY_STATUSES)[number];

export const P5B5_DISPUTE_STATUSES = [
  "none",
  "under_dispute",
  "resolved_upheld",
  "resolved_partially_upheld",
  "resolved_dismissed",
  "withdrawn",
  "escalated",
] as const;
export type P5B5DisputeStatus = (typeof P5B5_DISPUTE_STATUSES)[number];

export const P5B5_CORRECTION_STATUSES = [
  "none",
  "corrected",
  "superseded",
  "administrative_reclassification",
] as const;
export type P5B5CorrectionStatus = (typeof P5B5_CORRECTION_STATUSES)[number];

export const P5B5_PROVIDER_DEPENDENCY_STATUSES = [
  "success",
  "failed",
  "inconclusive",
  "reconciled",
  "refunded",
  "duplicate_ignored",
  "not_applicable",
] as const;
export type P5B5ProviderDependencyStatus =
  (typeof P5B5_PROVIDER_DEPENDENCY_STATUSES)[number];

export const P5B5_EVIDENCE_COMPLETENESS_STATUSES = [
  "complete",
  "incomplete",
  "waived",
  "not_applicable",
] as const;
export type P5B5EvidenceCompletenessStatus =
  (typeof P5B5_EVIDENCE_COMPLETENESS_STATUSES)[number];

/** Outcome type classification (informational; used by Memory writer in Phase 3). */
export const P5B5_OUTCOME_TYPE: Record<
  P5B5FinalOutcomeCode,
  "positive" | "qualified" | "neutral" | "negative"
> = {
  COMPLETED: "positive",
  COMPLETED_WITH_EXCEPTION: "qualified",
  APPROVED_NOT_EXECUTED: "neutral",
  WITHDRAWN_BY_USER: "neutral",
  REJECTED: "negative",
  EXPIRED: "neutral",
  CANCELLED: "neutral",
  FAILED_PROVIDER_DEPENDENCY: "neutral",
  DISPUTED: "neutral",
  SUPERSEDED: "neutral",
  TEST_OR_INVALID: "neutral",
};

/** Approved UI labels (used by later UI phases). */
export const P5B5_FINALITY_STATUS_LABELS: Record<P5B5FinalityStatus, string> = {
  none: "None",
  ready_for_finality: "Ready for Finality",
  final: "Final",
  under_dispute: "Under Dispute",
  corrected: "Corrected",
  superseded: "Superseded",
  invalid_test: "Invalid/Test",
};

export const P5B5_MEMORY_STATUS_LABELS: Record<P5B5MemoryStatus, string> = {
  active: "Active",
  paused: "Paused",
  excluded: "Excluded",
  corrected: "Corrected",
  superseded: "Superseded",
  not_written: "Not Written",
};

/**
 * Banned wording for Batch 5. Mirrors section 13.2 of the brief.
 * Enforced by a copy guard in a later phase.
 */
export const P5B5_FORBIDDEN_WORDS = [
  "legally final",
  "guaranteed",
  "risk-free",
  "regulator verified",
  "government approved",
  "bank verified",
  "certified true",
  "fraud-proof",
  "permanent truth",
  "unquestionable",
  "compliant without qualification",
  "ai knows",
  "memory knows",
  "trusted forever",
  "automatically approved",
] as const;
