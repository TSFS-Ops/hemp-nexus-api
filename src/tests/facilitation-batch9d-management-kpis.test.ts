/**
 * Batch 9D — Management dashboard KPI tiles.
 *
 * Pure unit tests over the derivation helpers (no DB, no edge fetch).
 * These pin:
 *  - avg first-review / first-contact / close compute correctly from anchors
 *  - missing source data returns null (honest "not available")
 *  - conversion rate includes accepted successful outcomes and excludes
 *    unsuccessful closures
 *  - breached-deadline breakdown groups by exact deadline-type code
 *
 * Batches 9A / 9B / 9C SSOTs are imported alongside to confirm they remain
 * intact (the dedicated tests for those batches still run independently).
 */
import { describe, it, expect } from "vitest";
import {
  avgHours,
  pct,
  isSuccessfulClosure,
  computeConversionRate,
  computeBreachedDeadlineBreakdown,
} from "@/lib/facilitation-management-derive";
import {
  SUCCESSFUL_FINAL_OUTCOMES,
  SUCCESSFUL_INTERNAL_STATUSES,
  // Batch 9A/9B/9C SSOT presence checks
  SENSITIVE_OUTCOMES_REQUIRING_REASON,
  POSITIVE_RESPONSE_REQUIRED_ACTIONS,
  REQUESTER_SAFE_NOTIFICATION_TRIGGERS,
} from "@/lib/facilitation-case-state";

const H = 36e5;
const iso = (ms: number) => new Date(ms).toISOString();

describe("Batch 9D — average-time KPIs", () => {
  it("computes average time to first review from created_at → first review event", () => {
    const t0 = Date.UTC(2026, 0, 1, 9, 0, 0);
    const rows = [
      { a: iso(t0), b: iso(t0 + 2 * H) },     // 2h
      { a: iso(t0), b: iso(t0 + 4 * H) },     // 4h
      { a: iso(t0), b: iso(t0 + 6 * H) },     // 6h
    ];
    expect(avgHours(rows)).toBe(4);
  });

  it("computes average time to first contact from created_at → first contact_at", () => {
    const t0 = Date.UTC(2026, 0, 1, 9, 0, 0);
    const rows = [
      { a: iso(t0), b: iso(t0 + 10 * H) },
      { a: iso(t0), b: iso(t0 + 20 * H) },
    ];
    expect(avgHours(rows)).toBe(15);
  });

  it("computes average time to close from created_at → closed_at", () => {
    const t0 = Date.UTC(2026, 0, 1, 9, 0, 0);
    const rows = [
      { a: iso(t0), b: iso(t0 + 24 * H) },
      { a: iso(t0), b: iso(t0 + 72 * H) },
    ];
    expect(avgHours(rows)).toBe(48);
  });

  it("returns null when no usable timestamp pairs exist (honest 'not available')", () => {
    expect(avgHours([])).toBeNull();
    expect(avgHours([{ a: null, b: null }, { a: "2026-01-01T00:00:00Z", b: null }])).toBeNull();
  });

  it("ignores negative diffs (clock skew) rather than guessing", () => {
    const t0 = Date.UTC(2026, 0, 1, 9, 0, 0);
    expect(avgHours([{ a: iso(t0 + H), b: iso(t0) }])).toBeNull();
  });
});

describe("Batch 9D — conversion rate", () => {
  it("treats accepted successful final_outcomes as successful", () => {
    for (const o of [...SUCCESSFUL_FINAL_OUTCOMES]) {
      expect(isSuccessfulClosure({ final_outcome: o, internal_status: "closed" })).toBe(true);
    }
  });

  it("treats accepted successful internal_statuses as successful", () => {
    for (const s of [...SUCCESSFUL_INTERNAL_STATUSES]) {
      expect(isSuccessfulClosure({ final_outcome: null, internal_status: s })).toBe(true);
    }
  });

  it("excludes unsuccessful closures from the numerator", () => {
    const closed = [
      { final_outcome: "converted_to_known_counterparty_poi", internal_status: "converted_to_known_counterparty_poi" },
      { final_outcome: "linked_to_existing_organisation", internal_status: "closed" },
      { final_outcome: "unable_to_contact", internal_status: "unable_to_proceed" },
      { final_outcome: "counterparty_declined", internal_status: "counterparty_declined" },
      { final_outcome: "blocked_by_compliance", internal_status: "blocked_by_compliance" },
      { final_outcome: "no_response", internal_status: "closed" },
    ];
    const r = computeConversionRate(closed);
    expect(r.numerator).toBe(2);
    expect(r.denominator).toBe(6);
    expect(r.rate_pct).toBeCloseTo(33.3, 1);
  });

  it("returns rate_pct null when no closed cases (honest)", () => {
    expect(computeConversionRate([]).rate_pct).toBeNull();
  });
});

describe("Batch 9D — breached deadline breakdown", () => {
  it("groups breached cases by exact deadline-type code", () => {
    const cases = [
      { is_overdue: true, overdue_reasons: ["owner_assignment_overdue", "initial_triage_overdue"] },
      { is_overdue: true, overdue_reasons: ["first_outreach_overdue"] },
      { is_overdue: true, overdue_reasons: ["first_outreach_overdue", "stale_no_activity"] },
      { is_overdue: false, overdue_reasons: ["compliance_review_overdue"] }, // excluded
      { is_overdue: true, overdue_reasons: [] },
    ];
    const items = computeBreachedDeadlineBreakdown(cases);
    const byCode = Object.fromEntries(items.map((i) => [i.deadline_type, i.count]));
    expect(byCode.first_outreach_overdue).toBe(2);
    expect(byCode.owner_assignment_overdue).toBe(1);
    expect(byCode.initial_triage_overdue).toBe(1);
    expect(byCode.stale_no_activity).toBe(1);
    expect(byCode.compliance_review_overdue).toBeUndefined();
    // Top item is most frequent
    expect(items[0].deadline_type).toBe("first_outreach_overdue");
  });

  it("returns empty list when no breached cases (honest)", () => {
    expect(computeBreachedDeadlineBreakdown([])).toEqual([]);
    expect(computeBreachedDeadlineBreakdown([{ is_overdue: false, overdue_reasons: ["any"] }])).toEqual([]);
  });

  it("pct_of_breached is denominated by breached-case count", () => {
    const cases = [
      { is_overdue: true, overdue_reasons: ["first_outreach_overdue"] },
      { is_overdue: true, overdue_reasons: ["first_outreach_overdue"] },
      { is_overdue: true, overdue_reasons: ["compliance_review_overdue"] },
      { is_overdue: true, overdue_reasons: ["compliance_review_overdue"] },
    ];
    const items = computeBreachedDeadlineBreakdown(cases);
    expect(items.find((i) => i.deadline_type === "first_outreach_overdue")?.pct_of_breached).toBe(50);
  });
});

describe("Batch 9D — pct helper", () => {
  it("returns null when denominator is 0 instead of NaN/Infinity", () => {
    expect(pct(0, 0)).toBeNull();
    expect(pct(1, 4)).toBe(25);
  });
});

describe("Batch 9D — prior batches remain intact", () => {
  it("Batch 9A sensitive-outcome set still present", () => {
    expect(SENSITIVE_OUTCOMES_REQUIRING_REASON.size).toBeGreaterThan(0);
  });
  it("Batch 9B positive-response actions still present", () => {
    expect(POSITIVE_RESPONSE_REQUIRED_ACTIONS.length).toBeGreaterThan(0);
  });
  it("Batch 9C requester-safe notification triggers still present", () => {
    expect(REQUESTER_SAFE_NOTIFICATION_TRIGGERS.length).toBeGreaterThan(0);
  });
});
