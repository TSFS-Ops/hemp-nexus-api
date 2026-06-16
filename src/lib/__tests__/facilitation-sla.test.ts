/**
 * Batch 7 — SLA helper unit tests (browser mirror).
 *
 * Covers:
 *   - business-hour calculation skips weekends and after-hours
 *   - overdue marking when due dates have passed
 *   - overdue clearing when status moves to terminal
 *   - dedupe reason-set is stable for unchanged inputs
 */
import { describe, it, expect } from "vitest";
import {
  addBusinessHours,
  addBusinessDays,
  OVERDUE_REASON_CODES,
} from "../facilitation-sla";

// Note: facilitation-sla.ts (browser) does not export computeSla — only the
// Deno SSOT does. We re-import the deterministic helpers here and rely on the
// drift guard (scripts/check-facilitation-sla-drift.mjs) to keep both files
// aligned. The overdue tests construct outputs by checking the deterministic
// addBusinessDays/Hours helpers.

describe("facilitation-sla business hours", () => {
  it("addBusinessHours skips weekend", () => {
    // Friday 16:00 UTC + 2 business hours ⇒ Monday 10:00 UTC
    const fri = new Date("2026-06-19T16:00:00Z");
    const r = addBusinessHours(fri, 2);
    expect(r.getUTCDay()).toBe(1); // Monday
    expect(r.getUTCHours()).toBe(10);
  });
  it("addBusinessDays skips weekend", () => {
    const fri = new Date("2026-06-19T09:00:00Z");
    const r = addBusinessDays(fri, 1);
    expect(r.getUTCDay()).toBe(1); // Mon
    expect(r.getUTCHours()).toBe(9);
  });
});

describe("facilitation-sla reason codes", () => {
  it("covers all 8 overdue reasons", () => {
    expect(OVERDUE_REASON_CODES.length).toBe(8);
  });
});

// Spot check computeSla via dynamic import of the Deno helper (logic mirror).
import {
  computeSla as serverComputeSla,
} from "../../../supabase/functions/_shared/facilitation-sla";

describe("computeSla overdue marking & clearing", () => {
  const base = {
    created_at: "2026-06-01T09:00:00Z",
    internal_status: "new" as const,
    case_owner_id: null as string | null,
    closed_at: null as string | null,
    info_request_requested_at: null,
    info_request_response_at: null,
    ready_for_contact_at: null,
    compliance_review_started_at: null,
    first_contact_attempt_at: null,
    latest_contact_attempt_at: null,
    latest_next_action_date: null,
    last_activity_at: "2026-06-01T09:00:00Z",
  };

  it("marks unassigned + stale + overdue triage when far in the past", () => {
    const out = serverComputeSla(base, new Date("2026-06-15T09:00:00Z"));
    expect(out.is_overdue).toBe(true);
    expect(out.overdue_reasons).toContain("owner_assignment_overdue");
    expect(out.overdue_reasons).toContain("initial_triage_overdue");
    expect(out.overdue_reasons).toContain("stale_no_activity");
  });

  it("clears overdue when case is terminal (closed)", () => {
    const closed = {
      ...base,
      internal_status: "closed",
      closed_at: "2026-06-02T09:00:00Z",
    };
    const out = serverComputeSla(closed, new Date("2026-06-15T09:00:00Z"));
    expect(out.is_overdue).toBe(false);
    expect(out.overdue_reasons).toEqual([]);
  });

  it("is deterministic for same inputs (dedupe-friendly)", () => {
    const now = new Date("2026-06-15T09:00:00Z");
    const a = serverComputeSla(base, now);
    const b = serverComputeSla(base, now);
    expect(a.overdue_reasons).toEqual(b.overdue_reasons);
  });
});
