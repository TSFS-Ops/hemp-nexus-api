/**
 * P-5 Batch 3 — Stage 6 finality bridge (read-only adapter).
 *
 * Evaluates whether a funder outcome / state is *eligible* to feed
 * downstream finality. Never marks anything final on its own. Never
 * rewires Batch 1 finality flows. Opt-in only.
 *
 * Hard rules:
 *   - A single funder approval is NEVER final by itself.
 *   - Finality requires admin review and confirmation.
 *   - A single funder decline does NOT close the transaction.
 *   - When ALL funders decline, the transaction MAY become eligible for
 *     admin-driven closure review (not auto-closure).
 *   - A term sheet received MAY be eligible for admin review.
 *   - A submitted funding decision MAY be eligible for admin review.
 *   - Finality cannot be reached from funder action alone.
 */
import type { P5B3OutcomeType } from "./constants";

export type P5B3FinalityEligibility =
  | "no_change"
  | "admin_review_required"
  | "admin_review_closure_candidate"
  | "admin_review_term_sheet"
  | "admin_review_funding_decision"
  | "admin_review_all_funders_declined";

export interface P5B3FinalityInput {
  funder_outcome?: P5B3OutcomeType;
  /** Snapshot of all funders' latest outcomes on this transaction. */
  all_funder_outcomes?: ReadonlyArray<P5B3OutcomeType | null>;
}

export interface P5B3FinalityEvaluation {
  eligibility: P5B3FinalityEligibility;
  /** ALWAYS false — finality is admin-driven. */
  is_final: false;
  /** Human-readable, admin-facing reason. Never funder-facing wording. */
  internal_reason: string;
  /** Admin must positively confirm — funder action cannot trigger finality. */
  requires_admin_confirmation: true;
}

export function evaluateFinality(input: P5B3FinalityInput): P5B3FinalityEvaluation {
  const base = {
    is_final: false as const,
    requires_admin_confirmation: true as const,
  };

  if (input.funder_outcome === "term_sheet_provided" || input.funder_outcome === "term_sheet_requested") {
    return {
      ...base,
      eligibility: "admin_review_term_sheet",
      internal_reason: "Term sheet activity recorded; eligible for admin review.",
    };
  }
  if (input.funder_outcome === "funding_approved_subject_to_admin") {
    return {
      ...base,
      eligibility: "admin_review_funding_decision",
      internal_reason: "Funder approval is subject to admin confirmation; not final.",
    };
  }

  if (input.all_funder_outcomes && input.all_funder_outcomes.length > 0) {
    const concrete = input.all_funder_outcomes.filter((o): o is P5B3OutcomeType => o !== null);
    if (
      concrete.length === input.all_funder_outcomes.length &&
      concrete.every((o) => o === "declined" || o === "not_interested")
    ) {
      return {
        ...base,
        eligibility: "admin_review_all_funders_declined",
        internal_reason: "All funders have declined; eligible for admin closure review.",
      };
    }
  }

  if (input.funder_outcome === "declined" || input.funder_outcome === "not_interested") {
    return {
      ...base,
      eligibility: "no_change",
      internal_reason: "A single funder decline does not close the transaction.",
    };
  }

  if (input.funder_outcome === "interested" || input.funder_outcome === "conditional_support") {
    return {
      ...base,
      eligibility: "no_change",
      internal_reason: "Funder interest recorded; no finality change.",
    };
  }

  return {
    ...base,
    eligibility: "no_change",
    internal_reason: "No finality-triggering condition met.",
  };
}
