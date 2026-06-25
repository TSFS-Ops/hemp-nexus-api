/**
 * P-5 Batch 4 — Finality eligibility (pure).
 *
 * Whether a case may have `final_approval` and then `finality_recorded`.
 * No DB writes here; the Stage 3 RPC enforces atomicity.
 */
import type {
  P5B4FinalityOutcome,
  P5B4MilestoneKey,
  P5B4ProcessType,
  P5B4ReadinessStatus,
  P5B4RoleKey,
} from "./constants";
import { isFinalApprovalReachable } from "./milestones";
import { countOpenHardBlockers, type P5B4BlockerLike } from "./blockers";
import { checkFinalityAction } from "./permissions";

export interface P5B4FinalityInput {
  process_type: P5B4ProcessType;
  readiness_status: P5B4ReadinessStatus;
  completed_milestone_keys: ReadonlySet<P5B4MilestoneKey>;
  waived_milestone_keys: ReadonlySet<P5B4MilestoneKey>;
  not_applicable_milestone_keys: ReadonlySet<P5B4MilestoneKey>;
  blockers: readonly P5B4BlockerLike[];
  has_final_approval: boolean;
  has_finality_summary: boolean;
  has_audit_reference: boolean;
}

export interface P5B4FinalityEligibility {
  can_record_final_approval: boolean;
  can_record_finality: boolean;
  reasons: string[];
}

export function evaluateFinality(
  input: P5B4FinalityInput,
): P5B4FinalityEligibility {
  const reasons: string[] = [];
  const hardBlockers = countOpenHardBlockers(input.blockers);
  if (hardBlockers > 0) reasons.push("open_hard_blockers");
  if (input.readiness_status === "blocked") reasons.push("readiness_blocked");
  if (input.readiness_status === "not_ready") reasons.push("readiness_not_ready");

  const reachable = isFinalApprovalReachable(
    input.completed_milestone_keys,
    input.waived_milestone_keys,
    input.not_applicable_milestone_keys,
    input.process_type,
  );
  if (!reachable) reasons.push("mandatory_milestone_incomplete");

  const can_record_final_approval = reasons.length === 0;

  const finalityReasons: string[] = [];
  if (!input.has_final_approval) finalityReasons.push("missing_final_approval");
  if (!input.has_finality_summary) finalityReasons.push("missing_finality_summary");
  if (!input.has_audit_reference) finalityReasons.push("missing_audit_reference");
  if (!can_record_final_approval) finalityReasons.push(...reasons);

  return {
    can_record_final_approval,
    can_record_finality: finalityReasons.length === 0,
    reasons: [...new Set([...reasons, ...finalityReasons])],
  };
}

/** Outcomes that constitute case completion (read-only afterwards). */
export const P5B4_TERMINAL_FINALITY_OUTCOMES: ReadonlySet<P5B4FinalityOutcome> = new Set([
  "finality_recorded",
  "rejected",
  "withdrawn",
  "cancelled",
  "superseded",
  "archived",
]);

export function isFinalityActorAllowed(role: P5B4RoleKey): boolean {
  return checkFinalityAction(role).allowed;
}
