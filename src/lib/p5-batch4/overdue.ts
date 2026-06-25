/**
 * P-5 Batch 4 — Overdue & escalation classification (pure).
 *
 * Implements the exact working-day thresholds from the brief, per
 * milestone class. Working days are computed with a simple Mon–Fri
 * counter (holidays are out of scope for Stage 2 — they will be layered
 * in via the SLA-rules module in Stage 7 if/when a calendar is provided).
 *
 * All milestone keys are read from the Stage 1 SSOT; no local strings.
 */
import type { P5B4MilestoneKey } from "./constants";

export type P5B4OverdueState =
  | "on_track"
  | "due_soon"
  | "overdue"
  | "escalated"
  | "blocked";

export interface P5B4SlaRule {
  due_days: number;
  reminder_days: number; // working days BEFORE due
  escalation_days: number;
  critical_days: number | null;
  /** If `mandatory_blocker_after_critical` is true, crossing `critical_days` flips to "blocked". */
  mandatory_blocker_after_critical: boolean;
}

/** Per-milestone SLA. Values from the brief, section 10. */
export const P5B4_SLA_RULES: Record<P5B4MilestoneKey, P5B4SlaRule> = {
  case_opened: { due_days: 1, reminder_days: 0, escalation_days: 1, critical_days: null, mandatory_blocker_after_critical: false },
  scope_confirmed: { due_days: 1, reminder_days: 0, escalation_days: 1, critical_days: null, mandatory_blocker_after_critical: false },
  evidence_checklist_generated: { due_days: 1, reminder_days: 0, escalation_days: 1, critical_days: null, mandatory_blocker_after_critical: false },
  evidence_requested: { due_days: 1, reminder_days: 0, escalation_days: 2, critical_days: null, mandatory_blocker_after_critical: false },
  evidence_received: { due_days: 3, reminder_days: 1, escalation_days: 5, critical_days: 7, mandatory_blocker_after_critical: true },
  evidence_review_complete: { due_days: 2, reminder_days: 1, escalation_days: 3, critical_days: 5, mandatory_blocker_after_critical: false },
  governance_review_complete: { due_days: 2, reminder_days: 1, escalation_days: 3, critical_days: null, mandatory_blocker_after_critical: false },
  compliance_review_complete: { due_days: 3, reminder_days: 1, escalation_days: 5, critical_days: 7, mandatory_blocker_after_critical: false },
  readiness_confirmed: { due_days: 2, reminder_days: 1, escalation_days: 3, critical_days: null, mandatory_blocker_after_critical: false },
  funder_release: { due_days: 5, reminder_days: 2, escalation_days: 7, critical_days: 10, mandatory_blocker_after_critical: false },
  funder_review_complete: { due_days: 5, reminder_days: 2, escalation_days: 7, critical_days: 10, mandatory_blocker_after_critical: false },
  execution_conditions_complete: { due_days: 5, reminder_days: 2, escalation_days: 7, critical_days: null, mandatory_blocker_after_critical: false },
  final_approval: { due_days: 2, reminder_days: 1, escalation_days: 3, critical_days: null, mandatory_blocker_after_critical: false },
  finality_recorded: { due_days: 2, reminder_days: 1, escalation_days: 3, critical_days: null, mandatory_blocker_after_critical: false },
  closed_archived: { due_days: 2, reminder_days: 1, escalation_days: 5, critical_days: null, mandatory_blocker_after_critical: false },
};

/** Count working days between two dates (Mon–Fri only). */
export function workingDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let count = 0;
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(0, 0, 0, 0);
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

export interface P5B4OverdueInput {
  milestone_key: P5B4MilestoneKey;
  is_mandatory: boolean;
  due_at: Date;
  now: Date;
}

export function classifyOverdue(input: P5B4OverdueInput): P5B4OverdueState {
  const rule = P5B4_SLA_RULES[input.milestone_key];
  const isPast = input.now > input.due_at;
  if (!isPast) {
    const remaining = workingDaysBetween(input.now, input.due_at);
    if (remaining <= rule.reminder_days) return "due_soon";
    return "on_track";
  }
  const overdueDays = workingDaysBetween(input.due_at, input.now);
  if (rule.critical_days !== null && overdueDays >= rule.critical_days) {
    if (input.is_mandatory && rule.mandatory_blocker_after_critical) return "blocked";
    return "escalated";
  }
  if (overdueDays >= rule.escalation_days) return "escalated";
  return "overdue";
}
