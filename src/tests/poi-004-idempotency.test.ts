/**
 * POI-004 — Generate POI idempotency regression suite.
 *
 * Source-pin tests (no live HTTP). Each `describe` block maps 1:1 to one of
 * the five scenarios in the POI-004 brief. We assert that the structural
 * guards which make those scenarios safe still exist in the codebase, so a
 * future refactor that silently weakens them fails CI.
 *
 *   1. Two concurrent generate-poi calls, DIFFERENT Idempotency-Keys
 *      → at most one POI mint, one burn, one ledger row, one audit row.
 *
 *   2. Two concurrent generate-poi calls, SAME Idempotency-Key
 *      → first processes, second is a replay (no duplicate burn / rows).
 *
 *   3. Network-loss style retry with a NEW key after the first request
 *      already succeeded server-side → idempotent current-state response,
 *      no second burn / duplicate POI / duplicate audit row.
 *
 *   4. Frontend rapid double-click → guardRef collapses to one API call;
 *      backend still safe even if two calls are forced through.
 *
 *   5. Soft-route Pending Engagement duplicate → exactly one
 *      poi_engagements row, second request handled gracefully (not 500).
 *
 * The runtime, on-Postgres proof for these guards lives in:
 *   - supabase/functions/match/e2e_soft_route_test.ts (concurrent soft-route)
 *   - supabase/migrations/20260514210537_*_poi-004 partial unique indexes
 *   - DB function atomic_generate_poi_v2 (SELECT ... FOR UPDATE + state check)
 *
 * This file is the cheap, always-on companion that catches the regression
 * BEFORE the migration / e2e job has to.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// ────────────────────────────────────────────────────────────────────────
// File loaders
// ────────────────────────────────────────────────────────────────────────

const MATCH_EDGE = readFileSync(
  resolve("supabase/functions/match/index.ts"),
  "utf8",
);
const USE_ASYNC_ACTION = readFileSync(
  resolve("src/hooks/use-async-action.ts"),
  "utf8",
);
const STATE_PROGRESSION = readFileSync(
  resolve("src/components/match/StateProgressionCard.tsx"),
  "utf8",
);
const USE_MATCH_DETAILS = readFileSync(
  resolve("src/hooks/use-match-details.ts"),
  "utf8",
);

function loadMigration(predicate: (sql: string) => boolean): string {
  const dir = resolve("supabase/migrations");
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".sql")) continue;
    const sql = readFileSync(resolve(dir, f), "utf8");
    if (predicate(sql)) return sql;
  }
  throw new Error("POI-004 partial-unique-index migration not found");
}

const POI_004_MIGRATION = loadMigration(
  (sql) =>
    sql.includes("uq_ledger_events_poi_minted_per_match") &&
    sql.includes("uq_token_ledger_declare_intent_per_match"),
);

// ────────────────────────────────────────────────────────────────────────
// Scenario 1 — concurrent calls, DIFFERENT idempotency keys
// ────────────────────────────────────────────────────────────────────────

describe("POI-004 #1 — concurrent calls, different Idempotency-Keys", () => {
  it("DB has UNIQUE partial index on ledger_events for poi.minted per match", () => {
    expect(POI_004_MIGRATION).toMatch(
      /CREATE\s+UNIQUE\s+INDEX[\s\S]*uq_ledger_events_poi_minted_per_match[\s\S]*ON\s+public\.ledger_events\s*\(\s*match_id\s*\)\s*WHERE\s+event_type\s*=\s*'poi\.minted'/i,
    );
  });

  it("DB has UNIQUE partial index on token_ledger for declare_intent burn per match", () => {
    expect(POI_004_MIGRATION).toMatch(
      /CREATE\s+UNIQUE\s+INDEX[\s\S]*uq_token_ledger_declare_intent_per_match[\s\S]*ON\s+public\.token_ledger\s*\(\s*\(metadata->>'match_id'\)\s*\)/i,
    );
    expect(POI_004_MIGRATION).toMatch(/outcome\s*=\s*'allowed'/i);
  });

  it("Edge function returns the current match idempotently when state is past discovery", () => {
    expect(MATCH_EDGE).toMatch(
      /POI already generated - returning idempotently/,
    );
    expect(MATCH_EDGE).toContain(
      "['intent_declared', 'counterparty_sighted', 'committed', 'completed'].includes(currentState)",
    );
  });

  it("Edge function delegates the actual mint to the row-locked DB function", () => {
    expect(MATCH_EDGE).toMatch(/'atomic_generate_poi_v2'/);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Scenario 2 — concurrent calls, SAME Idempotency-Key
// ────────────────────────────────────────────────────────────────────────

describe("POI-004 #2 — concurrent calls, same Idempotency-Key", () => {
  it("Edge function HARD-REQUIRES the Idempotency-Key header (400 otherwise)", () => {
    expect(MATCH_EDGE).toMatch(/Idempotency-Key header is required/);
    expect(MATCH_EDGE).toMatch(/throw new ApiException\("VALIDATION_ERROR"/);
  });

  it("Edge function looks up a cached response BEFORE any state change", () => {
    const lookupIdx = MATCH_EDGE.indexOf("lookupIdempotentResponse");
    const rpcIdx = MATCH_EDGE.indexOf("'atomic_generate_poi_v2'");
    expect(lookupIdx).toBeGreaterThan(0);
    expect(rpcIdx).toBeGreaterThan(0);
    expect(lookupIdx).toBeLessThan(rpcIdx);
    expect(MATCH_EDGE).toMatch(/cachedResponseToHttp/);
    expect(MATCH_EDGE).toMatch(/Idempotent replay hit/);
  });

  it("Edge function persists the successful response under the Idempotency-Key", () => {
    expect(MATCH_EDGE).toMatch(/storeIdempotentResponse/);
    expect(MATCH_EDGE).toMatch(/Cache successful response/i);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Scenario 3 — network-loss retry with a NEW key
// ────────────────────────────────────────────────────────────────────────

describe("POI-004 #3 — retry with new key after server-side success", () => {
  it("Edge function returns 200 + current match when state is no longer 'discovery'", () => {
    expect(MATCH_EDGE).toMatch(/POI already generated - returning idempotently/);
  });

  it("Strict state guard rejects only when state is something other than discovery AND not already-minted", () => {
    expect(MATCH_EDGE).toMatch(
      /Cannot generate POI from state '\$\{currentState\}'\. Must be in 'discovery' state\./,
    );
    expect(MATCH_EDGE).toMatch(/"INVALID_STATE"/);
  });

  it("Structural backstops still apply on retry path (mint + burn unique indexes)", () => {
    expect(POI_004_MIGRATION).toMatch(/uq_ledger_events_poi_minted_per_match/);
    expect(POI_004_MIGRATION).toMatch(/uq_token_ledger_declare_intent_per_match/);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Scenario 4 — frontend rapid double-click
// ────────────────────────────────────────────────────────────────────────

describe("POI-004 #4 — frontend rapid double-click guard", () => {
  it("useAsyncAction uses a useRef-based guard that survives re-renders", () => {
    expect(USE_ASYNC_ACTION).toMatch(/guardRef\s*=\s*useRef\(false\)/);
    expect(USE_ASYNC_ACTION).toMatch(/if\s*\(guardRef\.current\)\s*return/);
  });

  it("useAsyncAction always clears the guard in finally (no permanent lock-out)", () => {
    expect(USE_ASYNC_ACTION).toMatch(
      /finally\s*\{[\s\S]*setLoading\(false\)[\s\S]*guardRef\.current\s*=\s*false[\s\S]*\}/,
    );
  });

  it("StateProgressionCard's confirm dialog short-circuits when loading", () => {
    expect(STATE_PROGRESSION).toMatch(
      /handleDialogConfirm\s*=\s*async[\s\S]{0,200}if\s*\(loading\)\s*return/,
    );
  });

  it("Match-details routes the POI button through useAsyncAction (handleStateAction)", () => {
    expect(USE_MATCH_DETAILS).toMatch(
      /handleStateAction[\s\S]{0,200}useAsyncAction/,
    );
    expect(USE_MATCH_DETAILS).toMatch(/actionPath\s*===\s*"generate-poi"/);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Scenario 5 — soft-route Pending Engagement, two concurrent calls
// ────────────────────────────────────────────────────────────────────────

describe("POI-004 #5 — soft-route concurrent duplicate handled gracefully", () => {
  it("Soft-route insert is idempotent via UNIQUE(match_id) on poi_engagements", () => {
    expect(MATCH_EDGE).toMatch(
      /UNIQUE\(match_id\) on poi_engagements is our idempotency/i,
    );
  });

  it("23505 unique_violation triggers a re-fetch, NOT an unhandled 500", () => {
    expect(MATCH_EDGE).toMatch(/code\s*===\s*"23505"/);
    expect(MATCH_EDGE).toMatch(
      /SOFT_ROUTE idempotent replay — existing engagement/,
    );
    expect(MATCH_EDGE).toMatch(
      /SOFT_ROUTE conflict but re-fetch failed/,
    );
  });

  it("Soft-route response is also cached under the supplied Idempotency-Key", () => {
    expect(MATCH_EDGE).toMatch(
      /SOFT_ROUTE idempotency cache write failed \(non-fatal\)/,
    );
  });

  it("Audit row stamps idempotent_replay so duplicates are visible in the trail", () => {
    expect(MATCH_EDGE).toMatch(/idempotent_replay:\s*insertErr\s*\?\s*true\s*:\s*false/);
  });
});
