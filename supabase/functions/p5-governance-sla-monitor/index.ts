// P-5 Batch 1 — Stage 6 SLA monitor.
//
// Scheduled scan of `p5_governance_readiness_cases`. For every open case
// the pure SLA rules engine (mirrored inline below from the shared
// src/lib/p5-governance/sla-rules.ts module) is evaluated. For each
// triggered action the monitor:
//
//   - inserts a notification_dispatches row (skipping if an idempotency
//     key already exists in the same bucket),
//   - inserts an immutable p5_governance_audit_events row with
//     actor_type='system' and metadata describing the rule + run_id,
//   - optionally applies a status change for the once-bucket 14-day
//     stale_block rule.
//
// Auth: x-internal-key (cron) only. Service-role client is used inside.
// Heartbeat: pg_cron invokes via public.cron_invoke(), which writes the
// `cron_heartbeats` row automatically.
//
// Idempotency: notification_dispatches.metadata->>'p5_sla_idempotency_key'
// is checked before insert. Per-day / per-event / once windows are
// derived from the rule's bucket.
//
// Safety:
//   - Never mutates trade / POI / WaD / billing / payment / business
//     decision rows.
//   - Only writes to: notification_dispatches, p5_governance_audit_events,
//     and (for stale_block) p5_governance_readiness_cases.readiness_status.
//   - All notification messages come from the pure SLA rules engine,
//     which only emits Stage 1 SSOT-allowed wording.

import { createClient } from "npm:@supabase/supabase-js@2";
import { webhookCorsHeaders } from "../_shared/cors.ts";

// Cron-only endpoint — no browser callers. webhookCorsHeaders() emits only
// `Vary: Origin` and never `Access-Control-Allow-Origin: *`.
const corsHeaders = webhookCorsHeaders();

const MS_HOUR = 60 * 60 * 1000;

type ProviderStatus =
  | "not_live" | "credentials_pending" | "pending" | "timeout"
  | "inconclusive" | "failed" | "passed" | "not_applicable";

type SlaCaseSnapshot = {
  id: string;
  readiness_status: string;
  governance_status: string;
  compliance_status: string;
  status_changed_at: string | null;
  assigned_reviewer_id: string | null;
  owner_user_id: string | null;
  is_on_hold: boolean;
  hold_type: string | null;
  hold_applied_at?: string | null;
  is_escalated: boolean;
  provider_dependency: boolean;
  provider_status: ProviderStatus | null;
  provider_last_checked_at: string | null;
  affects_live_or_funder: boolean;
  hard_blocker_open_since?: string | null;
  more_info_requested_at?: string | null;
  more_info_last_response_at?: string | null;
  admin_extension_active?: boolean;
  reason_codes: string[];
  dispute_open?: boolean;
  waiver_requested?: boolean;
  override_requested?: boolean;
};

type SlaAction = {
  rule_code: string;
  severity: "reminder" | "escalation" | "stale_block" | "critical_escalation";
  reason_code: string;
  notify_roles: string[];
  message: string;
  status_change?: string;
  bucket: "once" | "daily" | "per_event";
  event_token?: string;
};

function addWorkingDays(from: Date, n: number): Date {
  const out = new Date(from.getTime());
  let added = 0;
  while (added < n) {
    out.setUTCDate(out.getUTCDate() + 1);
    const dow = out.getUTCDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return out;
}
function olderThanHours(ts: string | null | undefined, h: number, now: Date): boolean {
  if (!ts) return false;
  const t = Date.parse(ts);
  return Number.isFinite(t) && now.getTime() - t >= h * MS_HOUR;
}
function olderThanWorkingDays(ts: string | null | undefined, wd: number, now: Date): boolean {
  if (!ts) return false;
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return false;
  return now.getTime() >= addWorkingDays(new Date(t), wd).getTime();
}

const IMMEDIATE: Array<{ reason: string; rule: string; message: string }> = [
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

function evaluate(c: SlaCaseSnapshot, now: Date): SlaAction[] {
  const out: SlaAction[] = [];
  if (c.readiness_status === "submitted" && !c.assigned_reviewer_id && olderThanHours(c.status_changed_at, 24, now)) {
    out.push({ rule_code: "reviewer_unassigned_24h", severity: "escalation", reason_code: "overdue_sla", notify_roles: ["platform_admin"], message: "No reviewer assigned for over 24 hours", bucket: "daily" });
  }
  if (c.readiness_status === "under_review" && olderThanHours(c.status_changed_at, 48, now)) {
    out.push({ rule_code: "under_review_overdue_48h", severity: "escalation", reason_code: "overdue_sla", notify_roles: ["platform_admin"], message: "Under Review for over 48 hours — Overdue Review", bucket: "daily" });
  }
  if (c.readiness_status === "more_information_required") {
    const ref = c.more_info_last_response_at ?? c.more_info_requested_at ?? c.status_changed_at;
    if (olderThanWorkingDays(ref, 3, now)) {
      out.push({ rule_code: "more_info_reminder_3wd", severity: "reminder", reason_code: "manual_review_required", notify_roles: ["customer_entity_owner", "operator_case_manager"], message: "More Information Required — please respond when you can", bucket: "daily" });
    }
    if (olderThanWorkingDays(ref, 7, now)) {
      out.push({ rule_code: "more_info_escalate_7wd", severity: "escalation", reason_code: "overdue_sla", notify_roles: ["platform_admin", "operator_case_manager"], message: "More Information Required overdue for 7 working days", bucket: "daily" });
    }
    if (olderThanHours(ref, 14 * 24, now) && !c.admin_extension_active) {
      out.push({ rule_code: "more_info_stale_14d", severity: "stale_block", reason_code: "overdue_sla", notify_roles: ["platform_admin", "operator_case_manager"], message: "Case marked stale — outstanding information not received in 14 days", status_change: "blocked", bucket: "once" });
    }
  }
  if (c.readiness_status === "blocked" && c.hard_blocker_open_since && olderThanWorkingDays(c.hard_blocker_open_since, 2, now)) {
    out.push({ rule_code: "hard_blocker_unresolved_2wd", severity: "escalation", reason_code: "overdue_sla", notify_roles: ["platform_admin"], message: "Hard blocker unresolved for over 2 working days", bucket: "daily" });
  }
  if (c.is_on_hold && c.hold_type === "compliance" && olderThanWorkingDays(c.hold_applied_at, 5, now)) {
    out.push({ rule_code: "compliance_hold_unresolved_5wd", severity: "critical_escalation", reason_code: "overdue_sla", notify_roles: ["executive_approver", "compliance_admin"], message: "Critical Escalation — compliance hold unresolved for 5 working days", bucket: "daily" });
  }
  if (c.provider_dependency && c.provider_status) {
    const pending: ProviderStatus[] = ["pending", "not_live", "credentials_pending", "timeout"];
    if (pending.includes(c.provider_status)) {
      const ref = c.provider_last_checked_at ?? c.status_changed_at;
      if (olderThanHours(ref, 24, now)) {
        out.push({ rule_code: "provider_pending_24h", severity: "reminder", reason_code: "provider_pending", notify_roles: ["developer_technical_admin", "operator_case_manager"], message: "Provider response outstanding for over 24 hours", bucket: "daily" });
      }
      if (c.affects_live_or_funder && olderThanHours(ref, 72, now)) {
        out.push({ rule_code: "provider_pending_72h_live", severity: "escalation", reason_code: "provider_pending", notify_roles: ["platform_admin"], message: "External confirmation pending for over 72 hours on a live or funder-facing item", bucket: "daily" });
      }
    }
  }
  for (const r of IMMEDIATE) {
    if (c.reason_codes.includes(r.reason)) {
      out.push({ rule_code: r.rule, severity: "critical_escalation", reason_code: r.reason, notify_roles: ["platform_admin", "compliance_admin"], message: r.message, bucket: "per_event", event_token: r.reason });
    }
  }
  if (c.dispute_open) out.push({ rule_code: "dispute_rejection", severity: "critical_escalation", reason_code: "disputed_decision", notify_roles: ["platform_admin", "executive_approver"], message: "Disputed rejection requires review", bucket: "per_event", event_token: "dispute" });
  if (c.waiver_requested) out.push({ rule_code: "waiver_request", severity: "critical_escalation", reason_code: "waiver_granted", notify_roles: ["platform_admin", "executive_approver"], message: "Waiver request requires review", bucket: "per_event", event_token: "waiver" });
  if (c.override_requested) out.push({ rule_code: "override_request", severity: "critical_escalation", reason_code: "override_approved", notify_roles: ["platform_admin", "executive_approver"], message: "Override request requires review", bucket: "per_event", event_token: "override" });
  return out;
}

function idempotencyKey(caseId: string, a: SlaAction, now: Date): string {
  if (a.bucket === "daily") return `p5_sla:${caseId}:${a.rule_code}:${now.toISOString().slice(0, 10)}`;
  if (a.bucket === "per_event") return `p5_sla:${caseId}:${a.rule_code}:${a.event_token ?? "default"}`;
  return `p5_sla:${caseId}:${a.rule_code}:once`;
}

// Open / non-terminal statuses worth scanning.
const OPEN_STATUSES = [
  "submitted", "under_review", "more_information_required",
  "internally_ready", "provider_dependent", "conditional_ready",
  "on_hold", "blocked", "escalated",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronKey = Deno.env.get("INTERNAL_CRON_KEY");
  const providedKey = req.headers.get("x-internal-key");
  if (!cronKey || providedKey !== cronKey) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const runId = crypto.randomUUID();
  const now = new Date();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const summary = {
    ok: true,
    run_id: runId,
    checked: 0,
    escalated: 0,
    reminded: 0,
    blocked: 0,
    notifications_created: 0,
    audit_events_created: 0,
    skipped_dupes: 0,
  };

  try {
    const { data: cases, error } = await supabase
      .from("p5_governance_readiness_cases")
      .select(
        "id, organization_id, entity_id, match_id, programme_id, readiness_status, governance_status, compliance_status, status_changed_at, assigned_reviewer_id, owner_user_id, is_on_hold, hold_type, hold_applied_at, is_escalated, provider_dependency, provider_status, provider_last_checked_at, hard_blocker_open_since, more_info_requested_at, more_info_last_response_at, admin_extension_active, reason_codes, dispute_open, waiver_requested, override_requested",
      )
      .in("readiness_status", OPEN_STATUSES)
      .limit(500);

    if (error) throw error;

    for (const row of cases ?? []) {
      summary.checked += 1;
      const snap: SlaCaseSnapshot = {
        id: row.id,
        readiness_status: row.readiness_status,
        governance_status: row.governance_status,
        compliance_status: row.compliance_status,
        status_changed_at: row.status_changed_at,
        assigned_reviewer_id: row.assigned_reviewer_id,
        owner_user_id: row.owner_user_id,
        is_on_hold: !!row.is_on_hold,
        hold_type: row.hold_type,
        hold_applied_at: row.hold_applied_at,
        is_escalated: !!row.is_escalated,
        provider_dependency: !!row.provider_dependency,
        provider_status: row.provider_status,
        provider_last_checked_at: row.provider_last_checked_at,
        affects_live_or_funder: !!row.match_id || !!row.programme_id,
        hard_blocker_open_since: row.hard_blocker_open_since,
        more_info_requested_at: row.more_info_requested_at,
        more_info_last_response_at: row.more_info_last_response_at,
        admin_extension_active: !!row.admin_extension_active,
        reason_codes: Array.isArray(row.reason_codes) ? row.reason_codes : [],
        dispute_open: !!row.dispute_open,
        waiver_requested: !!row.waiver_requested,
        override_requested: !!row.override_requested,
      };

      const actions = evaluate(snap, now);
      for (const action of actions) {
        const key = idempotencyKey(snap.id, action, now);

        // Idempotency: skip if a dispatch with this key already exists.
        const { data: existing } = await supabase
          .from("notification_dispatches")
          .select("id")
          .eq("reference_type", "p5_case")
          .eq("reference_id", snap.id)
          .eq("event_type", `p5.sla.${action.rule_code}`)
          .contains("metadata", { p5_sla_idempotency_key: key })
          .limit(1)
          .maybeSingle();

        if (existing) {
          summary.skipped_dupes += 1;
          continue;
        }

        // 1. Notification dispatch row per recipient role.
        for (const role of action.notify_roles) {
          const { error: nErr } = await supabase.from("notification_dispatches").insert({
            event_type: `p5.sla.${action.rule_code}`,
            reference_type: "p5_case",
            reference_id: snap.id,
            recipient_org_id: row.organization_id,
            recipient_role: role,
            channel: "in_app",
            status: "pending",
            template_name: `p5_sla_${action.rule_code}`,
            routing_policy_key: `p5_sla_${action.severity}`,
            metadata: {
              p5_sla_idempotency_key: key,
              p5_sla_rule_code: action.rule_code,
              p5_sla_severity: action.severity,
              p5_sla_run_id: runId,
              p5_sla_message: action.message,
              p5_sla_bucket: action.bucket,
            },
          });
          if (!nErr) summary.notifications_created += 1;
        }

        // 2. Status change (only stale_block).
        let newStatus: string | null = null;
        if (action.status_change) {
          const { error: uErr } = await supabase
            .from("p5_governance_readiness_cases")
            .update({
              readiness_status: action.status_change,
              status_changed_at: now.toISOString(),
              is_escalated: true,
              escalation_reason_code: action.reason_code,
              escalated_at: now.toISOString(),
            })
            .eq("id", snap.id);
          if (!uErr) {
            newStatus = action.status_change;
            summary.blocked += 1;
          }
        } else if (action.severity === "escalation" || action.severity === "critical_escalation") {
          await supabase
            .from("p5_governance_readiness_cases")
            .update({ is_escalated: true, escalation_reason_code: action.reason_code, escalated_at: now.toISOString() })
            .eq("id", snap.id);
          summary.escalated += 1;
        } else {
          summary.reminded += 1;
        }

        // 3. Immutable audit event.
        const { error: aErr } = await supabase.from("p5_governance_audit_events").insert({
          case_id: snap.id,
          event_type: `sla.${action.rule_code}`,
          actor_type: "system",
          actor_user_id: null,
          previous_status: snap.readiness_status,
          new_status: newStatus ?? snap.readiness_status,
          reason_code: action.reason_code,
          note: action.message,
          correlation_id: runId,
          metadata: {
            p5_sla_rule_code: action.rule_code,
            p5_sla_severity: action.severity,
            p5_sla_notify_roles: action.notify_roles,
            p5_sla_idempotency_key: key,
            p5_sla_bucket: action.bucket,
          },
        });
        if (!aErr) summary.audit_events_created += 1;
      }
    }

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ ...summary, ok: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
