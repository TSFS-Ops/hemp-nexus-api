// src/lib/admin-facilitation-queue.ts
//
// Batch 2 - Queue UI Badges + Filters helpers (pure, display-only).
//
// HARD BOUNDARIES:
//   • No network calls. No DB calls. No mutation.
//   • Never references send/dispatch/email/SMS/WhatsApp/Resend/SMTP/Twilio/SendGrid.
//   • Consumes ONLY the read-only `queue_derived` payload produced by Batch 1
//     (supabase/functions/_shared/derive-admin-facilitation-queue-fields.ts).
//   • Does not mutate engagement_status or operational_state.

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

export interface QueueDerived {
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

/** Human-readable display labels for `next_action_label`. */
export const NEXT_ACTION_LABELS: Record<NextActionLabel, string> = {
  blocked_ineligible: "Blocked / ineligible",
  binding_review_required: "Binding review required",
  no_outreach_logged: "No outreach logged",
  draft_pending_review: "Draft pending review",
  draft_approved_manual_send: "Draft approved - manual send",
  draft_rejected: "Draft rejected",
  overdue: "Overdue",
  waiting_on_counterparty: "Waiting on counterparty",
  waiting_on_initiator: "Waiting on requesting org",
  accepted: "Accepted",
  declined: "Declined",
  needs_admin_action: "Needs admin action",
};

/** SLA chip labels for display. */
export const SLA_STATUS_LABELS: Record<SlaStatus, string> = {
  on_track: "SLA on track",
  due_soon: "Due soon",
  overdue: "Overdue",
  not_applicable: "",
};

/**
 * Priority ordering for visual sort. Lower index = more urgent.
 * Used only when an operator opts into priority sort.
 */
export const NEXT_ACTION_PRIORITY: NextActionLabel[] = [
  "blocked_ineligible",
  "binding_review_required",
  "overdue",
  "draft_approved_manual_send",
  "no_outreach_logged",
  "draft_pending_review",
  "draft_rejected",
  "waiting_on_counterparty",
  "waiting_on_initiator",
  "needs_admin_action",
  "accepted",
  "declined",
];

export function priorityIndex(label: NextActionLabel | undefined): number {
  if (!label) return NEXT_ACTION_PRIORITY.length;
  const idx = NEXT_ACTION_PRIORITY.indexOf(label);
  return idx < 0 ? NEXT_ACTION_PRIORITY.length : idx;
}

/** Stable tone classes for badges - clinical neutral palette. */
export type BadgeTone =
  | "neutral"
  | "info"
  | "amber"
  | "rose"
  | "emerald"
  | "slate";

export const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-slate-50 text-slate-700 border-slate-200",
  info: "bg-sky-50 text-sky-800 border-sky-200",
  amber: "bg-amber-50 text-amber-800 border-amber-300",
  rose: "bg-rose-50 text-rose-800 border-rose-300",
  emerald: "bg-emerald-50 text-emerald-800 border-emerald-200",
  slate: "bg-slate-100 text-slate-600 border-slate-300",
};

export function nextActionTone(label: NextActionLabel | undefined): BadgeTone {
  switch (label) {
    case "blocked_ineligible":
    case "overdue":
    case "draft_rejected":
      return "rose";
    case "binding_review_required":
    case "draft_approved_manual_send":
    case "no_outreach_logged":
      return "amber";
    case "draft_pending_review":
    case "waiting_on_counterparty":
    case "waiting_on_initiator":
    case "needs_admin_action":
      return "info";
    case "accepted":
      return "emerald";
    case "declined":
      return "slate";
    default:
      return "neutral";
  }
}

export function slaTone(status: SlaStatus): BadgeTone {
  if (status === "overdue") return "rose";
  if (status === "due_soon") return "amber";
  if (status === "on_track") return "emerald";
  return "neutral";
}

/** New additive filter values driven entirely by queue_derived. */
export type FacilitationFilterValue =
  | "needs_admin_action"
  | "no_outreach_logged"
  | "overdue"
  | "due_soon"
  | "draft_approved_manual_send"
  | "draft_pending_review"
  | "waiting_on_counterparty"
  | "waiting_on_initiator"
  | "blocked_ineligible_facilitation";

export const FACILITATION_FILTERS: ReadonlyArray<{
  value: FacilitationFilterValue;
  label: string;
}> = [
  { value: "needs_admin_action", label: "Needs admin action" },
  { value: "no_outreach_logged", label: "No outreach logged" },
  { value: "overdue", label: "Overdue" },
  { value: "due_soon", label: "Due soon" },
  { value: "draft_approved_manual_send", label: "Draft approved - manual send" },
  { value: "draft_pending_review", label: "Draft pending review" },
  { value: "waiting_on_counterparty", label: "Waiting on counterparty" },
  { value: "waiting_on_initiator", label: "Waiting on requesting org" },
  { value: "blocked_ineligible_facilitation", label: "Blocked / ineligible" },
];

export function isFacilitationFilter(v: string): v is FacilitationFilterValue {
  return FACILITATION_FILTERS.some((f) => f.value === v);
}

/**
 * Apply a facilitation filter purely against `queue_derived`. Returns true if
 * the row matches and should remain visible.
 */
export function matchesFacilitationFilter(
  filter: FacilitationFilterValue,
  qd: QueueDerived | null | undefined,
): boolean {
  if (!qd) return false;
  switch (filter) {
    case "needs_admin_action":
      return (
        qd.next_action_label === "needs_admin_action" ||
        qd.next_action_label === "no_outreach_logged" ||
        qd.next_action_label === "draft_rejected" ||
        qd.next_action_label === "overdue" ||
        qd.next_action_label === "binding_review_required"
      );
    case "no_outreach_logged":
      return qd.outreach_count === 0 && qd.next_action_label !== "accepted" &&
        qd.next_action_label !== "declined";
    case "overdue":
      return qd.sla_status === "overdue";
    case "due_soon":
      return qd.sla_status === "due_soon";
    case "draft_approved_manual_send":
      return qd.draft_status === "approved" && qd.manual_send_required === true;
    case "draft_pending_review":
      return qd.draft_status === "pending_review";
    case "waiting_on_counterparty":
      return qd.next_action_label === "waiting_on_counterparty";
    case "waiting_on_initiator":
      return qd.next_action_label === "waiting_on_initiator";
    case "blocked_ineligible_facilitation":
      return qd.next_action_label === "blocked_ineligible";
  }
}

/** Format relative age, e.g. "2 days ago". Stable, no locale surprises. */
export function relativeFromNow(iso: string | null, nowMs = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diffSec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (diffSec < 60) return "just now";
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} mo ago`;
  const y = Math.floor(mo / 12);
  return `${y} yr ago`;
}

/** Format an SLA due timestamp as a short human date. */
export function formatSlaDue(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
