/**
 * Batch O / MT-008 — demo fixture source guards.
 *
 * Source-level (not DB) checks that the Daniel demo seeder/unseeder ship
 * the three MT-008 fixtures in the correct shape and that the resulting
 * row metadata flips `inconsistencyReasons` for each fixture as expected.
 *
 * No DB, no React, no edge calls — purely deterministic.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  inconsistencyReasons,
  isInconsistentMatch,
  isActiveMatch,
  type LifecycleMatch,
} from "@/lib/match-lifecycle";

const SEEDER = readFileSync(
  resolve("supabase/functions/seed-daniel-fixtures/index.ts"),
  "utf8",
);
const UNSEEDER = readFileSync(
  resolve("supabase/functions/unseed-daniel-fixtures/index.ts"),
  "utf8",
);

const MT008_CODES = [
  "DEMO-MT008-LEGACY-001",
  "DEMO-MT008-STALESETTLED-002",
  "DEMO-MT008-ARCHIVE-003",
] as const;

describe("Batch O / MT-008 — Daniel fixture source guards", () => {
  it("seeder declares the three MT-008 fixture codes in the FIXTURES manifest", () => {
    for (const code of MT008_CODES) {
      expect(SEEDER).toContain(`id: "${code}"`);
    }
  });

  it("seeder ships the applyMt008Shape helper and gates it on is_demo=true", () => {
    expect(SEEDER).toMatch(/async function applyMt008Shape\s*\(/);
    // Both the SELECT and the UPDATE must be hard-gated on is_demo=true.
    const occurrences = SEEDER.match(/\.eq\("is_demo",\s*true\)/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("seeder seeds each MT-008 fixture as is_demo via ensureMatch + applyMt008Shape", () => {
    for (const code of MT008_CODES) {
      expect(SEEDER).toContain(`"${code}"`);
      // applyMt008Shape is invoked with the fixture_code label for every row.
      expect(SEEDER).toContain(`fixture_code: "${code}"`);
    }
  });

  it("seeder writes the canonical metadata markers for legacy + archive fixtures", () => {
    expect(SEEDER).toMatch(
      /fixture_code:\s*"DEMO-MT008-LEGACY-001"[\s\S]*?legacy_repair_required:\s*true/,
    );
    expect(SEEDER).toMatch(
      /fixture_code:\s*"DEMO-MT008-ARCHIVE-003"[\s\S]*?state_reconciliation_required:\s*true/,
    );
  });

  it("seeder writes a non-null settled_at on the safe-repair fixture only", () => {
    expect(SEEDER).toMatch(
      /fixture_code:\s*"DEMO-MT008-STALESETTLED-002"[\s\S]*?settled_at:\s*iso\(now\s*-\s*14\s*\*\s*day\)/,
    );
  });

  it("unseeder allowlist contains every MT-008 fixture hash", () => {
    for (const code of MT008_CODES) {
      expect(UNSEEDER).toContain(`"${code}"`);
    }
    // is_demo gate on matches delete is preserved.
    expect(UNSEEDER).toMatch(/\.eq\("is_demo",\s*true\)/);
  });

  // ── Predicate-level proof: the three shapes really are inconsistent ──

  function legacyMarker(): LifecycleMatch {
    return {
      status: "matched",
      state: "discovery",
      poi_state: "DRAFT",
      buyer_org_id: "buyer-org",
      seller_org_id: "seller-org",
      metadata: {
        demo_fixture: true,
        batch: "Batch O MT-008",
        fixture_code: "DEMO-MT008-LEGACY-001",
        legacy_repair_required: true,
      },
    };
  }
  function staleSettled(): LifecycleMatch {
    return {
      status: "matched",
      state: "discovery",
      poi_state: "DRAFT",
      settled_at: new Date(Date.now() - 14 * 86_400_000).toISOString(),
      buyer_org_id: "buyer-org",
      seller_org_id: "seller-org",
      metadata: {
        demo_fixture: true,
        batch: "Batch O MT-008",
        fixture_code: "DEMO-MT008-STALESETTLED-002",
      },
    };
  }
  function archiveCandidate(): LifecycleMatch {
    return {
      status: "matched",
      state: "discovery",
      poi_state: "DRAFT",
      buyer_org_id: "buyer-org",
      seller_org_id: "seller-org",
      metadata: {
        demo_fixture: true,
        batch: "Batch O MT-008",
        fixture_code: "DEMO-MT008-ARCHIVE-003",
        state_reconciliation_required: true,
      },
    };
  }

  it("DEMO-MT008-LEGACY-001 → legacy_repair_required reason, hidden by isActiveMatch", () => {
    const m = legacyMarker();
    expect(isInconsistentMatch(m)).toBe(true);
    expect(inconsistencyReasons(m)).toContain("legacy_repair_required");
    expect(isActiveMatch(m)).toBe(false);
  });

  it("DEMO-MT008-STALESETTLED-002 → settled_at_without_settled_status reason, hidden", () => {
    const m = staleSettled();
    expect(isInconsistentMatch(m)).toBe(true);
    expect(inconsistencyReasons(m)).toContain("settled_at_without_settled_status");
    expect(isActiveMatch(m)).toBe(false);
  });

  it("DEMO-MT008-ARCHIVE-003 → state_reconciliation_required reason, hidden", () => {
    const m = archiveCandidate();
    expect(isInconsistentMatch(m)).toBe(true);
    expect(inconsistencyReasons(m)).toContain("state_reconciliation_required");
    expect(isActiveMatch(m)).toBe(false);
  });

  it("after archive marker is stamped, isActiveMatch stays false (queue removal proven)", () => {
    const m = archiveCandidate();
    (m.metadata as Record<string, unknown>).legacy_archived_admin_hold = true;
    // Still inconsistent (state_reconciliation_required marker remains)…
    expect(isInconsistentMatch(m)).toBe(true);
    // …and isActiveMatch additionally rejects via the archive hold marker.
    expect(isActiveMatch(m)).toBe(false);
  });

  it("after clear_stale_settled_at repair, the fixture becomes a clean active row", () => {
    const m = staleSettled();
    m.settled_at = null;
    expect(isInconsistentMatch(m)).toBe(false);
    expect(isActiveMatch(m)).toBe(true);
  });
});
