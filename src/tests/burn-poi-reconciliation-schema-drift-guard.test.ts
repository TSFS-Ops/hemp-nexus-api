/**
 * Guard tests for burn-poi-reconciliation schema-drift repair.
 *
 * Root cause: edge function previously assumed `pois.match_id`, but on the
 * live schema POI↔match linkage is only available via the canonical bridge:
 *   pois.id → poi_engagements.poi_id → poi_engagements.match_id → matches.id
 *
 * These tests pin the source to:
 *   - zero queries of `pois.match_id`
 *   - canonical poi_engagements bridge usage in Sections 1, 2, 4a, 4b
 *   - mutation safety (no writes to business-state tables)
 *   - cron/deploy posture unchanged (no schedule/auth changes from this file)
 *   - regression: each drift section still exists
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/functions/burn-poi-reconciliation/index.ts",
  ),
  "utf8",
);

describe("burn-poi-reconciliation: schema-drift guards", () => {
  it("contains no select of pois.match_id (any form)", () => {
    // Any `.from("pois")` block that selects "match_id" is forbidden.
    // We scan window of ~6 lines after each `.from("pois")` and reject any
    // `.select(...)` containing `match_id`.
    const lines = SRC.split("\n");
    const offenders: Array<{ line: number; text: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/\.from\("pois"\)/.test(lines[i])) continue;
      const window = lines.slice(i, i + 6).join(" ");
      const selectMatch = window.match(/\.select\(\s*"([^"]*)"\s*\)/);
      if (selectMatch && /\bmatch_id\b/.test(selectMatch[1])) {
        offenders.push({ line: i + 1, text: selectMatch[0] });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("header/docstring documents the canonical bridge and absence of pois.match_id", () => {
    expect(SRC).toMatch(/no match_id column/);
    expect(SRC).toMatch(
      /pois\.id\s*→\s*poi_engagements\.poi_id\s*→\s*poi_engagements\.match_id\s*→\s*matches\.id/,
    );
  });

  it("Section 1 BURN_WITHOUT_POI uses poi_engagements bridge", () => {
    // The Section 1 block must query poi_engagements with select including
    // both match_id and poi_id and filter by .in("match_id", ...).
    const section1 = SRC.match(
      /BURN_WITHOUT_POI[\s\S]+?(?=\/\/ ── 2\. POI_WITHOUT_BURN)/,
    )?.[0];
    expect(section1).toBeTruthy();
    expect(section1!).toMatch(/\.from\("poi_engagements"\)/);
    expect(section1!).toMatch(/\.select\("match_id, poi_id"\)/);
  });

  it("Section 2 POI_WITHOUT_BURN uses poi_engagements bridge and skips unilateral POIs", () => {
    const section2 = SRC.match(
      /POI_WITHOUT_BURN[\s\S]+?(?=\/\/ ── 3\. STATE_WITHOUT_LEDGER)/,
    )?.[0];
    expect(section2).toBeTruthy();
    expect(section2!).toMatch(/\.from\("poi_engagements"\)/);
    expect(section2!).toMatch(/\.select\("poi_id, match_id"\)/);
    // POIs with no engagement must be skipped (unilateral/fresh).
    expect(section2!).toMatch(/linkedMatchIds\.length === 0/);
  });

  it("Section 4a ENGAGEMENT_WITHOUT_POI resolves coverage through poi_engagements bridge", () => {
    const section4a = SRC.match(
      /ENGAGEMENT_WITHOUT_POI[\s\S]+?(?=\/\/ ── 4b\. WAD_POI_DRIFT)/,
    )?.[0];
    expect(section4a).toBeTruthy();
    // Two bridge queries: the active engagements scan + the coverage scan.
    expect(
      (section4a!.match(/\.from\("poi_engagements"\)/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("Section 4b WAD_POI_DRIFT resolves poi → match through poi_engagements bridge", () => {
    const section4b = SRC.match(
      /WAD_POI_DRIFT[\s\S]+?(?=\/\/ ── 5\.)/,
    )?.[0];
    expect(section4b).toBeTruthy();
    expect(section4b!).toMatch(/\.from\("poi_engagements"\)/);
    // pois select in 4b must NOT include match_id.
    const poisSelect = section4b!.match(
      /\.from\("pois"\)[\s\S]{0,120}?\.select\("([^"]+)"\)/,
    );
    expect(poisSelect).toBeTruthy();
    expect(poisSelect![1]).not.toMatch(/match_id/);
  });
});

describe("burn-poi-reconciliation: mutation safety", () => {
  const forbiddenWriteTargets = [
    "pois",
    "wads",
    "matches",
    "poi_engagements",
    "token_ledger",
    "ledger_events",
    "token_balances",
    "token_wallets",
    "token_transactions",
    "acceptance_receipts",
    "notification_dispatches",
    "email_send_log",
    "payment_disputes",
    "refund_requests",
  ];

  for (const tbl of forbiddenWriteTargets) {
    it(`does not insert/update/delete/upsert into ${tbl}`, () => {
      const re = new RegExp(
        `\\.from\\("${tbl}"\\)[\\s\\S]{0,200}?\\.(insert|update|delete|upsert)\\(`,
        "g",
      );
      expect(SRC.match(re) ?? []).toEqual([]);
    });
  }

  it("admin-write surfaces remain limited to risk/audit/notification-resolve helpers", () => {
    // Allowed write surfaces — sanity check they're still wired.
    expect(SRC).toMatch(/\.from\("admin_risk_items"\)/);
    expect(SRC).toMatch(/\.from\("admin_audit_logs"\)/);
    expect(SRC).toMatch(/resolveNotificationsFor/);
  });
});

describe("burn-poi-reconciliation: regression guards", () => {
  it("preserves all six drift detection sections", () => {
    expect(SRC).toMatch(/BURN_WITHOUT_POI/);
    expect(SRC).toMatch(/POI_WITHOUT_BURN/);
    expect(SRC).toMatch(/STATE_WITHOUT_LEDGER/);
    expect(SRC).toMatch(/MINTED_WITHOUT_ENGAGEMENT/);
    expect(SRC).toMatch(/ENGAGEMENT_WITHOUT_POI/);
    expect(SRC).toMatch(/WAD_POI_DRIFT/);
  });

  it("preserves idempotent self-incident writer keyed by title", () => {
    expect(SRC).toMatch(/recordSelfIncident/);
    expect(SRC).toMatch(/Reconciliation: burn-poi-reconciliation run failed/);
  });

  it("preserves stale-risk auto-close sweep", () => {
    expect(SRC).toMatch(/auto_resolved/);
    expect(SRC).toMatch(/reconciliation_auto_close/);
  });

  it("preserves internal-key + service-role + platform_admin auth posture", () => {
    expect(SRC).toMatch(/INTERNAL_CRON_KEY/);
    expect(SRC).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(SRC).toMatch(/platform_admin/);
  });

  it("does not call cron.schedule / cron.alter_job / cron.unschedule from the function source", () => {
    expect(SRC).not.toMatch(/cron\.schedule/);
    expect(SRC).not.toMatch(/cron\.alter_job/);
    expect(SRC).not.toMatch(/cron\.unschedule/);
  });
});
