/**
 * Batch C Phase 3A — unit tests for the progression guard.
 *
 * Scope (5a in the Phase 3A matrix):
 *  - Returns null/allowed when no challenge row exists.
 *  - Returns allowed when only terminal challenges exist
 *    (`outcome_recorded`, `withdrawn`, `admin_override_recorded`,
 *    `closed_no_action`) — the guard's `.in(["open","under_review"])`
 *    filter excludes them at query time.
 *  - Returns CHALLENGE_OPEN for `open` and `under_review`.
 *  - Match-id scoping: a challenge on match A must not block match B.
 *  - Fails closed if the underlying query errors.
 *  - challengeOpenResponse emits the locked canonical 409 shape.
 *
 * No network: a tiny fake Supabase client mimics the chained query
 * surface used by the guard (`.from().select().eq().in().order().limit().maybeSingle()`).
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertNoOpenChallenge,
  challengeOpenResponse,
} from "./challenge-progression-guard.ts";

type Row = { id: string; status: string; created_at: string; match_id: string };

function fakeClient(opts: {
  rows?: Row[];
  failWith?: string;
}) {
  const rows = opts.rows ?? [];
  return {
    from(_table: string) {
      let matchFilter: string | null = null;
      let allowedStatuses: string[] = [];
      const builder = {
        select(_cols: string) {
          return builder;
        },
        eq(col: string, val: string) {
          if (col === "match_id") matchFilter = val;
          return builder;
        },
        in(col: string, vals: string[]) {
          if (col === "status") allowedStatuses = vals;
          return builder;
        },
        order(_col: string, _opts: unknown) {
          return builder;
        },
        limit(_n: number) {
          return builder;
        },
        async maybeSingle() {
          if (opts.failWith) {
            return { data: null, error: { message: opts.failWith } };
          }
          const matched = rows.find(
            (r) =>
              r.match_id === matchFilter && allowedStatuses.includes(r.status),
          );
          return { data: matched ?? null, error: null };
        },
      };
      return builder;
    },
  };
}

Deno.test("guard: allows when no challenge row exists", async () => {
  const client = fakeClient({ rows: [] });
  const decision = await assertNoOpenChallenge(client, "match-A");
  assertEquals(decision.allowed, true);
});

Deno.test("guard: allows when only terminal challenges exist", async () => {
  // Terminal statuses are filtered out by the .in([...]) clause, so
  // maybeSingle() returns null — the guard treats that as allowed.
  const terminals = [
    "outcome_recorded",
    "withdrawn",
    "admin_override_recorded",
    "closed_no_action",
  ];
  for (const status of terminals) {
    const client = fakeClient({
      rows: [
        {
          id: `chal-${status}`,
          status,
          created_at: "2026-05-09T00:00:00Z",
          match_id: "match-A",
        },
      ],
    });
    const decision = await assertNoOpenChallenge(client, "match-A");
    assertEquals(
      decision.allowed,
      true,
      `terminal status ${status} must not block`,
    );
  }
});

Deno.test("guard: blocks with CHALLENGE_OPEN when status=open", async () => {
  const client = fakeClient({
    rows: [
      {
        id: "chal-1",
        status: "open",
        created_at: "2026-05-09T12:00:00Z",
        match_id: "match-A",
      },
    ],
  });
  const decision = await assertNoOpenChallenge(client, "match-A");
  assertEquals(decision.allowed, false);
  assertEquals(decision.code, "CHALLENGE_OPEN");
  assertEquals(decision.challengeId, "chal-1");
  assertEquals(decision.challengeStatus, "open");
  assertEquals(decision.raisedAt, "2026-05-09T12:00:00Z");
});

Deno.test("guard: blocks with CHALLENGE_OPEN when status=under_review", async () => {
  const client = fakeClient({
    rows: [
      {
        id: "chal-2",
        status: "under_review",
        created_at: "2026-05-09T13:00:00Z",
        match_id: "match-A",
      },
    ],
  });
  const decision = await assertNoOpenChallenge(client, "match-A");
  assertEquals(decision.allowed, false);
  assertEquals(decision.challengeStatus, "under_review");
});

Deno.test("guard: match-id scoped — open challenge on A does not block B", async () => {
  const client = fakeClient({
    rows: [
      {
        id: "chal-A",
        status: "open",
        created_at: "2026-05-09T14:00:00Z",
        match_id: "match-A",
      },
    ],
  });
  const decisionA = await assertNoOpenChallenge(client, "match-A");
  const decisionB = await assertNoOpenChallenge(client, "match-B");
  assertEquals(decisionA.allowed, false);
  assertEquals(decisionB.allowed, true);
});

Deno.test("guard: empty matchId is allowed (defensive no-op)", async () => {
  const client = fakeClient({ rows: [] });
  const decision = await assertNoOpenChallenge(client, "");
  assertEquals(decision.allowed, true);
});

Deno.test("guard: fails closed when DB query errors", async () => {
  const client = fakeClient({ failWith: "connection lost" });
  const decision = await assertNoOpenChallenge(client, "match-A");
  assertEquals(decision.allowed, false);
  assertEquals(decision.code, "CHALLENGE_OPEN");
  assertEquals(decision.challengeId, null);
});

Deno.test("challengeOpenResponse: emits locked canonical 409 shape", async () => {
  const decision = await assertNoOpenChallenge(
    fakeClient({
      rows: [
        {
          id: "chal-X",
          status: "open",
          created_at: "2026-05-09T15:00:00Z",
          match_id: "match-A",
        },
      ],
    }),
    "match-A",
  );
  const res = challengeOpenResponse(decision, {
    "Access-Control-Allow-Origin": "*",
  });
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error, "CHALLENGE_OPEN");
  assertEquals(body.code, "CHALLENGE_OPEN");
  assertEquals(body.challenge_id, "chal-X");
  assertEquals(body.challenge_status, "open");
  assertEquals(body.raised_at, "2026-05-09T15:00:00Z");
  assert(typeof body.message === "string" && body.message.length > 0);
});
