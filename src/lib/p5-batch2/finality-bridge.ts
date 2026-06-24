/**
 * P-5 Batch 2 — Stage 6: Finality / readiness bridge adapter.
 *
 * Read-only consumer of Stage 2 `readiness-bridge` deltas, presenting a
 * stable contract that Batch 1 finality/readiness checks can call without
 * needing to know the internal evidence model. This module never writes
 * to trade / POI / WaD / billing / payment / business-decision rows — it
 * only returns a hard-blocker verdict that callers can fold into their
 * existing readiness logic.
 *
 * Wired in deliberately narrow style: callers must opt in explicitly via
 * `evaluateP5B2FinalityGuard(...)`. A wider rewire of Batch 1 readiness
 * is out of scope for Stage 6.
 */
import type { P5B2ReadinessDelta } from "./readiness-bridge";

export type P5B2FinalityVerdict = "clear" | "review" | "blocked";

export interface P5B2FinalityGuardInput {
  deltas: P5B2ReadinessDelta[];
  /** Optional active waiver scopes (mirrors readiness-bridge input). */
  active_waiver_scopes?: string[];
}

export interface P5B2FinalityGuardResult {
  verdict: P5B2FinalityVerdict;
  hard_blockers: P5B2ReadinessDelta[];
  review_items: P5B2ReadinessDelta[];
  waiver_dependent: P5B2ReadinessDelta[];
  reasons: string[];
}

const FINALITY_DIMS = new Set([
  "finality",
  "kyb",
  "kyc",
  "governance",
  "compliance",
  "bankability",
  "execution",
]);

export function evaluateP5B2FinalityGuard(
  input: P5B2FinalityGuardInput,
): P5B2FinalityGuardResult {
  const hard: P5B2ReadinessDelta[] = [];
  const review: P5B2ReadinessDelta[] = [];
  const waiver: P5B2ReadinessDelta[] = [];
  const reasons: string[] = [];

  for (const d of input.deltas) {
    if (!FINALITY_DIMS.has(d.dimension)) continue;
    if (d.severity === "blocker") {
      hard.push(d);
      reasons.push(`${d.dimension}:${d.reason}`);
    } else if (d.severity === "review") {
      review.push(d);
    } else if (d.severity === "warning" && d.reason.startsWith("waived_within_scope")) {
      waiver.push(d);
    } else if (d.severity === "warning" && d.reason.startsWith("provider_dependent")) {
      // Provider-dependent can NEVER support a live verification claim.
      review.push(d);
    }
  }

  let verdict: P5B2FinalityVerdict = "clear";
  if (hard.length > 0) verdict = "blocked";
  else if (review.length > 0) verdict = "review";

  return { verdict, hard_blockers: hard, review_items: review, waiver_dependent: waiver, reasons };
}

/**
 * Convenience: returns true when the guard is hard-blocked. Callers that
 * want to short-circuit existing readiness/finality logic can use this in
 * a single line:
 *   if (isP5B2FinalityBlocked(deltas)) return { ready: false, reasons: [...] };
 */
export function isP5B2FinalityBlocked(deltas: P5B2ReadinessDelta[]): boolean {
  return evaluateP5B2FinalityGuard({ deltas }).verdict === "blocked";
}
