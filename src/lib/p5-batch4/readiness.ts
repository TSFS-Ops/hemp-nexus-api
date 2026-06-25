/**
 * P-5 Batch 4 — Readiness roll-up (pure).
 *
 * Rolls milestones + blockers + provider-dependency into the
 * `readiness_status` SSOT vocabulary.
 */
import type {
  P5B4MilestoneKey,
  P5B4MilestoneStatus,
  P5B4ReadinessStatus,
} from "./constants";
import { countOpenHardBlockers, type P5B4BlockerLike } from "./blockers";

export interface P5B4MilestoneLike {
  key: P5B4MilestoneKey;
  status: P5B4MilestoneStatus;
  is_mandatory: boolean;
  is_not_applicable?: boolean;
}

export interface P5B4ReadinessInput {
  milestones: readonly P5B4MilestoneLike[];
  blockers: readonly P5B4BlockerLike[];
  has_provider_dependent_open_item: boolean;
  has_governance_decision: boolean;
  has_compliance_decision: boolean;
}

const READINESS_PREREQ_KEYS: readonly P5B4MilestoneKey[] = [
  "case_opened",
  "scope_confirmed",
  "evidence_checklist_generated",
  "evidence_requested",
  "evidence_received",
  "evidence_review_complete",
  "governance_review_complete",
  "compliance_review_complete",
];

export function rollupReadiness(input: P5B4ReadinessInput): P5B4ReadinessStatus {
  if (countOpenHardBlockers(input.blockers) > 0) return "blocked";

  if (input.has_provider_dependent_open_item) return "provider_dependent";

  const byKey = new Map(input.milestones.map((m) => [m.key, m]));
  for (const k of READINESS_PREREQ_KEYS) {
    const m = byKey.get(k);
    if (!m) return "not_ready";
    if (m.is_not_applicable) continue;
    if (m.status === "complete" || m.status === "waived" || m.status === "not_applicable") continue;
    if (m.status === "active" || m.status === "not_started") return "in_review";
    if (m.status === "blocked" || m.status === "escalated" || m.status === "overdue") return "blocked";
  }

  if (!input.has_governance_decision || !input.has_compliance_decision) {
    return "in_review";
  }

  const readinessMs = byKey.get("readiness_confirmed");
  if (readinessMs && (readinessMs.status === "complete" || readinessMs.status === "waived")) {
    return "ready_for_finality";
  }
  return "internally_ready";
}
