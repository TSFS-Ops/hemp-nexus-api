/**
 * Batch B Phase 1 — engagement read-model resolver tests.
 *
 * These tests pin the canonical selection rules that every consumer of
 * `GET /poi-engagements/by-match/:matchId` now depends on. They are the
 * regression guard for the Batch A failure pattern where the page
 * silently picked "the first row by_match returned" via `.maybeSingle()`.
 *
 * Forward-compatibility check: the resolver must already select the
 * renewed child as `current_engagement` and demote the expired parent to
 * history, even though the database does not yet allow multiple rows
 * per match (Phase 2 drops UNIQUE(match_id)). That way Phases 2/3 land
 * onto a UI that is already correct.
 */

import { describe, it, expect } from "vitest";
import {
  resolveEngagementReadModel,
  parseByMatchResponse,
  isHistoricalEngagement,
} from "@/lib/engagement-read-model";

const row = (overrides: Partial<Parameters<typeof resolveEngagementReadModel>[0][number]>) => ({
  id: overrides.id ?? crypto.randomUUID(),
  match_id: overrides.match_id ?? "11111111-1111-1111-1111-111111111111",
  engagement_status: overrides.engagement_status ?? "notification_sent",
  created_at: overrides.created_at ?? new Date().toISOString(),
  ...overrides,
});

describe("engagement read-model — Phase 1 selection rules", () => {
  it("returns an empty envelope when there are no rows", () => {
    const m = resolveEngagementReadModel([]);
    expect(m.current_engagement).toBeNull();
    expect(m.latest_historical_engagement).toBeNull();
    expect(m.history).toEqual([]);
    expect(m.read_model).toBe("v1");
  });

  it("treats a single active row as current and emits no history", () => {
    const only = row({ engagement_status: "contacted" });
    const m = resolveEngagementReadModel([only]);
    expect(m.current_engagement?.id).toBe(only.id);
    expect(m.latest_historical_engagement).toBeNull();
    expect(m.history).toEqual([]);
  });

  it("treats a single terminal row as latest_historical and never as current", () => {
    const only = row({ engagement_status: "expired" });
    const m = resolveEngagementReadModel([only]);
    expect(m.current_engagement).toBeNull();
    expect(m.latest_historical_engagement?.id).toBe(only.id);
    expect(m.history).toEqual([]);
  });

  it("selects the renewed child as current and shows the expired parent only as history", () => {
    const parent = row({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      engagement_status: "expired",
      created_at: "2026-04-01T00:00:00.000Z",
    });
    const child = row({
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      engagement_status: "notification_sent",
      created_at: "2026-05-01T00:00:00.000Z",
      renewed_from_engagement_id: parent.id,
    });
    const m = resolveEngagementReadModel([parent, child]);
    expect(m.current_engagement?.id).toBe(child.id);
    expect(m.latest_historical_engagement?.id).toBe(parent.id);
    // The historical row is surfaced via latest_historical_engagement,
    // never duplicated in history.
    expect(m.history).toEqual([]);
  });

  it("never elevates a declined row to current_engagement", () => {
    const declined = row({
      engagement_status: "declined",
      created_at: "2026-05-02T00:00:00.000Z",
    });
    const expired = row({
      engagement_status: "expired",
      created_at: "2026-05-01T00:00:00.000Z",
    });
    const m = resolveEngagementReadModel([expired, declined]);
    expect(m.current_engagement).toBeNull();
    expect(m.latest_historical_engagement?.id).toBe(declined.id);
    expect(m.history.map((r) => r.id)).toEqual([expired.id]);
  });

  it("classifies terminal vs active statuses correctly", () => {
    expect(isHistoricalEngagement({ engagement_status: "expired" })).toBe(true);
    expect(isHistoricalEngagement({ engagement_status: "declined" })).toBe(true);
    expect(isHistoricalEngagement({ engagement_status: "notification_sent" })).toBe(false);
    expect(isHistoricalEngagement({ engagement_status: "contacted" })).toBe(false);
    expect(isHistoricalEngagement({ engagement_status: "accepted" })).toBe(false);
    expect(
      isHistoricalEngagement({
        engagement_status: "late_acceptance_pending_initiator_reconfirmation",
      }),
    ).toBe(false);
  });
});

describe("parseByMatchResponse — backwards compatibility", () => {
  it("accepts the new envelope verbatim", () => {
    const child = row({ engagement_status: "contacted" });
    const m = parseByMatchResponse({
      current_engagement: child,
      latest_historical_engagement: null,
      history: [],
      read_model: "v1",
    });
    expect(m.current_engagement?.id).toBe(child.id);
    expect(m.read_model).toBe("v1");
  });

  it("upgrades the legacy { engagement } shape into the new envelope", () => {
    const legacy = row({ engagement_status: "notification_sent" });
    const m = parseByMatchResponse({ engagement: legacy });
    expect(m.current_engagement?.id).toBe(legacy.id);
    expect(m.history).toEqual([]);
  });

  it("treats { engagement: null } as no engagement", () => {
    const m = parseByMatchResponse({ engagement: null });
    expect(m.current_engagement).toBeNull();
    expect(m.latest_historical_engagement).toBeNull();
  });
});
