/**
 * Batch O Phase 2 closeout — source-level guards.
 *
 * These tests pin the Phase 2 wiring at the source level so it cannot
 * silently regress:
 *
 *   • AttentionPipeline / DealPipeline / MatchesList all apply
 *     `!isInconsistentMatch(...)` to their result list (items 3-5).
 *   • MatchDetails short-circuits inconsistent matches to a banner
 *     with `data-testid="legacy-repair-banner"` (item 6).
 *   • The banner does NOT expose internal inconsistency reason strings
 *     or the predicate name (item 7).
 *   • The banner branch suppresses Hero / Wizard / Execution / Spine /
 *     Action / POI / WaD affordances (item 8) — none of those component
 *     names appear inside the inconsistent-branch JSX block.
 *   • The admin RPC migration encodes `is_admin()` + REVOKE ... FROM
 *     PUBLIC, anon + GRANT TO authenticated + SECURITY DEFINER (item 12).
 *   • AdminLegacyRepairPanel ships read-only copy and no
 *     repair/archive/mark-reviewed mutation buttons (item 11).
 *
 * Pure file reads. No React, no DB, no network.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Batch O Phase 2 — pipeline list filters", () => {
  const FILES = [
    "src/components/desk/AttentionPipeline.tsx",
    "src/components/desk/DealPipeline.tsx",
    "src/components/MatchesList.tsx",
  ] as const;

  for (const f of FILES) {
    it(`${f} imports and applies isInconsistentMatch`, () => {
      const src = read(f);
      expect(src).toMatch(/from\s+["']@\/lib\/match-lifecycle["']/);
      expect(src).toMatch(/isInconsistentMatch/);
      // Filter idiom: `.filter(... => !isInconsistentMatch(...))`
      expect(src).toMatch(/!\s*isInconsistentMatch\s*\(/);
    });
  }
});

describe("Batch O Phase 2 — MatchDetails legacy-repair banner", () => {
  const src = read("src/pages/MatchDetails.tsx");

  it("short-circuits via isInconsistentMatch", () => {
    expect(src).toMatch(/if\s*\(\s*isInconsistentMatch\s*\(/);
  });

  it('renders an element with data-testid="legacy-repair-banner"', () => {
    expect(src).toMatch(/data-testid=["']legacy-repair-banner["']/);
  });

  it("banner copy is non-technical and does not expose inconsistency reasons", () => {
    // Capture the banner branch (the `if (isInconsistentMatch(...)) { ... }` block).
    const idx = src.indexOf("isInconsistentMatch(match");
    expect(idx).toBeGreaterThan(-1);
    // Take a generous window after the predicate to cover the JSX block.
    const window = src.slice(idx, idx + 2000);
    expect(window).toMatch(/temporarily unavailable/i);
    // No leaked internals
    expect(window).not.toMatch(/poi_state/i);
    expect(window).not.toMatch(/legacy_repair_required/i);
    expect(window).not.toMatch(/state_reconciliation_required/i);
    expect(window).not.toMatch(/inconsistency_reasons/i);
    expect(window).not.toMatch(/settled_status_with_draft_poi/i);
  });

  it("banner branch does not mount Hero / Wizard / Execution / Spine / POI / WaD affordances", () => {
    const idx = src.indexOf("isInconsistentMatch(match");
    const closeIdx = src.indexOf("const isSettled", idx);
    expect(closeIdx).toBeGreaterThan(idx);
    const branch = src.slice(idx, closeIdx);
    for (const comp of [
      "MatchHeroCard",
      "DealWizard",
      "ExecutionSection",
      "SpineTimeline",
      "AcceptBindCard",
      "AcceptEngagementCard",
      "PendingEngagementSection",
      "MatchChallengePanel",
    ]) {
      expect(branch).not.toContain(`<${comp}`);
    }
  });
});

describe("Batch O Phase 2 — admin RPC permission encoding (MT-008)", () => {
  // Pick the most recent matching migration so this stays stable when fixes land.
  const migrationsDir = join(root, "supabase/migrations");
  const candidates = readdirSync(migrationsDir).filter((f) =>
    /\.sql$/.test(f),
  );
  const matching = candidates
    .filter((f) => {
      const s = readFileSync(join(migrationsDir, f), "utf8");
      return /admin_list_inconsistent_matches/.test(s);
    })
    .sort();

  it("at least one migration defines admin_list_inconsistent_matches", () => {
    expect(matching.length).toBeGreaterThan(0);
  });

  it("the latest definition encodes admin-only + revoke-public + grant-authenticated + SECURITY DEFINER", () => {
    const latest = matching[matching.length - 1];
    const sql = readFileSync(join(migrationsDir, latest), "utf8");
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/is_admin\s*\(\s*\)/);
    // Must reject non-admin callers
    expect(sql).toMatch(/RAISE EXCEPTION\s+'forbidden'/);
    // Must revoke from PUBLIC + anon
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.admin_list_inconsistent_matches[^;]*FROM[^;]*PUBLIC[^;]*anon/i);
    // Must grant only to authenticated
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.admin_list_inconsistent_matches[^;]*TO\s+authenticated/i);
  });
});

describe("Batch O Phase 2 — AdminLegacyRepairPanel read-only copy", () => {
  const src = read("src/components/admin/AdminLegacyRepairPanel.tsx");

  it("calls the admin RPC, not a generic table read", () => {
    expect(src).toMatch(/\.rpc\(\s*["']admin_list_inconsistent_matches["']/);
    // No direct mutating calls
    expect(src).not.toMatch(/\.update\s*\(/);
    expect(src).not.toMatch(/\.delete\s*\(/);
    expect(src).not.toMatch(/\.insert\s*\(/);
    expect(src).not.toMatch(/\.upsert\s*\(/);
  });

  // NOTE: The original "actions are deferred" assertion was retired in
  // Batch O Phase 2b Step 5, when the panel was intentionally wired to the
  // admin archive/repair edge functions. The current action surface is
  // covered by AdminLegacyRepairPanel.test.tsx (dialog validation,
  // Idempotency-Key header, error mapping) and by the Step 6 record-
  // detections tests. We keep the read-only RPC guard above to ensure no
  // direct mutating table calls are introduced from this component.

});
