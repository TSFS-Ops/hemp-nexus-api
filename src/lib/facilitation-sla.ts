/**
 * Facilitation SLA helper — browser mirror.
 *
 * Pinned by scripts/check-facilitation-sla-drift.mjs against
 * supabase/functions/_shared/facilitation-sla.ts. Pure helper, no I/O.
 *
 * Business-hours calendar: Mon–Fri 09:00–17:00 UTC. No public-holiday
 * calendar yet — documented as the "business-day helper, no public-holiday
 * calendar" pass for Batch 7.
 */

export const SLA_BUSINESS_DAY_START_H = 9;
export const SLA_BUSINESS_DAY_END_H = 17;
export const SLA_BUSINESS_HOURS_PER_DAY =
  SLA_BUSINESS_DAY_END_H - SLA_BUSINESS_DAY_START_H;

export function snapToBusinessHours(d: Date): Date {
  const out = new Date(d.getTime());
  for (let i = 0; i < 14; i++) {
    const day = out.getUTCDay();
    if (day === 0) {
      out.setUTCDate(out.getUTCDate() + 1);
      out.setUTCHours(SLA_BUSINESS_DAY_START_H, 0, 0, 0);
      continue;
    }
    if (day === 6) {
      out.setUTCDate(out.getUTCDate() + 2);
      out.setUTCHours(SLA_BUSINESS_DAY_START_H, 0, 0, 0);
      continue;
    }
    const h = out.getUTCHours();
    if (h < SLA_BUSINESS_DAY_START_H) {
      out.setUTCHours(SLA_BUSINESS_DAY_START_H, 0, 0, 0);
      continue;
    }
    if (h >= SLA_BUSINESS_DAY_END_H) {
      out.setUTCDate(out.getUTCDate() + 1);
      out.setUTCHours(SLA_BUSINESS_DAY_START_H, 0, 0, 0);
      continue;
    }
    break;
  }
  return out;
}

export function addBusinessMinutes(start: Date, minutes: number): Date {
  if (minutes <= 0) return new Date(start.getTime());
  let d = snapToBusinessHours(start);
  let remaining = minutes;
  while (remaining > 0) {
    const endOfDay = new Date(d.getTime());
    endOfDay.setUTCHours(SLA_BUSINESS_DAY_END_H, 0, 0, 0);
    const minsLeftToday = Math.max(
      0,
      Math.floor((endOfDay.getTime() - d.getTime()) / 60000),
    );
    if (remaining <= minsLeftToday) {
      d = new Date(d.getTime() + remaining * 60000);
      remaining = 0;
    } else {
      remaining -= minsLeftToday;
      d = new Date(endOfDay.getTime());
      do {
        d.setUTCDate(d.getUTCDate() + 1);
      } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
      d.setUTCHours(SLA_BUSINESS_DAY_START_H, 0, 0, 0);
    }
  }
  return d;
}

export function addBusinessHours(start: Date, hours: number): Date {
  return addBusinessMinutes(start, Math.round(hours * 60));
}

export function addBusinessDays(start: Date, days: number): Date {
  return addBusinessMinutes(start, days * SLA_BUSINESS_HOURS_PER_DAY * 60);
}

export const SLA_RULES = {
  owner_assignment_hours: 4,
  initial_triage_days: 1,
  more_info_response_days: 5,
  first_outreach_days: 2,
  follow_up_outreach_days: 3,
  unable_to_contact_close_days: 5,
  compliance_review_days: 2,
  stale_activity_days: 2,
} as const;

export const OVERDUE_REASON_CODES = [
  "owner_assignment_overdue",
  "initial_triage_overdue",
  "more_information_response_overdue",
  "first_outreach_overdue",
  "follow_up_outreach_overdue",
  "compliance_review_overdue",
  "next_action_overdue",
  "stale_no_activity",
] as const;
export type OverdueReasonCode = (typeof OVERDUE_REASON_CODES)[number];

export const OVERDUE_REASON_LABELS: Record<OverdueReasonCode, string> = {
  owner_assignment_overdue: "Owner has not been assigned in time.",
  initial_triage_overdue: "Initial triage has not been completed in time.",
  more_information_response_overdue:
    "The requester has not responded to the more-information request in time.",
  first_outreach_overdue:
    "First counterparty outreach is overdue after clearance.",
  follow_up_outreach_overdue:
    "Follow-up outreach is overdue.",
  compliance_review_overdue: "Compliance review is overdue.",
  next_action_overdue: "The next scheduled action is overdue.",
  stale_no_activity:
    "No status change, note, contact attempt, or next-action update for 2 business days.",
};

/** Plain-English label for each due-date field, for drawer rendering. */
export const SLA_DUE_LABELS: Record<string, string> = {
  owner_assignment_due_at: "Owner assignment due",
  initial_triage_due_at: "Initial triage due",
  more_info_response_due_at: "More-information response due",
  first_outreach_due_at: "First outreach due",
  follow_up_outreach_due_at: "Follow-up outreach due",
  compliance_review_due_at: "Compliance review due",
  next_action_due_at: "Next action due",
};

// ─── Canonical SLA audit names (mirror of Deno SSOT) ─────────────────────
export const FACILITATION_SLA_AUDIT_NAMES = [
  "facilitation_case.sla_evaluated",
  "facilitation_case.overdue_marked",
  "facilitation_case.overdue_cleared",
  "facilitation_case.reminder_sent",
] as const;
export type FacilitationSlaAuditName =
  (typeof FACILITATION_SLA_AUDIT_NAMES)[number];
