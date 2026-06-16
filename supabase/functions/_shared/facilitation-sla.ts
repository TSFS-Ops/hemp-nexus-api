/**
 * Facilitation SLA helper — Deno SSOT.
 *
 * Mirror: src/lib/facilitation-sla.ts (browser).
 * Pinned by scripts/check-facilitation-sla-drift.mjs.
 *
 * Pure deterministic helper. No DB access, no side effects.
 * Business-hours calendar: Mon–Fri 09:00–17:00 UTC.
 * NOTE: no public-holiday calendar exists yet — this is the documented
 * "business-day helper, no public-holiday calendar" pass.
 */

export const SLA_BUSINESS_DAY_START_H = 9;
export const SLA_BUSINESS_DAY_END_H = 17;
export const SLA_BUSINESS_HOURS_PER_DAY =
  SLA_BUSINESS_DAY_END_H - SLA_BUSINESS_DAY_START_H; // 8

/** Returns d snapped forward to the next business-hour boundary. */
export function snapToBusinessHours(d: Date): Date {
  const out = new Date(d.getTime());
  // Loop until inside a Mon–Fri 09:00–17:00 UTC window.
  // Bounded iterations (max ~14 hops) — safe.
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
      // Advance to next business day start.
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

// ─── SLA rule constants (from client questionnaire) ──────────────────────
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

// ─── Overdue reason codes (stable, machine-readable) ─────────────────────
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

// Statuses where outreach-related due dates apply.
const OUTREACH_STATUSES = new Set([
  "ready_for_contact",
  "contact_attempted",
  "awaiting_counterparty_response",
  "counterparty_responded",
  "profile_verification_in_progress",
]);

const TRIAGE_OPEN_STATUSES = new Set([
  "new",
  "awaiting_assignment",
  "admin_reviewing",
]);

const TERMINAL = new Set([
  "converted_to_known_counterparty_poi",
  "unable_to_proceed",
  "cancelled_by_requester",
  "closed",
]);

/**
 * Inputs needed to compute SLA state. The edge function loads these from DB.
 */
export interface SlaInputs {
  created_at: string;
  internal_status: string;
  case_owner_id: string | null;
  closed_at: string | null;
  info_request_requested_at: string | null;
  info_request_response_at: string | null;
  /** Latest event timestamp where to_status entered ready_for_contact. */
  ready_for_contact_at: string | null;
  /** Latest event timestamp where to_status entered compliance_review_required. */
  compliance_review_started_at: string | null;
  /** Earliest contact_attempt.contact_at, if any. */
  first_contact_attempt_at: string | null;
  /** Latest contact_attempt.contact_at, if any. */
  latest_contact_attempt_at: string | null;
  /** Latest contact_attempt.next_action_date (YYYY-MM-DD), if any. */
  latest_next_action_date: string | null;
  /** Most recent meaningful activity timestamp (event, contact, note). */
  last_activity_at: string | null;
}

export interface SlaOutputs {
  owner_assignment_due_at: string | null;
  initial_triage_due_at: string | null;
  more_info_response_due_at: string | null;
  first_outreach_due_at: string | null;
  follow_up_outreach_due_at: string | null;
  compliance_review_due_at: string | null;
  next_action_due_at: string | null;
  is_overdue: boolean;
  overdue_reasons: OverdueReasonCode[];
  /** Echo of last_activity_at — persisted so the queue can render age. */
  last_activity_at: string | null;
}

export function computeSla(input: SlaInputs, now: Date = new Date()): SlaOutputs {
  const status = input.internal_status;
  const created = new Date(input.created_at);

  const isTerminal = TERMINAL.has(status);

  // Owner assignment — relevant until an owner is assigned, while case is open.
  const owner_assignment_due_at = (!input.case_owner_id && !isTerminal)
    ? addBusinessHours(created, SLA_RULES.owner_assignment_hours).toISOString()
    : null;

  // Initial triage — until status leaves the triage-open set.
  const initial_triage_due_at = TRIAGE_OPEN_STATUSES.has(status)
    ? addBusinessDays(created, SLA_RULES.initial_triage_days).toISOString()
    : null;

  // More-info response — only while waiting on the requester.
  const more_info_response_due_at =
    (status === "more_information_needed" && input.info_request_requested_at
      && !input.info_request_response_at)
      ? addBusinessDays(
          new Date(input.info_request_requested_at),
          SLA_RULES.more_info_response_days,
        ).toISOString()
      : null;

  // First outreach — once clearance happened (ready_for_contact reached) and no
  // contact attempt yet.
  const first_outreach_due_at =
    (input.ready_for_contact_at
      && !input.first_contact_attempt_at
      && OUTREACH_STATUSES.has(status))
      ? addBusinessDays(
          new Date(input.ready_for_contact_at),
          SLA_RULES.first_outreach_days,
        ).toISOString()
      : null;

  // Follow-up outreach — first contact made, still no response.
  const follow_up_outreach_due_at =
    (input.first_contact_attempt_at
      && (status === "contact_attempted"
        || status === "awaiting_counterparty_response"))
      ? addBusinessDays(
          new Date(input.first_contact_attempt_at),
          SLA_RULES.follow_up_outreach_days,
        ).toISOString()
      : null;

  // Compliance review — while a review is in flight.
  const compliance_review_due_at =
    (status === "compliance_review_required" && input.compliance_review_started_at)
      ? addBusinessDays(
          new Date(input.compliance_review_started_at),
          SLA_RULES.compliance_review_days,
        ).toISOString()
      : null;

  // Next action — from latest contact attempt next_action_date, if set.
  // Snap to start of business hours on that date.
  const next_action_due_at = (() => {
    if (isTerminal) return null;
    const d = input.latest_next_action_date;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    const at = new Date(`${d}T${String(SLA_BUSINESS_DAY_START_H).padStart(2, "0")}:00:00Z`);
    return snapToBusinessHours(at).toISOString();
  })();

  // ─── Overdue evaluation ─────────────────────────────────────────────────
  const reasons: OverdueReasonCode[] = [];
  const past = (iso: string | null) => !!iso && new Date(iso).getTime() < now.getTime();

  if (!isTerminal) {
    if (past(owner_assignment_due_at)) reasons.push("owner_assignment_overdue");
    if (past(initial_triage_due_at)) reasons.push("initial_triage_overdue");
    if (past(more_info_response_due_at)) reasons.push("more_information_response_overdue");
    if (past(first_outreach_due_at)) reasons.push("first_outreach_overdue");
    if (past(follow_up_outreach_due_at)) reasons.push("follow_up_outreach_overdue");
    if (past(compliance_review_due_at)) reasons.push("compliance_review_overdue");
    if (past(next_action_due_at)) reasons.push("next_action_overdue");

    // Stale activity — no meaningful activity for `stale_activity_days`.
    const activityRef = input.last_activity_at ?? input.created_at;
    const staleThreshold = addBusinessDays(
      new Date(activityRef),
      SLA_RULES.stale_activity_days,
    );
    if (staleThreshold.getTime() < now.getTime()) reasons.push("stale_no_activity");
  }

  return {
    owner_assignment_due_at,
    initial_triage_due_at,
    more_info_response_due_at,
    first_outreach_due_at,
    follow_up_outreach_due_at,
    compliance_review_due_at,
    next_action_due_at,
    is_overdue: reasons.length > 0,
    overdue_reasons: reasons,
    last_activity_at: input.last_activity_at,
  };
}

// ─── Canonical SLA audit names ───────────────────────────────────────────
export const FACILITATION_SLA_AUDIT_NAMES = [
  "facilitation_case.sla_evaluated",
  "facilitation_case.overdue_marked",
  "facilitation_case.overdue_cleared",
  "facilitation_case.reminder_sent",
] as const;
export type FacilitationSlaAuditName =
  (typeof FACILITATION_SLA_AUDIT_NAMES)[number];
