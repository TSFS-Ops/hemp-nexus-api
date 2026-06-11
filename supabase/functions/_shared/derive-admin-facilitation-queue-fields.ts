// derive-admin-facilitation-queue-fields.ts
//
// Pure, dependency-free derivation of read-only "queue intelligence" fields
// for the admin Unknown-Counterparty Pending Engagements console.
//
// Ticket: Unknown-Counterparty Admin Facilitation SLA + Queue Hardening — Batch 1.
//
// HARD BOUNDARIES (do not break):
//   • This module performs NO database writes and has NO side effects.
//   • It must NEVER reference, import, call, or invoke any of:
//     notification-dispatch, send-transactional-email, process-email-queue,
//     engagement-reminder, resend, smtp, sendgrid, email, sms, whatsapp, twilio.
//   • It must NEVER produce a "send" affordance or a dispatch URL.
//   • It must NEVER mutate the canonical engagement_status or operational_state.
//     The labels here are display-only.
//   • It must NEVER alter engagement_outreach_logs semantics.
//
// SLA is DERIVED ONLY. There is no sla_due_at / sla_status column in the DB
// and we do not propose adding one. The values returned here are computed
// from `notification_sent_at` (preferred) or `created_at` plus a threshold
// (default 48h, configurable in admin_settings.outreach_sla.threshold_hours
// upstream of this helper).

export const SLA_DEFAULT_THRESHOLD_HOURS = 48;

export type SlaStatus = "on_track" | "due_soon" | "overdue" | "not_applicable";

export type NextActionLabel =
  | "blocked_ineligible"
  | "binding_review_required"
  | "no_outreach_logged"
  | "draft_pending_review"
  | "draft_approved_manual_send"
  | "draft_rejected"
  | "overdue"
  | "waiting_on_counterparty"
  | "waiting_on_initiator"
  | "accepted"
  | "declined"
  | "needs_admin_action";

export interface QueueEngagementInput {
  id: string;
  engagement_status: string | null;
  operational_state?: string | null;
  created_at: string;
  contacted_at?: string | null;
  // notification_sent_at may not exist on every row; treat as optional.
  notification_sent_at?: string | null;
  counterparty_org_id?: string | null;
  counterparty_type?: string | null;
}

export interface OutreachLogRow {
  engagement_id: string;
  created_at: string;
  contact_method: string | null;
  new_status: string | null;
}

export interface DraftRow {
  engagement_id: string;
  status: "pending_review" | "approved" | "rejected" | string;
  created_at: string;
}

export interface QueueDerivedFields {
  queue_age_days: number;
  sla_due_at: string | null;
  sla_status: SlaStatus;
  last_outreach_at: string | null;
  last_outreach_channel: string | null;
  last_outreach_outcome: string | null;
  outreach_count: number;
  draft_status: "pending_review" | "approved" | "rejected" | null;
  approved_draft_available: boolean;
  manual_send_required: boolean;
  next_action_label: NextActionLabel;
  next_action_reason: string;
}

const TERMINAL_ACCEPTED = new Set(["accepted"]);
const TERMINAL_DECLINED = new Set(["declined", "expired", "cancelled"]);
const PENDING_INITIATOR_STATES = new Set([
  "notification_sent",
  "contacted",
  "pending",
]);

function parseIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * Pick the canonical "start" timestamp for SLA calculation.
 * Prefer notification_sent_at if present, otherwise contacted_at, otherwise created_at.
 */
function pickSlaStartMs(eng: QueueEngagementInput): number | null {
  return (
    parseIso(eng.notification_sent_at) ??
    parseIso(eng.contacted_at) ??
    parseIso(eng.created_at)
  );
}

/**
 * Aggregate outreach logs for ONE engagement.
 * Caller is responsible for filtering logs to this engagement_id.
 */
export function aggregateOutreach(logs: OutreachLogRow[]): {
  last_outreach_at: string | null;
  last_outreach_channel: string | null;
  last_outreach_outcome: string | null;
  outreach_count: number;
} {
  if (!logs.length) {
    return {
      last_outreach_at: null,
      last_outreach_channel: null,
      last_outreach_outcome: null,
      outreach_count: 0,
    };
  }
  // Latest by created_at — guard against unsorted input.
  let latest = logs[0];
  let latestMs = parseIso(latest.created_at) ?? -Infinity;
  for (let i = 1; i < logs.length; i++) {
    const ms = parseIso(logs[i].created_at) ?? -Infinity;
    if (ms > latestMs) {
      latest = logs[i];
      latestMs = ms;
    }
  }
  return {
    last_outreach_at: latest.created_at,
    last_outreach_channel: latest.contact_method ?? null,
    last_outreach_outcome: latest.new_status ?? null,
    outreach_count: logs.length,
  };
}

/**
 * Pick the latest draft for ONE engagement. Caller filters.
 */
export function latestDraft(drafts: DraftRow[]): DraftRow | null {
  if (!drafts.length) return null;
  let latest = drafts[0];
  let latestMs = parseIso(latest.created_at) ?? -Infinity;
  for (let i = 1; i < drafts.length; i++) {
    const ms = parseIso(drafts[i].created_at) ?? -Infinity;
    if (ms > latestMs) {
      latest = drafts[i];
      latestMs = ms;
    }
  }
  return latest;
}

/**
 * Compute SLA fields. Derived only.
 * - Terminal statuses (accepted/declined/expired/cancelled) → not_applicable.
 * - Otherwise compute due_at = start + thresholdHours, then bucket:
 *     overdue   : now >= due
 *     due_soon  : remaining <= thresholdHours/4 (e.g. last 12h of a 48h window)
 *     on_track  : everything else
 */
export function deriveSla(
  eng: QueueEngagementInput,
  thresholdHours: number,
  nowMs: number,
): { sla_due_at: string | null; sla_status: SlaStatus } {
  const status = eng.engagement_status ?? "";
  if (TERMINAL_ACCEPTED.has(status) || TERMINAL_DECLINED.has(status)) {
    return { sla_due_at: null, sla_status: "not_applicable" };
  }
  const startMs = pickSlaStartMs(eng);
  if (startMs === null) {
    return { sla_due_at: null, sla_status: "not_applicable" };
  }
  const hours = thresholdHours > 0 ? thresholdHours : SLA_DEFAULT_THRESHOLD_HOURS;
  const dueMs = startMs + hours * 3_600_000;
  const due_at = new Date(dueMs).toISOString();
  if (nowMs >= dueMs) return { sla_due_at: due_at, sla_status: "overdue" };
  const remainingMs = dueMs - nowMs;
  const warnMs = (hours * 3_600_000) / 4;
  if (remainingMs <= warnMs) return { sla_due_at: due_at, sla_status: "due_soon" };
  return { sla_due_at: due_at, sla_status: "on_track" };
}

/**
 * Compute queue_age_days as a non-negative integer (floor).
 */
export function deriveQueueAgeDays(eng: QueueEngagementInput, nowMs: number): number {
  const startMs = parseIso(eng.created_at);
  if (startMs === null) return 0;
  const days = Math.floor((nowMs - startMs) / 86_400_000);
  return days < 0 ? 0 : days;
}

interface NextActionInput {
  eng: QueueEngagementInput;
  sla: SlaStatus;
  outreachCount: number;
  draftStatus: "pending_review" | "approved" | "rejected" | null;
  orgEligible: boolean; // false ⇒ blocked_ineligible (frozen/suspended/etc.)
}

/**
 * Derive the next-action label + a short machine-readable reason string.
 * Order of precedence is deliberate; do not reorder casually.
 */
export function deriveNextAction(input: NextActionInput): {
  next_action_label: NextActionLabel;
  next_action_reason: string;
} {
  const { eng, sla, outreachCount, draftStatus, orgEligible } = input;
  const status = eng.engagement_status ?? "";
  const opState = eng.operational_state ?? null;

  if (!orgEligible) {
    return {
      next_action_label: "blocked_ineligible",
      next_action_reason: "initiator_org_not_eligible",
    };
  }

  if (
    opState === "binding_review_required" ||
    status === "binding_review_required"
  ) {
    return {
      next_action_label: "binding_review_required",
      next_action_reason: "operational_state_binding_review_required",
    };
  }

  if (status === "accepted") {
    return { next_action_label: "accepted", next_action_reason: "engagement_accepted" };
  }
  if (TERMINAL_DECLINED.has(status)) {
    return { next_action_label: "declined", next_action_reason: `engagement_${status}` };
  }

  if (sla === "overdue") {
    return { next_action_label: "overdue", next_action_reason: "sla_overdue" };
  }

  if (draftStatus === "approved") {
    return {
      next_action_label: "draft_approved_manual_send",
      next_action_reason: "draft_approved_awaiting_manual_send",
    };
  }
  if (draftStatus === "pending_review") {
    return {
      next_action_label: "draft_pending_review",
      next_action_reason: "draft_awaiting_admin_review",
    };
  }
  if (draftStatus === "rejected") {
    return {
      next_action_label: "draft_rejected",
      next_action_reason: "draft_rejected_needs_attention",
    };
  }

  if (outreachCount === 0) {
    return {
      next_action_label: "no_outreach_logged",
      next_action_reason: "no_outreach_attempt_recorded",
    };
  }

  if (status === "contacted") {
    return {
      next_action_label: "waiting_on_counterparty",
      next_action_reason: "contacted_awaiting_response",
    };
  }
  if (PENDING_INITIATOR_STATES.has(status)) {
    return {
      next_action_label: "waiting_on_initiator",
      next_action_reason: `status_${status}`,
    };
  }

  return {
    next_action_label: "needs_admin_action",
    next_action_reason: `unclassified_status_${status || "unknown"}`,
  };
}

export interface DeriveQueueFieldsArgs {
  engagement: QueueEngagementInput;
  outreachLogs: OutreachLogRow[]; // already filtered to this engagement
  drafts: DraftRow[]; // already filtered to this engagement
  thresholdHours?: number;
  nowMs?: number;
  orgEligible?: boolean;
}

/**
 * Compose all derived queue fields for one engagement.
 * Pure: no I/O, no DB calls, no fetches, no globals.
 */
export function deriveQueueFields(args: DeriveQueueFieldsArgs): QueueDerivedFields {
  const {
    engagement,
    outreachLogs,
    drafts,
    thresholdHours = SLA_DEFAULT_THRESHOLD_HOURS,
    nowMs = Date.now(),
    orgEligible = true,
  } = args;

  const queue_age_days = deriveQueueAgeDays(engagement, nowMs);
  const { sla_due_at, sla_status } = deriveSla(engagement, thresholdHours, nowMs);
  const outreach = aggregateOutreach(outreachLogs);

  const latest = latestDraft(drafts);
  const draft_status =
    latest && (latest.status === "pending_review" ||
               latest.status === "approved" ||
               latest.status === "rejected")
      ? (latest.status as "pending_review" | "approved" | "rejected")
      : null;
  const approved_draft_available = draft_status === "approved";
  const manual_send_required = approved_draft_available;

  const { next_action_label, next_action_reason } = deriveNextAction({
    eng: engagement,
    sla: sla_status,
    outreachCount: outreach.outreach_count,
    draftStatus: draft_status,
    orgEligible,
  });

  return {
    queue_age_days,
    sla_due_at,
    sla_status,
    last_outreach_at: outreach.last_outreach_at,
    last_outreach_channel: outreach.last_outreach_channel,
    last_outreach_outcome: outreach.last_outreach_outcome,
    outreach_count: outreach.outreach_count,
    draft_status,
    approved_draft_available,
    manual_send_required,
    next_action_label,
    next_action_reason,
  };
}
