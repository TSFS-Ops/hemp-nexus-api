/**
 * P-5 Batch 1 — Stage 6 SLA rules engine.
 *
 * Pure, deterministic evaluator. Given a snapshot of a
 * `p5_governance_readiness_cases` row + `now`, returns the list of SLA
 * actions the monitor should take.
 *
 * No I/O. The monitor (edge function) is responsible for actually writing
 * audit events, notifications and status changes — and for idempotency.
 */
import type { P5ProviderStatus, P5ReasonCode, P5Status } from "./constants";

/** All SLA rule identifiers. Used as idempotency key prefixes too. */
export const P5_SLA_RULE_CODES = [
  "reviewer_unassigned_24h",
  "under_review_overdue_48h",
  "more_info_reminder_3wd",
  "more_info_escalate_7wd",
  "more_info_stale_14d",
  "hard_blocker_unresolved_2wd",
  "compliance_hold_unresolved_5wd",
  "provider_pending_24h",
  "provider_pending_72h_live",
  "immediate_provider_failed",
  "immediate_provider_conflict",
  "immediate_sanctions_pep",
  "immediate_bank_issue",
  "immediate_payment_anomaly",
  "immediate_duplicate_notification",
  "immediate_amount_mismatch",
  "immediate_audit_tamper",
  "dispute_rejection",
  "waiver_request",
  "override_request",
] as const;
export type P5SlaRuleCode = (typeof P5_SLA_RULE_CODES)[number];

export type P5SlaSeverity = "reminder" | "escalation" | "stale_block" | "critical_escalation";

export type P5NotificationOwnerRole =
  | "platform_admin"
  | "executive_approver"
  | "compliance_admin"
  | "operator_case_manager"
  | "developer_technical_admin"
  | "customer_entity_owner"
  | "funder_external_reviewer";

export interface P5SlaCaseSnapshot {
  id: string;
  readiness_status: P5Status;
  governance_status: P5Status;
  compliance_status: P5Status;
  status_changed_at: string | null;
  assigned_reviewer_id: string | null;
  owner_user_id: string | null;
  is_on_hold: boolean;
  hold_type: string | null;
  hold_applied_at?: string | null;
  is_escalated: boolean;
  provider_dependency: boolean;
  provider_status: P5ProviderStatus | null;
  provider_last_checked_at: string | null;
  /** Whether the case is currently linked to a live transaction or
   * funder-facing pack. The monitor sets this from match/programme joins. */
  affects_live_or_funder: boolean;
  hard_blocker_open_since?: string | null;
  more_info_requested_at?: string | null;
  /** True when an admin extension is currently active. */
  admin_extension_active?: boolean;
  /** Last response timestamp on the more-info loop. */
  more_info_last_response_at?: string | null;
  /** Reason codes currently on the case — drives immediate-escalation rules. */
  reason_codes: P5ReasonCode[];
  /** True if a dispute is open against a rejection. */
  dispute_open?: boolean;
  /** True if a waiver request is open. */
  waiver_requested?: boolean;
  /** True if an override request is open. */
  override_requested?: boolean;
}

export interface P5SlaAction {
  rule_code: P5SlaRuleCode;
  severity: P5SlaSeverity;
  /** Audit reason code recorded on the audit event row. */
  reason_code: P5ReasonCode;
  /** Where the notification should land. */
  notify_roles: P5NotificationOwnerRole[];
  /** Plain, customer/funder-safe message. Never contains forbidden wording. */
  message: string;
  /** Status transition to apply (if any). */
  status_change?: P5Status;
  /** Idempotency bucket. */
  bucket: "once" | "daily" | "per_event";
  /** Per-event idempotency token (for `bucket === "per_event"`). */
  event_token?: string;
}

const MS = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

/** Add `n` working days (Mon–Fri) to a date. Public holidays not modelled. */
export function addWorkingDays(from: Date, n: number): Date {
  const out = new Date(from.getTime());
  let added = 0;
  while (added < n) {
    out.setUTCDate(out.getUTCDate() + 1);
    const dow = out.getUTCDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return out;
}

function olderThanHours(ts: string | null | undefined, hours: number, now: Date): boolean {
  if (!ts) return false;
  const t = Date.parse(ts);
  return Number.isFinite(t) && now.getTime() - t >= hours * MS.hour;
}

function olderThanWorkingDays(
  ts: string | null | undefined,
  workingDays: number,
  now: Date,
): boolean {
  if (!ts) return false;
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return false;
  const threshold = addWorkingDays(new Date(t), workingDays);
  return now.getTime() >= threshold.getTime();
}

const IMMEDIATE_REASON_RULES: Array<{ reason: P5ReasonCode; rule: P5SlaRuleCode; message: string }> = [
  { reason: "provider_failed", rule: "immediate_provider_failed", message: "Provider result requires immediate review" },
  { reason: "provider_result_conflict", rule: "immediate_provider_conflict", message: "Provider result conflict — immediate review required" },
  { reason: "sanctions_pep_adverse_result_review", rule: "immediate_sanctions_pep", message: "Sanctions / PEP / adverse result requires immediate review" },
  { reason: "bank_detail_verification_issue", rule: "immediate_bank_issue", message: "Bank detail issue requires immediate review" },
  { reason: "payment_confirmation_issue", rule: "immediate_payment_anomaly", message: "Payment anomaly requires immediate review" },
  { reason: "duplicate_notification", rule: "immediate_duplicate_notification", message: "Duplicate notification requires immediate review" },
  { reason: "amount_currency_mismatch", rule: "immediate_amount_mismatch", message: "Amount / currency mismatch requires immediate review" },
  { reason: "audit_trail_issue", rule: "immediate_audit_tamper", message: "Audit / tamper issue requires immediate review" },
  { reason: "tamper_evidence_issue", rule: "immediate_audit_tamper", message: "Audit / tamper issue requires immediate review" },
];

/**
 * Evaluate every SLA rule against a case. Pure — same input → same output.
 */
export function evaluateSlaActions(
  c: P5SlaCaseSnapshot,
  now: Date = new Date(),
): P5SlaAction[] {
  const actions: P5SlaAction[] = [];

  // 1. Reviewer assignment — submitted without reviewer for >24h
  if (c.readiness_status === "submitted" && !c.assigned_reviewer_id) {
    if (olderThanHours(c.status_changed_at, 24, now)) {
      actions.push({
        rule_code: "reviewer_unassigned_24h",
        severity: "escalation",
        reason_code: "overdue_sla",
        notify_roles: ["platform_admin"],
        message: "No reviewer assigned for over 24 hours",
        bucket: "daily",
      });
    }
  }

  // 2. Under-review overdue >48h
  if (c.readiness_status === "under_review") {
    if (olderThanHours(c.status_changed_at, 48, now)) {
      actions.push({
        rule_code: "under_review_overdue_48h",
        severity: "escalation",
        reason_code: "overdue_sla",
        notify_roles: ["platform_admin"],
        message: "Under Review for over 48 hours — Overdue Review",
        bucket: "daily",
      });
    }
  }

  // 3. More-information-required loop
  if (c.readiness_status === "more_information_required") {
    const anchor = c.more_info_requested_at ?? c.status_changed_at;
    const lastResponse = c.more_info_last_response_at ?? null;
    const ref = lastResponse ?? anchor;
    if (olderThanWorkingDays(ref, 3, now)) {
      actions.push({
        rule_code: "more_info_reminder_3wd",
        severity: "reminder",
        reason_code: "manual_review_required",
        notify_roles: ["customer_entity_owner", "operator_case_manager"],
        message: "More Information Required — please respond when you can",
        bucket: "daily",
      });
    }
    if (olderThanWorkingDays(ref, 7, now)) {
      actions.push({
        rule_code: "more_info_escalate_7wd",
        severity: "escalation",
        reason_code: "overdue_sla",
        notify_roles: ["platform_admin", "operator_case_manager"],
        message: "More Information Required overdue for 7 working days",
        bucket: "daily",
      });
    }
    if (
      olderThanHours(ref, 14 * 24, now) &&
      !c.admin_extension_active
    ) {
      actions.push({
        rule_code: "more_info_stale_14d",
        severity: "stale_block",
        reason_code: "overdue_sla",
        notify_roles: ["platform_admin", "operator_case_manager"],
        message: "Case marked stale — outstanding information not received in 14 days",
        status_change: "blocked",
        bucket: "once",
      });
    }
  }

  // 4. Hard blocker unresolved >2 working days after owner assignment
  if (
    c.readiness_status === "blocked" &&
    c.hard_blocker_open_since &&
    olderThanWorkingDays(c.hard_blocker_open_since, 2, now)
  ) {
    actions.push({
      rule_code: "hard_blocker_unresolved_2wd",
      severity: "escalation",
      reason_code: "overdue_sla",
      notify_roles: ["platform_admin"],
      message: "Hard blocker unresolved for over 2 working days",
      bucket: "daily",
    });
  }

  // 5. Compliance hold unresolved >5 working days
  if (
    c.is_on_hold &&
    c.hold_type === "compliance" &&
    olderThanWorkingDays(c.hold_applied_at, 5, now)
  ) {
    actions.push({
      rule_code: "compliance_hold_unresolved_5wd",
      severity: "critical_escalation",
      reason_code: "overdue_sla",
      notify_roles: ["executive_approver", "compliance_admin"],
      message: "Critical Escalation — compliance hold unresolved for 5 working days",
      bucket: "daily",
    });
  }

  // 6. Provider pending / not_live / credentials_pending
  if (c.provider_dependency && c.provider_status) {
    const pendingStatuses: P5ProviderStatus[] = ["pending", "not_live", "credentials_pending", "timeout"];
    if (pendingStatuses.includes(c.provider_status)) {
      if (olderThanHours(c.provider_last_checked_at ?? c.status_changed_at, 24, now)) {
        actions.push({
          rule_code: "provider_pending_24h",
          severity: "reminder",
          reason_code: "provider_pending",
          notify_roles: ["developer_technical_admin", "operator_case_manager"],
          message: "Provider response outstanding for over 24 hours",
          bucket: "daily",
        });
      }
      if (
        c.affects_live_or_funder &&
        olderThanHours(c.provider_last_checked_at ?? c.status_changed_at, 72, now)
      ) {
        actions.push({
          rule_code: "provider_pending_72h_live",
          severity: "escalation",
          reason_code: "provider_pending",
          notify_roles: ["platform_admin"],
          message: "External confirmation pending for over 72 hours on a live or funder-facing item",
          bucket: "daily",
        });
      }
    }
  }

  // 7. Immediate reason-code-driven escalations
  for (const r of IMMEDIATE_REASON_RULES) {
    if (c.reason_codes.includes(r.reason)) {
      actions.push({
        rule_code: r.rule,
        severity: "critical_escalation",
        reason_code: r.reason,
        notify_roles: ["platform_admin", "compliance_admin"],
        message: r.message,
        bucket: "per_event",
        event_token: r.reason,
      });
    }
  }

  // 8. Disputes / waivers / overrides → Platform Admin + Executive Approver
  if (c.dispute_open) {
    actions.push({
      rule_code: "dispute_rejection",
      severity: "critical_escalation",
      reason_code: "disputed_decision",
      notify_roles: ["platform_admin", "executive_approver"],
      message: "Disputed rejection requires review",
      bucket: "per_event",
      event_token: "dispute",
    });
  }
  if (c.waiver_requested) {
    actions.push({
      rule_code: "waiver_request",
      severity: "critical_escalation",
      reason_code: "waiver_granted",
      notify_roles: ["platform_admin", "executive_approver"],
      message: "Waiver request requires review",
      bucket: "per_event",
      event_token: "waiver",
    });
  }
  if (c.override_requested) {
    actions.push({
      rule_code: "override_request",
      severity: "critical_escalation",
      reason_code: "override_approved",
      notify_roles: ["platform_admin", "executive_approver"],
      message: "Override request requires review",
      bucket: "per_event",
      event_token: "override",
    });
  }

  return actions;
}

/** Build a deterministic idempotency key for a given action on a case. */
export function buildIdempotencyKey(
  caseId: string,
  action: P5SlaAction,
  now: Date = new Date(),
): string {
  if (action.bucket === "daily") {
    const day = now.toISOString().slice(0, 10);
    return `p5_sla:${caseId}:${action.rule_code}:${day}`;
  }
  if (action.bucket === "per_event") {
    return `p5_sla:${caseId}:${action.rule_code}:${action.event_token ?? "default"}`;
  }
  return `p5_sla:${caseId}:${action.rule_code}:once`;
}
