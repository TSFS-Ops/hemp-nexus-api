/**
 * Batch B Phase 1.5 — direct-read-path migration tests.
 *
 * Phase 1.5 swept every direct `poi_engagements` read that previously
 * assumed UNIQUE(match_id) and routed it through the canonical
 * resolver. These tests pin the two behaviours that matter once Phase 2
 * drops that constraint:
 *
 *   1. The resolver-backed fetcher returns the renewed child as
 *      `current` and the expired parent as `latest_historical` —
 *      i.e. no read path silently picks "the first row PostgREST
 *      returned".
 *
 *   2. The DealPipeline-style grouping (multiple matches in one
 *      `.in("match_id", ids)` call) maps each match to the status of
 *      its own current engagement, NOT to whichever row was last
 *      iterated.
 */

import { describe, it, expect } from "vitest";
import {
  resolveEngagementReadModel,
  fetchEngagementReadModelByMatchId,
  type EngagementRow,
} from "@/lib/engagement-read-model";

const MATCH_A = "11111111-1111-1111-1111-111111111111";
const MATCH_B = "22222222-2222-2222-2222-222222222222";

function makeStubClient(rows: EngagementRow[]) {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, val: string) => ({
          order: async (_orderCol: string, _opts: { ascending: boolean }) => {
            const data = rows.filter((r) => r.match_id === val);
            return { data, error: null };
          },
        }),
      }),
    }),
  };
}

describe("fetchEngagementReadModelByMatchId — Phase 1.5", () => {
  it("returns renewed child as current and expired parent as latest_historical", async () => {
    const parent: EngagementRow = {
      id: "p",
      match_id: MATCH_A,
      engagement_status: "expired",
      created_at: "2026-04-01T00:00:00.000Z",
    };
    const child: EngagementRow = {
      id: "c",
      match_id: MATCH_A,
      engagement_status: "notification_sent",
      created_at: "2026-05-01T00:00:00.000Z",
      renewed_from_engagement_id: "p",
    };
    // PostgREST may return rows in either order; the resolver must not care.
    const client = makeStubClient([parent, child]);
    const out = await fetchEngagementReadModelByMatchId(client, MATCH_A);
    expect(out.error).toBeNull();
    expect(out.current?.id).toBe("c");
    expect(out.latest_historical?.id).toBe("p");
    expect(out.envelope.read_model).toBe("v1");
  });

  it("never elevates an expired-only match to current", async () => {
    const expired: EngagementRow = {
      id: "x",
      match_id: MATCH_A,
      engagement_status: "expired",
      created_at: "2026-05-01T00:00:00.000Z",
    };
    const client = makeStubClient([expired]);
    const out = await fetchEngagementReadModelByMatchId(client, MATCH_A);
    expect(out.current).toBeNull();
    expect(out.latest_historical?.id).toBe("x");
  });
});

describe("DealPipeline-style grouping — Phase 1.5", () => {
  it("maps each match_id to its own current-engagement status, not the last row iterated", () => {
    // Match A: expired parent + accepted child → lane should be 'accepted'.
    // Match B: single notification_sent row → lane should be 'notification_sent'.
    const rows: EngagementRow[] = [
      { id: "a-old", match_id: MATCH_A, engagement_status: "expired", created_at: "2026-04-01T00:00:00Z" },
      { id: "a-new", match_id: MATCH_A, engagement_status: "accepted", created_at: "2026-05-01T00:00:00Z" },
      { id: "b-only", match_id: MATCH_B, engagement_status: "notification_sent", created_at: "2026-05-02T00:00:00Z" },
    ];
    // Mirror the inline grouping used by DealPipeline.
    const grouped = new Map<string, EngagementRow[]>();
    for (const r of rows) {
      const arr = grouped.get(r.match_id) ?? [];
      arr.push(r);
      grouped.set(r.match_id, arr);
    }
    const statusByMatch = new Map<string, string>();
    for (const [matchId, group] of grouped) {
      const env = resolveEngagementReadModel(group);
      const picked = env.current_engagement ?? env.latest_historical_engagement;
      if (picked?.engagement_status) statusByMatch.set(matchId, picked.engagement_status);
    }
    expect(statusByMatch.get(MATCH_A)).toBe("accepted");
    expect(statusByMatch.get(MATCH_B)).toBe("notification_sent");
  });

  it("keeps an all-terminal match visible via latest_historical (sealed = accepted history still surfaces)", () => {
    const rows: EngagementRow[] = [
      { id: "x", match_id: MATCH_A, engagement_status: "declined", created_at: "2026-05-01T00:00:00Z" },
    ];
    const env = resolveEngagementReadModel(rows);
    expect(env.current_engagement).toBeNull();
    expect(env.latest_historical_engagement?.engagement_status).toBe("declined");
  });
});
