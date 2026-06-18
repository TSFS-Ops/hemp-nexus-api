/**
 * Pure derivation helpers for Batch 9D management KPIs.
 *
 * These are deterministic, no I/O — used by the edge function
 * (mirrored inline there for Deno) and by unit tests.
 */
import {
  SUCCESSFUL_FINAL_OUTCOMES,
  SUCCESSFUL_INTERNAL_STATUSES,
  type FacilitationOutcome,
  type FacilitationInternalStatus,
} from "@/lib/facilitation-case-state";
import { OVERDUE_REASON_CODES, type OverdueReasonCode } from "@/lib/facilitation-sla";

const HOUR_MS = 36e5;

/** Average hours (1-decimal); null if no usable pair. */
export function avgHours(
  rows: { a: string | null; b: string | null }[],
): number | null {
  const diffs: number[] = [];
  for (const { a, b } of rows) {
    if (!a || !b) continue;
    const d = new Date(b).getTime() - new Date(a).getTime();
    if (isFinite(d) && d >= 0) diffs.push(d / HOUR_MS);
  }
  if (diffs.length === 0) return null;
  return Math.round((diffs.reduce((s, x) => s + x, 0) / diffs.length) * 10) / 10;
}

/** percentage 0..100, 1-decimal; null when denominator is 0. */
export function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export interface ClosedCaseRow {
  final_outcome: FacilitationOutcome | string | null;
  internal_status: FacilitationInternalStatus | string | null;
}

/** Successful = final_outcome OR internal_status is in the accepted set. */
export function isSuccessfulClosure(c: ClosedCaseRow): boolean {
  if (c.final_outcome && (SUCCESSFUL_FINAL_OUTCOMES as ReadonlySet<string>).has(c.final_outcome)) return true;
  if (c.internal_status && (SUCCESSFUL_INTERNAL_STATUSES as ReadonlySet<string>).has(c.internal_status)) return true;
  return false;
}

export interface ConversionRateResult {
  numerator: number;
  denominator: number;
  rate_pct: number | null;
}

/** Successful closed cases / total closed cases (denominator excludes still-open). */
export function computeConversionRate(closed: ClosedCaseRow[]): ConversionRateResult {
  const denominator = closed.length;
  const numerator = closed.filter(isSuccessfulClosure).length;
  return { numerator, denominator, rate_pct: pct(numerator, denominator) };
}

export interface BreachedBreakdownItem {
  deadline_type: OverdueReasonCode;
  count: number;
  pct_of_breached: number | null;
}

/**
 * Group breached cases by the exact missed deadline type (overdue_reasons[]).
 * Only cases with is_overdue=true are counted. A case with N reasons
 * increments each of those N buckets.
 */
export function computeBreachedDeadlineBreakdown(
  cases: { is_overdue?: boolean | null; overdue_reasons?: string[] | null }[],
): BreachedBreakdownItem[] {
  const breached = cases.filter((c) => c.is_overdue === true);
  const breachedCount = breached.length;
  const counts = new Map<OverdueReasonCode, number>();
  for (const code of OVERDUE_REASON_CODES) counts.set(code, 0);
  for (const c of breached) {
    const reasons = Array.isArray(c.overdue_reasons) ? c.overdue_reasons : [];
    for (const r of reasons) {
      if ((OVERDUE_REASON_CODES as readonly string[]).includes(r)) {
        const code = r as OverdueReasonCode;
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([deadline_type, count]) => ({
      deadline_type,
      count,
      pct_of_breached: pct(count, breachedCount),
    }));
}
