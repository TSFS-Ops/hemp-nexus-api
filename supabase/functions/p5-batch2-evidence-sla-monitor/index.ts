// P-5 Batch 2 — Stage 6 evidence SLA monitor (cron-only).
//
// Scans `p5_batch2_evidence_items` joined with `p5_batch2_kyc_records` and,
// for every open evidence row, evaluates the pure SLA rules engine (mirrored
// inline from src/lib/p5-batch2/sla-rules.ts) and the notification engine
// (mirrored inline from src/lib/p5-batch2/notifications.ts). For each
// produced action it:
//
//   - inserts a `p5_batch2_tasks` row, ignoring duplicates by the unique
//     `idempotency_key` constraint (true idempotency across reruns),
//   - writes an audit row to `audit_logs` (best-effort) tagged with the
//     trigger and rule code,
//   - emits a heartbeat row into `cron_heartbeats` for observability.
//
// Auth: x-internal-key (cron) only. No business rows are mutated. No live
// provider claims are ever produced — provider-dependent items get safe
// wording only.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-internal-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

const MS_DAY = 24 * 60 * 60 * 1000;
const MS_HOUR = 60 * 60 * 1000;

type SlaRuleCode =
  | "expiry_reminder_30d"
  | "expiry_reminder_14d"
  | "expiry_reminder_7d"
  | "missing_finality_48h"
  | "missing_non_finality_5wd"
  | "bank_change_second_review"
  | "provider_dependent_followup"
  | "high_risk_ubo_review";

interface SlaCase {
  evidence_item_id: string;
  record_id: string | null;
  organization_id: string | null;
  required_before_finality: boolean;
  is_missing_mandatory?: boolean;
  missing_since?: string | null;
  expiry_date?: string | null;
  bank_change_pending?: boolean;
  bank_change_submitted_at?: string | null;
  provider_dependent?: boolean;
  provider_last_followup_at?: string | null;
  high_risk_ubo?: boolean;
  high_risk_ubo_opened_at?: string | null;
  now: string;
}

interface SlaAction {
  rule_code: SlaRuleCode;
  reason: string;
  idempotency_key: string;
  days_to_expiry?: number;
}

function daysBetween(a: string, b: string): number {
  const aT = Date.parse(a);
  const bT = Date.parse(b);
  if (!Number.isFinite(aT) || !Number.isFinite(bT)) return NaN;
  return Math.floor((aT - bT) / MS_DAY);
}
function workingDaysBetween(from: string, to: string): number {
  const f = new Date(from);
  const t = new Date(to);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return NaN;
  let count = 0;
  const cur = new Date(f.getTime());
  while (cur.getTime() < t.getTime()) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}
function dayToken(iso: string): string {
  return iso.slice(0, 10);
}
function key(c: SlaCase, rule: SlaRuleCode, extra?: string): string {
  const parts = ["p5b2sla", rule, c.evidence_item_id, c.record_id ?? "no-rec"];
  if (extra) parts.push(extra);
  return parts.join(":");
}

function evaluate(c: SlaCase): SlaAction[] {
  const out: SlaAction[] = [];
  if (c.expiry_date) {
    const dte = daysBetween(c.expiry_date, c.now);
    if (Number.isFinite(dte)) {
      for (const t of [30, 14, 7] as const) {
        if (dte === t) {
          out.push({
            rule_code: `expiry_reminder_${t}d` as SlaRuleCode,
            reason: `expiry_in_${t}_days`,
            idempotency_key: key(c, `expiry_reminder_${t}d` as SlaRuleCode),
            days_to_expiry: t,
          });
        }
      }
    }
  }
  if (c.is_missing_mandatory && c.missing_since) {
    const h = (Date.parse(c.now) - Date.parse(c.missing_since)) / MS_HOUR;
    if (c.required_before_finality && h >= 48) {
      out.push({
        rule_code: "missing_finality_48h",
        reason: "mandatory_finality_missing_48h",
        idempotency_key: key(c, "missing_finality_48h", dayToken(c.now)),
      });
    }
    if (!c.required_before_finality) {
      const wd = workingDaysBetween(c.missing_since, c.now);
      if (Number.isFinite(wd) && wd >= 5) {
        out.push({
          rule_code: "missing_non_finality_5wd",
          reason: "mandatory_non_finality_missing_5wd",
          idempotency_key: key(c, "missing_non_finality_5wd", dayToken(c.now)),
        });
      }
    }
  }
  if (c.bank_change_pending && c.bank_change_submitted_at) {
    const h = (Date.parse(c.now) - Date.parse(c.bank_change_submitted_at)) / MS_HOUR;
    if (h >= 24) {
      out.push({
        rule_code: "bank_change_second_review",
        reason: "bank_change_awaiting_second_review",
        idempotency_key: key(c, "bank_change_second_review", dayToken(c.now)),
      });
    }
  }
  if (c.provider_dependent) {
    const last = c.provider_last_followup_at;
    const idleHrs = last
      ? (Date.parse(c.now) - Date.parse(last)) / MS_HOUR
      : Infinity;
    if (idleHrs >= 72) {
      out.push({
        rule_code: "provider_dependent_followup",
        reason: "provider_dependent_no_followup_72h",
        idempotency_key: key(c, "provider_dependent_followup", dayToken(c.now)),
      });
    }
  }
  if (c.high_risk_ubo && c.high_risk_ubo_opened_at) {
    const h = (Date.parse(c.now) - Date.parse(c.high_risk_ubo_opened_at)) / MS_HOUR;
    if (h >= 48) {
      out.push({
        rule_code: "high_risk_ubo_review",
        reason: "high_risk_ubo_review_pending_48h",
        idempotency_key: key(c, "high_risk_ubo_review", dayToken(c.now)),
      });
    }
  }
  return out;
}

// ── Safe wording catalogue (inlined SSOT from notifications.ts) ─────────────
const SAFE_BY_RULE: Record<SlaRuleCode, { trigger: string; safe: string; internal: string; severity: string; audience: string }> = {
  expiry_reminder_30d: {
    trigger: "evidence_expiring",
    safe: "A document on file will expire in 30 days. Please upload a current copy soon.",
    internal: "Evidence expiring in 30d — reminder bucket.",
    severity: "info",
    audience: "counterparty",
  },
  expiry_reminder_14d: {
    trigger: "evidence_expiring",
    safe: "A document on file will expire in 14 days. Please upload a current copy soon.",
    internal: "Evidence expiring in 14d — reminder bucket.",
    severity: "info",
    audience: "counterparty",
  },
  expiry_reminder_7d: {
    trigger: "evidence_expiring",
    safe: "A document on file will expire in 7 days. Please upload a current copy soon.",
    internal: "Evidence expiring in 7d — reminder bucket.",
    severity: "warning",
    audience: "counterparty",
  },
  missing_finality_48h: {
    trigger: "mandatory_evidence_missing",
    safe: "A required document is still missing. Please upload it to continue.",
    internal: "Mandatory finality-blocking evidence missing > 48h.",
    severity: "blocker",
    audience: "counterparty",
  },
  missing_non_finality_5wd: {
    trigger: "mandatory_evidence_missing",
    safe: "A required document is still missing. Please upload it to continue.",
    internal: "Mandatory non-finality evidence missing > 5 working days.",
    severity: "warning",
    audience: "counterparty",
  },
  bank_change_second_review: {
    trigger: "bank_details_changed",
    safe: "Bank details have been updated. They will be re-checked before any payment.",
    internal: "Bank change awaiting second review > 24h.",
    severity: "blocker",
    audience: "admin",
  },
  provider_dependent_followup: {
    trigger: "provider_dependent_evidence",
    safe: "An external check is pending for this document. We will continue review manually in the meantime.",
    internal: "Provider-dependent — no follow-up in 72h. Do not represent as live/verified.",
    severity: "warning",
    audience: "admin",
  },
  high_risk_ubo_review: {
    trigger: "high_risk_ubo_evidence",
    safe: "Additional review of ownership information is in progress.",
    internal: "High-risk UBO review pending > 48h.",
    severity: "critical_internal",
    audience: "compliance_owner",
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const internalKey = Deno.env.get("INTERNAL_CRON_KEY");
  const provided = req.headers.get("x-internal-key");
  if (!internalKey || provided !== internalKey) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const runId = crypto.randomUUID();
  const now = new Date().toISOString();

  let inserted = 0;
  let skipped = 0;
  let scanned = 0;

  try {
    const { data: rows, error } = await supabase
      .from("p5_batch2_evidence_items")
      .select(
        "id, record_id, status, requirement_level, expiry_date, provider_dependency, provider_live, last_provider_attempt_at, is_suspended, is_waived, supports",
      )
      .neq("status", "accepted")
      .neq("status", "replaced")
      .neq("status", "waived")
      .limit(2000);

    if (error) throw error;

    for (const r of rows ?? []) {
      scanned += 1;

      // Pull the parent record for org_id + high-risk flag (best-effort).
      const { data: rec } = await supabase
        .from("p5_batch2_kyc_records")
        .select("organization_id, is_high_risk")
        .eq("id", r.record_id)
        .maybeSingle();

      const requiredBeforeFinality =
        Array.isArray(r.supports) && r.supports.includes("finality");

      const sla: SlaCase = {
        evidence_item_id: r.id,
        record_id: r.record_id,
        organization_id: rec?.organization_id ?? null,
        required_before_finality: !!requiredBeforeFinality,
        is_missing_mandatory:
          r.requirement_level === "mandatory" &&
          (r.status === "missing" || r.status === "requested"),
        missing_since: null, // best-effort; field can be wired in a later batch
        expiry_date: r.expiry_date,
        provider_dependent: !!r.provider_dependency && !r.provider_live,
        provider_last_followup_at: r.last_provider_attempt_at,
        high_risk_ubo:
          !!rec?.is_high_risk &&
          Array.isArray(r.supports) &&
          r.supports.includes("ownership"),
        high_risk_ubo_opened_at: null,
        now,
      };

      const actions = evaluate(sla);
      for (const a of actions) {
        const meta = SAFE_BY_RULE[a.rule_code];
        const safeMsg =
          a.rule_code === "expiry_reminder_30d" ||
          a.rule_code === "expiry_reminder_14d" ||
          a.rule_code === "expiry_reminder_7d"
            ? meta.safe
            : meta.safe;

        const { error: insErr } = await supabase
          .from("p5_batch2_tasks")
          .insert({
            trigger: meta.trigger,
            audience: meta.audience,
            severity: meta.severity,
            idempotency_key: a.idempotency_key,
            safe_message: safeMsg,
            internal_message: meta.internal,
            evidence_item_id: r.id,
            record_id: r.record_id,
            organization_id: rec?.organization_id ?? null,
            audit_action: `p5b2.sla.${a.rule_code}`,
            source: "sla_monitor",
          });
        if (insErr) {
          // Idempotency conflict on the unique constraint is expected and counted.
          if ((insErr as { code?: string }).code === "23505") {
            skipped += 1;
          } else {
            console.error("[p5b2-sla] insert error", insErr);
          }
        } else {
          inserted += 1;
          await supabase.from("audit_logs").insert({
            action: `p5b2.sla.${a.rule_code}`,
            resource_type: "p5_batch2_evidence_item",
            resource_id: r.id,
            metadata: {
              run_id: runId,
              rule_code: a.rule_code,
              reason: a.reason,
              idempotency_key: a.idempotency_key,
            },
          }).then(() => {}, () => {});
        }
      }
    }

    await supabase
      .from("cron_heartbeats")
      .insert({
        job_name: "p5-batch2-evidence-sla-monitor",
        last_run_at: now,
        last_success_at: now,
        metadata: { scanned, inserted, skipped, run_id: runId },
      })
      .then(() => {}, () => {});

    return new Response(
      JSON.stringify({ ok: true, run_id: runId, scanned, inserted, skipped }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[p5b2-sla] error", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
