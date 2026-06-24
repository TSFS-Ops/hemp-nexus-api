/**
 * P-5 Batch 2 — Stage 6: SLA rule engine.
 *
 * Pure. Given an open evidence item (or record-level signal) + `now`,
 * decide whether an SLA action should fire and what its idempotency
 * bucket is. Consumed by the `p5-batch2-evidence-sla-monitor` edge
 * function cron.
 */

export type P5B2SlaBucket = "once" | "daily" | "per_event";

export type P5B2SlaRuleCode =
  | "expiry_reminder_30d"
  | "expiry_reminder_14d"
  | "expiry_reminder_7d"
  | "missing_finality_48h"
  | "missing_non_finality_5wd"
  | "bank_change_second_review"
  | "provider_dependent_followup"
  | "high_risk_ubo_review";

export interface P5B2SlaCaseInput {
  evidence_item_id?: string | null;
  record_id?: string | null;
  organization_id?: string | null;
  /** Whether this requirement blocks finality. */
  required_before_finality: boolean;
  /** True for mandatory evidence currently missing. */
  is_missing_mandatory?: boolean;
  /** ISO timestamp when the "missing" state began. */
  missing_since?: string | null;
  /** ISO date for expiry, if any. */
  expiry_date?: string | null;
  /** True when the record participates in a bank-detail change pending re-approval. */
  bank_change_pending?: boolean;
  /** ISO timestamp when the bank change was submitted for re-review. */
  bank_change_submitted_at?: string | null;
  /** True for provider-dependent items still awaiting a real provider result. */
  provider_dependent?: boolean;
  /** ISO timestamp of last provider follow-up reminder. */
  provider_last_followup_at?: string | null;
  /** True for high-risk UBO chains awaiting compliance review. */
  high_risk_ubo?: boolean;
  high_risk_ubo_opened_at?: string | null;
  /** "now" — caller-supplied. */
  now: string;
}

export interface P5B2SlaAction {
  rule_code: P5B2SlaRuleCode;
  bucket: P5B2SlaBucket;
  idempotency_key: string;
  reason: string;
  /** Days-to-expiry where applicable (for downstream notification engine). */
  days_to_expiry?: number;
}

const MS_DAY = 24 * 60 * 60 * 1000;

function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return Math.floor((a - b) / MS_DAY);
}

function workingDaysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return Number.NaN;
  let count = 0;
  const cur = new Date(from.getTime());
  while (cur.getTime() < to.getTime()) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

function bucketDayToken(iso: string): string {
  return iso.slice(0, 10);
}

function keyFor(
  input: P5B2SlaCaseInput,
  rule: P5B2SlaRuleCode,
  extra?: string,
): string {
  const parts = [
    "p5b2sla",
    rule,
    input.evidence_item_id ?? "no-evi",
    input.record_id ?? "no-rec",
  ];
  if (extra) parts.push(extra);
  return parts.join(":");
}

export function evaluateP5B2Sla(input: P5B2SlaCaseInput): P5B2SlaAction[] {
  const out: P5B2SlaAction[] = [];

  // ── Expiry reminders ────────────────────────────────────────────────
  if (input.expiry_date) {
    const dte = daysBetween(input.expiry_date, input.now);
    if (Number.isFinite(dte)) {
      for (const threshold of [30, 14, 7] as const) {
        if (dte === threshold) {
          out.push({
            rule_code: `expiry_reminder_${threshold}d` as P5B2SlaRuleCode,
            bucket: "once",
            idempotency_key: keyFor(input, `expiry_reminder_${threshold}d` as P5B2SlaRuleCode),
            reason: `expiry_in_${threshold}_days`,
            days_to_expiry: threshold,
          });
        }
      }
    }
  }

  // ── Missing escalations ─────────────────────────────────────────────
  if (input.is_missing_mandatory && input.missing_since) {
    const hours = (Date.parse(input.now) - Date.parse(input.missing_since)) / (60 * 60 * 1000);
    if (input.required_before_finality && hours >= 48) {
      out.push({
        rule_code: "missing_finality_48h",
        bucket: "daily",
        idempotency_key: keyFor(input, "missing_finality_48h", bucketDayToken(input.now)),
        reason: "mandatory_finality_missing_48h",
      });
    }
    if (!input.required_before_finality) {
      const wd = workingDaysBetween(input.missing_since, input.now);
      if (Number.isFinite(wd) && wd >= 5) {
        out.push({
          rule_code: "missing_non_finality_5wd",
          bucket: "daily",
          idempotency_key: keyFor(input, "missing_non_finality_5wd", bucketDayToken(input.now)),
          reason: "mandatory_non_finality_missing_5wd",
        });
      }
    }
  }

  // ── Bank change second review ───────────────────────────────────────
  if (input.bank_change_pending && input.bank_change_submitted_at) {
    const hours =
      (Date.parse(input.now) - Date.parse(input.bank_change_submitted_at)) / (60 * 60 * 1000);
    if (hours >= 24) {
      out.push({
        rule_code: "bank_change_second_review",
        bucket: "daily",
        idempotency_key: keyFor(input, "bank_change_second_review", bucketDayToken(input.now)),
        reason: "bank_change_awaiting_second_review",
      });
    }
  }

  // ── Provider-dependent follow-up ────────────────────────────────────
  if (input.provider_dependent) {
    const last = input.provider_last_followup_at;
    const idle = last
      ? (Date.parse(input.now) - Date.parse(last)) / (60 * 60 * 1000)
      : Infinity;
    if (idle >= 72) {
      out.push({
        rule_code: "provider_dependent_followup",
        bucket: "daily",
        idempotency_key: keyFor(input, "provider_dependent_followup", bucketDayToken(input.now)),
        reason: "provider_dependent_no_followup_72h",
      });
    }
  }

  // ── High-risk UBO review ────────────────────────────────────────────
  if (input.high_risk_ubo && input.high_risk_ubo_opened_at) {
    const hours =
      (Date.parse(input.now) - Date.parse(input.high_risk_ubo_opened_at)) / (60 * 60 * 1000);
    if (hours >= 48) {
      out.push({
        rule_code: "high_risk_ubo_review",
        bucket: "daily",
        idempotency_key: keyFor(input, "high_risk_ubo_review", bucketDayToken(input.now)),
        reason: "high_risk_ubo_review_pending_48h",
      });
    }
  }

  return out;
}
