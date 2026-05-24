/**
 * D-05 Regression — Engagement enum parity (T-04).
 *
 * Verifies that the canonical pre-acceptance state set
 * (`ENGAGEMENT_PENDING_STATES`) is honoured by `isEngagementPending`,
 * that legacy `'pending'` rows are still surfaced defensively, and that
 * terminal states are excluded from the pending/admin-action view.
 *
 * Pass criteria:
 *   • notification_sent and contacted rows ARE included in the pending view.
 *   • accepted, declined, expired rows are NOT included in the pending view.
 *   • The legacy 'pending' literal is still treated as pending so any
 *     historical row is never silently hidden.
 *   • The canonical pending set has not silently drifted to depend on
 *     'pending' alone (the original D-05 defect).
 *   • Counts derived via `isEngagementPending` match a hand-rolled
 *     reference filter over the same fixture.
 */

import { describe, it, expect } from "vitest";
import {
  ENGAGEMENT_PENDING_STATES,
  ENGAGEMENT_TERMINAL_STATES,
  LEGACY_PENDING_STATE,
  isEngagementPending,
  isEngagementTerminal,
} from "@/lib/engagement-state";

type Row = { id: string; engagement_status: string };

const fixture: Row[] = [
  // 7 notification_sent (mirrors live DB at 2026-05-03)
  ...Array.from({ length: 7 }, (_, i) => ({ id: `n${i}`, engagement_status: "notification_sent" })),
  // 6 contacted
  ...Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, engagement_status: "contacted" })),
  // 44 accepted, 1 declined, 7 expired (terminal)
  ...Array.from({ length: 44 }, (_, i) => ({ id: `a${i}`, engagement_status: "accepted" })),
  { id: "d0", engagement_status: "declined" },
  ...Array.from({ length: 7 }, (_, i) => ({ id: `e${i}`, engagement_status: "expired" })),
  // One legacy 'pending' row to prove defensive handling
  { id: "legacy0", engagement_status: "pending" },
];

describe("D-05 — engagement enum parity", () => {
  it("canonical pending set is exactly notification_sent + contacted", () => {
    expect([...ENGAGEMENT_PENDING_STATES].sort()).toEqual(
      ["contacted", "notification_sent"].sort()
    );
  });

  it("does NOT depend on 'pending' alone for pre-acceptance logic (the original D-05 defect)", () => {
    // The canonical set must not contain 'pending'.
    expect((ENGAGEMENT_PENDING_STATES as readonly string[]).includes("pending")).toBe(false);
  });

  it("includes notification_sent rows in the pending view", () => {
    const row = { id: "x", engagement_status: "notification_sent" };
    expect(isEngagementPending(row.engagement_status)).toBe(true);
  });

  it("includes contacted rows in the pending view", () => {
    const row = { id: "x", engagement_status: "contacted" };
    expect(isEngagementPending(row.engagement_status)).toBe(true);
  });

  it("excludes accepted / declined / expired rows from the pending view", () => {
    for (const s of ENGAGEMENT_TERMINAL_STATES) {
      expect(isEngagementPending(s)).toBe(false);
      expect(isEngagementTerminal(s)).toBe(true);
    }
  });

  it("treats legacy 'pending' literal as pending defensively (never hide historical rows)", () => {
    expect(isEngagementPending(LEGACY_PENDING_STATE)).toBe(true);
  });

  it("UI count matches the database count for notification_sent + contacted (T-04 parity)", () => {
    const dbPendingCount = fixture.filter((r) =>
      ["notification_sent", "contacted"].includes(r.engagement_status)
    ).length;
    const uiPendingCount = fixture.filter((r) => isEngagementPending(r.engagement_status)).length;
    // UI count includes the legacy 'pending' row defensively (+1).
    expect(uiPendingCount).toBe(dbPendingCount + 1);
    expect(dbPendingCount).toBe(13); // 7 notification_sent + 6 contacted (live snapshot)
  });

  it("handles null/undefined/empty status without throwing or counting", () => {
    expect(isEngagementPending(null)).toBe(false);
    expect(isEngagementPending(undefined)).toBe(false);
    expect(isEngagementPending("")).toBe(false);
    expect(isEngagementTerminal(null)).toBe(false);
  });

  it("snapshot guard: terminal set is exactly accepted/declined/expired/cancelled_email_change", () => {
    // CP-015: cancelled_email_change is a terminal state when an engagement
    // is cancelled-or-superseded because the counterparty email was changed.
    expect([...ENGAGEMENT_TERMINAL_STATES].sort()).toEqual(
      ["accepted", "cancelled_email_change", "declined", "expired"].sort()
    );
  });

});
