/**
 * POI-004 — Duplicate Protection Source-of-Truth Test
 *
 * Defence-in-depth migration adds two partial unique indexes so a duplicate
 * POI mint or duplicate successful POI credit-burn cannot be inserted even
 * if a future RPC bypasses the atomic_generate_poi_v2 row-lock + state guard.
 *
 * This test is a migration-file source-of-truth scan (mirrors the pattern in
 * `secdef-stage-d1-grants.test.ts`). Live duplicate-rejection probes were
 * executed against the production DB during the rollout and recorded in the
 * task notes — both unique violations fired, both blocked-outcome retries
 * remained permitted.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function loadAllMigrations(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf-8"))
    .join("\n");
}

describe("POI-004 duplicate protection", () => {
  const sql = loadAllMigrations();

  it("creates a partial UNIQUE index on ledger_events for one poi.minted per match", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_events_poi_minted_per_match\s+ON public\.ledger_events \(match_id\)\s+WHERE event_type = 'poi\.minted' AND match_id IS NOT NULL/i,
    );
  });

  it("creates a partial UNIQUE index on token_ledger for one allowed declare_intent burn per match", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_token_ledger_declare_intent_per_match\s+ON public\.token_ledger \(\(metadata->>'match_id'\)\)\s+WHERE action_type = 'declare_intent'\s+AND outcome = 'allowed'\s+AND metadata \? 'match_id'/i,
    );
  });

  it("includes a pre-flight duplicate-data abort guard before creating the indexes", () => {
    // Prevents the migration from silently failing to apply on a future
    // dataset that already contains duplicates — forces operator action via
    // reconcile_poi_burns() instead.
    expect(sql).toMatch(/POI-004 migration aborted: duplicates exist/);
  });

  it("does NOT block 'blocked'-outcome retries on token_ledger (failed-attempt records preserved)", () => {
    // The token_ledger index is filtered to outcome='allowed'. Any change
    // that drops this filter would break the legitimate retry path where
    // the first attempt is blocked (insufficient credits, denied, etc.)
    // and the user retries successfully.
    expect(sql).toMatch(/uq_token_ledger_declare_intent_per_match[\s\S]*?outcome = 'allowed'/);
  });
});
