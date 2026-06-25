/**
 * P-5 Batch 4 — Milestone path generator (pure).
 *
 * Generates the ordered milestone list for a given process type.
 * Conditional milestones are present but marked `conditional` so
 * UI/RPC layers can mark them `not_applicable` when not in play.
 *
 * All milestone keys, mandatory types and overdue labels come from
 * the Stage 1 SSOT (src/lib/p5-batch4/constants.ts). No local strings.
 */
import {
  P5B4_MILESTONE_KEYS,
  P5B4_OVERDUE_LABELS,
  type P5B4MilestoneKey,
  type P5B4MandatoryType,
  type P5B4ProcessType,
} from "./constants";

export interface P5B4MilestoneSpec {
  key: P5B4MilestoneKey;
  name: string;
  mandatory_type: P5B4MandatoryType;
  overdue_label: string;
  sort_order: number;
}

/** Human-readable names for each milestone key (UI label, not vocab). */
export const P5B4_MILESTONE_NAMES: Record<P5B4MilestoneKey, string> = {
  case_opened: "Case Opened",
  scope_confirmed: "Scope Confirmed",
  evidence_checklist_generated: "Evidence Checklist Generated",
  evidence_requested: "Evidence Requested",
  evidence_received: "Evidence Received",
  evidence_review_complete: "Evidence Review Complete",
  governance_review_complete: "Governance Review Complete",
  compliance_review_complete: "Compliance Review Complete",
  readiness_confirmed: "Readiness Confirmed",
  funder_release: "Funder Release",
  funder_review_complete: "Funder Review Complete",
  execution_conditions_complete: "Execution Conditions Complete",
  final_approval: "Final Approval",
  finality_recorded: "Finality Recorded",
  closed_archived: "Closed / Archived",
};

/** Which milestone keys are *conditional* (skippable) per process type. */
const CONDITIONAL_BY_PROCESS: Record<P5B4ProcessType, Set<P5B4MilestoneKey>> = {
  company_onboarding: new Set<P5B4MilestoneKey>([
    "funder_release",
    "funder_review_complete",
    "execution_conditions_complete",
  ]),
  transaction_case: new Set<P5B4MilestoneKey>([
    "funder_release",
    "funder_review_complete",
  ]),
  project_workstream: new Set<P5B4MilestoneKey>([
    "funder_release",
    "funder_review_complete",
  ]),
  funder_release: new Set<P5B4MilestoneKey>([
    // For a funder-release case, execution-conditions are conditional.
    "execution_conditions_complete",
  ]),
};

export function buildMilestonePath(
  processType: P5B4ProcessType,
): P5B4MilestoneSpec[] {
  const conditional = CONDITIONAL_BY_PROCESS[processType];
  return P5B4_MILESTONE_KEYS.map((key, idx) => ({
    key,
    name: P5B4_MILESTONE_NAMES[key],
    mandatory_type: conditional.has(key) ? "conditional" : "mandatory",
    overdue_label: P5B4_OVERDUE_LABELS[key],
    sort_order: idx,
  }));
}

export function isFinalApprovalReachable(
  completedKeys: ReadonlySet<P5B4MilestoneKey>,
  waivedKeys: ReadonlySet<P5B4MilestoneKey>,
  notApplicable: ReadonlySet<P5B4MilestoneKey>,
  processType: P5B4ProcessType,
): boolean {
  const path = buildMilestonePath(processType);
  for (const m of path) {
    if (m.key === "final_approval" || m.key === "finality_recorded" || m.key === "closed_archived") continue;
    if (m.mandatory_type !== "mandatory") continue;
    if (notApplicable.has(m.key)) continue;
    if (completedKeys.has(m.key) || waivedKeys.has(m.key)) continue;
    return false;
  }
  return true;
}
