/**
 * Batch V — Final reconciliation, orphaned state and closeout readiness.
 *
 * Source-pin regression suite covering the new artefacts. Read-only.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = join(REPO, "supabase", "migrations");

const BALANCE = join(REPO, "supabase/functions/balance-drift-reconciliation/index.ts");
const SIDE = join(REPO, "supabase/functions/side-effect-reconciliation/index.ts");
const BURN = join(REPO, "supabase/functions/burn-poi-reconciliation/index.ts");
const TXN = join(REPO, "supabase/functions/transaction-reconciliation/index.ts");
const HEALTH = join(REPO, "src/components/governance/HealthBoard.tsx");

function allMigrations(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n--FILE--\n");
}

describe("Batch V Fix 1 — balance-drift-reconciliation", () => {
  it("function exists", () => expect(existsSync(BALANCE)).toBe(true));
  const src = existsSync(BALANCE) ? readFileSync(BALANCE, "utf8") : "";
  it("calls reconcile_token_balances RPC", () => expect(src).toMatch(/rpc\(["']reconcile_token_balances["']\)/));
  it("excludes demo orgs", () => expect(src).toMatch(/is_demo[\s\S]{0,40}true/));
  it("opens balance_drift risk item with dedup_key", () => {
    expect(src).toMatch(/kind:\s*["']balance_drift["']/);
    expect(src).toMatch(/balance_drift:\$\{drift\.org_id\}/);
  });
  it("never mutates token_balances or token_ledger", () => {
    expect(src).not.toMatch(/from\(["']token_balances["']\)\s*\.update/);
    expect(src).not.toMatch(/from\(["']token_ledger["']\)\s*\.(update|insert|delete)/);
    expect(src).not.toMatch(/atomic_token_burn|atomic_token_credit/);
  });
  it("supports dry_run", () => expect(src).toMatch(/dry_run/));
  it("writes reconciliation.balance.run audit", () => expect(src).toMatch(/reconciliation\.balance\.run/));
  it("writes reconciliation.balance.failed on outer catch", () => expect(src).toMatch(/reconciliation\.balance\.failed/));
});

describe("Batch V Fix 1 — balance job scheduled + heartbeated", () => {
  const all = allMigrations();
  it("schedules balance-drift-reconciliation-daily via cron_invoke", () => {
    expect(all).toMatch(/'balance-drift-reconciliation-daily'/);
    expect(all).toMatch(/cron_invoke\([\s\S]*?balance-drift-reconciliation-daily/);
  });
  it("seeds cron_heartbeats row", () => {
    expect(all).toMatch(/'balance-drift-reconciliation-daily',\s*86400/);
  });
});

describe("Batch V Fix 2 — engagement_without_poi probe", () => {
  const src = readFileSync(BURN, "utf8");
  it("queries active engagements for poi coverage", () => {
    expect(src).toMatch(/engagementWithoutPoi/);
    expect(src).toMatch(/ENGAGEMENT_STATUSES_REQUIRING_POI/);
  });
  it("excludes soft-route pending statuses", () => {
    // Soft-route statuses MUST NOT appear in the allow-list set.
    const setBlock = src.match(/ENGAGEMENT_STATUSES_REQUIRING_POI[\s\S]*?\]\)/)?.[0] ?? "";
    expect(setBlock).not.toMatch(/"pending"/);
    expect(setBlock).not.toMatch(/"notification_sent"/);
    expect(setBlock).not.toMatch(/"contacted"/);
    expect(setBlock).toMatch(/"accepted"/);
  });
  it("response surfaces engagement_without_poi", () => {
    expect(src).toMatch(/engagement_without_poi:\s*\{\s*count:\s*engagementWithoutPoi\.length/);
  });
});

describe("Batch V Fix 3 — WaD/POI consistency detector + documented limit", () => {
  const src = readFileSync(BURN, "utf8");
  it("includes wad_poi_drift probe", () => {
    expect(src).toMatch(/wadPoiDrift/);
    expect(src).toMatch(/from\(["']wads["']\)/);
  });
  it("detects missing/incompatible POI linkage and org mismatches", () => {
    expect(src).toMatch(/missing_poi_link/);
    expect(src).toMatch(/poi_not_found/);
    expect(src).toMatch(/poi_state_incompatible/);
    expect(src).toMatch(/buyer_org_mismatch/);
    expect(src).toMatch(/seller_org_mismatch/);
  });
  it("documents that terms-hash drift is out of scope", () => {
    expect(src).toMatch(/Terms-hash drift is intentionally not asserted|terms-hash on pois/i);
  });
});

describe("Batch V Fix 4 — side-effect-reconciliation", () => {
  it("function exists", () => expect(existsSync(SIDE)).toBe(true));
  const src = existsSync(SIDE) ? readFileSync(SIDE, "utf8") : "";
  it("declares SIDE_EFFECT_MATRIX with required canonical events", () => {
    for (const ev of [
      "poi.generated", "poi.minted", "engagement.accepted", "match.completed",
      "wad.sealed", "credits.purchased", "credits.refunded", "admin_risk_item.resolved",
    ]) expect(src).toContain(`"${ev}"`);
  });
  it("opens kind=missing_side_effect risk items, never resends", () => {
    expect(src).toMatch(/kind:\s*["']missing_side_effect["']/);
    // Strip line + block comments before scanning for active resend/replay
    // code paths. The function intentionally DOCUMENTS that it does not
    // resend/replay; that prose must not trip this guard.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
    expect(code).not.toMatch(/\bresend\s*\(/i);
    expect(code).not.toMatch(/\breplay\s*\(/i);
    expect(code).not.toMatch(/retryDelivery|requeueWebhook|forceRedispatch/i);
  });

  it("supports dry_run", () => expect(src).toMatch(/dry_run/));
  it("scheduled + heartbeated", () => {
    const all = allMigrations();
    expect(all).toMatch(/'side-effect-reconciliation-daily'/);
    expect(all).toMatch(/cron_invoke\([\s\S]*?side-effect-reconciliation-daily/);
    expect(all).toMatch(/'side-effect-reconciliation-daily',\s*86400/);
  });
});

describe("Batch V Fix 5 — stale-risk auto-close", () => {
  const burn = readFileSync(BURN, "utf8");
  const bal = readFileSync(BALANCE, "utf8");
  const side = readFileSync(SIDE, "utf8");
  it("burn-poi auto-resolves machine-created reconciliation items only (title-prefix or dedup_key)", () => {
    expect(burn).toMatch(/Reconciliation: burn without POI \[ledger /);
    expect(burn).toMatch(/risk_item\.auto_resolved/);
    expect(burn).toMatch(/reconciliation_auto_close/);
  });
  it("balance-drift auto-resolves only its own dedup_key prefix", () => {
    expect(bal).toMatch(/balance_drift:/);
    expect(bal).toMatch(/risk_item\.auto_resolved/);
  });
  it("side-effect auto-resolves only its own dedup_key prefix", () => {
    expect(side).toMatch(/missing_side_effect:/);
    expect(side).toMatch(/risk_item\.auto_resolved/);
  });
  it("all three call resolveNotificationsFor on auto-close", () => {
    for (const s of [burn, bal, side]) {
      expect(s).toMatch(/resolveNotificationsFor\(/);
      expect(s).toMatch(/"admin_risk_item"/);
    }
  });
});

describe("Batch V Fix 6 — transaction-reconciliation hardening", () => {
  const src = readFileSync(TXN, "utf8");
  it("supports dry_run", () => expect(src).toMatch(/dry_run/));
  it("per-record before/after snapshots in audit details", () => {
    expect(src).toMatch(/records:\s*\[/);
    expect(src).toMatch(/before/);
    expect(src).toMatch(/after/);
  });
  it("scheduled + heartbeated", () => {
    const all = allMigrations();
    expect(all).toMatch(/'transaction-reconciliation-job'/);
    expect(all).toMatch(/'transaction-reconciliation-job',\s*900/);
  });
});

describe("Batch V Fix 7 — closeout_drift_summary RPC + HealthBoard tile", () => {
  const all = allMigrations();
  it("RPC declared in migrations", () => {
    expect(all).toMatch(/CREATE OR REPLACE FUNCTION public\.closeout_drift_summary\(\)/);
    expect(all).toMatch(/balance_drift/);
    expect(all).toMatch(/burn_poi_drift/);
    expect(all).toMatch(/wad_poi_drift/);
    expect(all).toMatch(/missing_side_effect/);
    expect(all).toMatch(/generated_at/);
  });
  it("RPC requires admin caller", () => {
    expect(all).toMatch(/closeout_drift_summary:[\s\S]*admin role required/);
  });
  const hb = readFileSync(HEALTH, "utf8");
  it("HealthBoard queries the RPC", () => {
    expect(hb).toMatch(/closeout_drift_summary/);
    expect(hb).toMatch(/healthboard-closeout-tile/);
  });
  it("tile renders 'error' on query failure (never green)", () => {
    expect(hb).toMatch(/closeoutError[\s\S]{0,300}error/);
    expect(hb).toMatch(/cannot prove closeout/);
  });
  it("tile renders degraded when RPC returns null", () => {
    expect(hb).toMatch(/unknown · degraded/);
  });
});

describe("Batch V Fix 8 — heartbeat coverage for all new jobs", () => {
  const hb = readFileSync(HEALTH, "utf8");
  it("HealthBoard MONITORED_JOBS includes all new jobs", () => {
    expect(hb).toMatch(/balance-drift-reconciliation-daily/);
    expect(hb).toMatch(/side-effect-reconciliation-daily/);
    expect(hb).toMatch(/transaction-reconciliation-job/);
  });
});
