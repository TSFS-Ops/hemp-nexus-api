/**
 * Facilitation Batch 11 — Invite Unopened Auto-Detector (pure helpers).
 *
 * Deterministic, side-effect-free helpers shared between the edge function
 * implementation and the vitest unit suite. No DB access, no network, no
 * Deno-only APIs in this module — safe to import from both runtimes.
 *
 * Scope: identify facilitation outreach sends that have been sent at least
 * 3 business days ago and have not been observed as opened/replied, scoped
 * to non-terminal parent cases that don't already have an equivalent
 * detector flag or active SLA-reminder coverage.
 *
 * Hard safety boundary: this module produces *decisions* only. It never
 * sends messages, never mutates commercial / compliance / token / POI /
 * WaD / match / outreach state, and never touches RLS.
 */

export const INVITE_UNOPENED_NEXT_STEP_KIND = "invite_unopened_3bd" as const;
export const INVITE_UNOPENED_AUDIT_NAME =
  "facilitation_case.invite_unopened_flagged" as const;
export const INVITE_UNOPENED_BUSINESS_DAYS_THRESHOLD = 3 as const;
export const INVITE_UNOPENED_DETECTOR_SOURCE = "auto_detector" as const;

/** UTC weekdays (Mon–Fri) elapsed strictly after `start` and up to/including `end`. */
export function businessDaysBetween(start: Date, end: Date): number {
  if (!(start instanceof Date) || !(end instanceof Date)) return 0;
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  if (end.getTime() <= start.getTime()) return 0;
  const MS = 86_400_000;
  // Count whole-day boundaries crossed after `start`. We walk day-by-day in
  // UTC and count weekdays. Bounded by a sane max to avoid runaway loops.
  const days = Math.floor((end.getTime() - start.getTime()) / MS);
  let count = 0;
  for (let i = 1; i <= days && i <= 366; i++) {
    const d = new Date(start.getTime() + i * MS);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** Outreach-send status values that mean the recipient has engaged. */
export const ENGAGED_SEND_STATUSES: ReadonlySet<string> = new Set([
  "opened",
  "clicked",
  "replied",
  "responded",
]);

/** Outreach-send status values that mean delivery never succeeded. */
export const FAILED_SEND_STATUSES: ReadonlySet<string> = new Set([
  "failed",
  "bounced",
  "suppressed",
  "rejected",
]);

/**
 * SLA reminder reason codes that already cover an unopened outreach for the
 * same case. If any such reminder exists (recent), the detector skips so we
 * never double-flag.
 */
export const SLA_REMINDER_COVERING_REASONS: ReadonlySet<string> = new Set([
  "first_outreach_overdue",
  "follow_up_outreach_overdue",
]);

export interface DetectorSendInput {
  send_id: string;
  case_id: string;
  sent_at: string | null;
  /** outreach send status (queued/sent/opened/replied/failed/...). */
  send_status: string;
  /** facilitation_cases.internal_status */
  case_internal_status: string;
  /** true if a next-step row with kind=invite_unopened_3bd already exists for this send */
  already_flagged: boolean;
  /** true if an SLA reminder of a covering reason already exists (recent) for this case */
  sla_reminder_covered: boolean;
}

export type DetectorSkipReason =
  | "never_sent"
  | "engaged"
  | "delivery_failed"
  | "too_recent"
  | "terminal_case"
  | "already_flagged"
  | "sla_reminder_covered";

export type DetectorDecision =
  | { action: "flag"; business_days: number }
  | { action: "skip"; reason: DetectorSkipReason; business_days: number };

export function decideFlag(
  input: DetectorSendInput,
  now: Date,
  terminalStatuses: ReadonlySet<string>,
): DetectorDecision {
  if (!input.sent_at) return { action: "skip", reason: "never_sent", business_days: 0 };
  const sentAt = new Date(input.sent_at);
  const bd = businessDaysBetween(sentAt, now);
  if (terminalStatuses.has(input.case_internal_status)) {
    return { action: "skip", reason: "terminal_case", business_days: bd };
  }
  if (ENGAGED_SEND_STATUSES.has(input.send_status)) {
    return { action: "skip", reason: "engaged", business_days: bd };
  }
  if (FAILED_SEND_STATUSES.has(input.send_status)) {
    return { action: "skip", reason: "delivery_failed", business_days: bd };
  }
  if (input.already_flagged) {
    return { action: "skip", reason: "already_flagged", business_days: bd };
  }
  if (input.sla_reminder_covered) {
    return { action: "skip", reason: "sla_reminder_covered", business_days: bd };
  }
  if (bd < INVITE_UNOPENED_BUSINESS_DAYS_THRESHOLD) {
    return { action: "skip", reason: "too_recent", business_days: bd };
  }
  return { action: "flag", business_days: bd };
}

/** Build the canonical next-step row payload for an eligible send. */
export function buildNextStepRow(args: {
  case_id: string;
  send_id: string;
  sent_at: string;
  business_days: number;
  detector_user_id: string;
}) {
  return {
    case_id: args.case_id,
    created_by: args.detector_user_id,
    next_step_type: INVITE_UNOPENED_NEXT_STEP_KIND,
    status: "open" as const,
    title: "Counterparty invite unopened ≥3 business days",
    description:
      "Auto-detected: an outreach invite for this case has not been observed as opened after at least 3 business days. Internal next-step only — no message has been sent to the counterparty.",
    required_actions: {
      source: INVITE_UNOPENED_DETECTOR_SOURCE,
      kind: INVITE_UNOPENED_NEXT_STEP_KIND,
      outreach_send_id: args.send_id,
      sent_at: args.sent_at,
      business_days_at_flag: args.business_days,
    },
  };
}
