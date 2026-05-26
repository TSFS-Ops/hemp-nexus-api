/**
 * Basic Memory Record v1 — approved closed vocabularies.
 *
 * Single source of truth for the v1 trigger types, outcomes and reason
 * codes used by `public.basic_memory_records`. Mirrored verbatim in the
 * DB CHECK constraints and in the drift guard
 * `scripts/check-basic-memory-vocab-drift.mjs` so the vocab cannot drift
 * between the TS layer, the DB and downstream UI panels.
 *
 * v1 scope is intentionally tiny — see audit doc and binding decisions.
 * Do NOT add payment/refund/credit/late-acceptance/cancelled-engagement
 * triggers, scoring, AI summaries or counterparty-visible outcomes here.
 */

export const BASIC_MEMORY_TRIGGER_TYPES = [
  "finality.collapsed",
  "wad.sealed",
  "dispute.resolved",
] as const;

export type BasicMemoryTriggerType =
  (typeof BASIC_MEMORY_TRIGGER_TYPES)[number];

export const BASIC_MEMORY_OUTCOMES = [
  "completed",
  "wad_sealed",
  "dispute_resolved",
] as const;

export type BasicMemoryOutcome = (typeof BASIC_MEMORY_OUTCOMES)[number];

export const BASIC_MEMORY_OUTCOME_REASONS = [
  "collapse_recorded",
  "attestations_complete",
  "dispute_resolved",
] as const;

export type BasicMemoryOutcomeReason =
  (typeof BASIC_MEMORY_OUTCOME_REASONS)[number];

export const BASIC_MEMORY_ENVIRONMENTS = ["live", "demo", "test"] as const;

export type BasicMemoryEnvironment =
  (typeof BASIC_MEMORY_ENVIRONMENTS)[number];

/**
 * Human-readable labels — used by the HQ panel in a later batch. Kept
 * here so wording lives next to the canonical codes.
 */
export const BASIC_MEMORY_OUTCOME_LABELS: Record<BasicMemoryOutcome, string> = {
  completed: "Completed",
  wad_sealed: "WaD sealed",
  dispute_resolved: "Dispute resolved",
};

export const BASIC_MEMORY_TRIGGER_LABELS: Record<
  BasicMemoryTriggerType,
  string
> = {
  "finality.collapsed": "Finality collapsed",
  "wad.sealed": "WaD sealed",
  "dispute.resolved": "Dispute resolved",
};
