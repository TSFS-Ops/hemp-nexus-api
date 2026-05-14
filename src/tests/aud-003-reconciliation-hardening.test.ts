/**
 * AUD-003 — Credit burn / POI reconciliation hardening regression suite.
 *
 * Source-pin tests covering:
 *   Fix 1  cron schedule for burn-poi-reconciliation exists in a tracked migration
 *   Fix 2  reconciliation function wraps work in outer try/catch and writes
 *          a self-incident risk item on failure
 *   Fix 3  reconciliation probes minted-without-engagement drift
 *   Fix 4  this very test enforces (1) so the schedule cannot silently disappear
 *   Fix 5  synthetic drift detection (burn/POI/state/engagement) and idempotency
 *          remain present and read-only
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = join(REPO, "supabase", "migrations");
const RECON_PATH = join(REPO, "supabase", "functions", "burn-poi-reconciliation", "index.ts");
const reconSrc = readFileSync(RECON_PATH, "utf8");

function readAllMigrations(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  return files
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n--FILE--\n");
}

describe("AUD-003 Fix 1 + 4 — burn-poi-reconciliation cron schedule is tracked in source", () => {
  const allMigrations = readAllMigrations();

  it("at least one migration calls cron.schedule for burn-poi-reconciliation", () => {
    // Must reference the function name in a cron.schedule(...) call.
    const hasScheduleCall = /cron\.schedule\s*\([\s\S]*?burn-poi-reconciliation/i.test(allMigrations);
    expect(hasScheduleCall).toBe(true);
  });

  it("uses the canonical job name 'burn-poi-reconciliation-daily'", () => {
    expect(allMigrations).toMatch(/'burn-poi-reconciliation-daily'/);
  });

  it("uses the INTERNAL_CRON_KEY vault pattern (not anon bearer)", () => {
    // Locate the cron.schedule block for our job and check the auth pattern.
    const idx = allMigrations.indexOf("'burn-poi-reconciliation-daily'");
    expect(idx).toBeGreaterThan(0);
    const block = allMigrations.slice(idx, idx + 2000);
    expect(block).toMatch(/INTERNAL_CRON_KEY/);
    expect(block).toMatch(/x-internal-key/);
    expect(block).not.toMatch(/Bearer\s+ey/i); // no hard-coded JWT
  });

  it("schedule is idempotent (unschedule-before-schedule pattern)", () => {
    expect(allMigrations).toMatch(/cron\.unschedule\(\s*'burn-poi-reconciliation-daily'\s*\)/);
  });
});

describe("AUD-003 Fix 2 — reconciliation function surfaces its own failures", () => {
  it("declares a recordSelfIncident helper", () => {
    expect(reconSrc).toMatch(/recordSelfIncident/);
  });

  it("self-incident uses a stable idempotent title", () => {
    expect(reconSrc).toMatch(/Reconciliation: burn-poi-reconciliation run failed/);
  });

  it("self-incident insert checks for existing open row before inserting (idempotent)", () => {
    const start = reconSrc.indexOf("recordSelfIncident");
    const end = reconSrc.indexOf("Deno.serve");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const helper = reconSrc.slice(start, end);
    expect(helper).toMatch(/from\("admin_risk_items"\)\s*\.select/);
    expect(helper).toMatch(/\.eq\("status",\s*"open"\)/);
    expect(helper).toMatch(/from\("admin_risk_items"\)\s*\.insert/);
  });

  it("self-incident also writes an audit row tagged reconciliation.burn_poi.failed", () => {
    expect(reconSrc).toMatch(/reconciliation\.burn_poi\.failed/);
  });

  it("Deno.serve handler wraps work in try/catch that calls recordSelfIncident", () => {
    const handlerStart = reconSrc.indexOf("Deno.serve");
    const tail = reconSrc.slice(handlerStart);
    expect(tail).toMatch(/}\s*catch\s*\(\s*err\s*\)\s*\{[\s\S]*recordSelfIncident\s*\(/);
    expect(tail).toMatch(/RECONCILIATION_FAILED/);
  });

  it("intermediate fetch errors throw (so they reach the outer catch) instead of returning 500 directly", () => {
    // After hardening, none of the intermediate probes should short-circuit with json(500, ...).
    // The only json(500, ...) allowed is the final one inside the outer catch.
    const matches = reconSrc.match(/json\(500/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe("AUD-003 Fix 3 — minted-without-engagement probe", () => {
  it("queries poi_engagements for current rows on minted/burned matches", () => {
    expect(reconSrc).toMatch(/from\("poi_engagements"\)/);
    expect(reconSrc).toMatch(/mintedWithoutEngagement/);
  });

  it("filters out non-current engagement statuses (expired/declined/cancelled_email_change)", () => {
    expect(reconSrc).toMatch(/expired/);
    expect(reconSrc).toMatch(/declined/);
    expect(reconSrc).toMatch(/cancelled_email_change/);
  });

  it("opens an idempotent risk item per drifting match", () => {
    expect(reconSrc).toMatch(
      /Reconciliation: minted match without engagement \[match \$\{String\(drift\.match_id\)/,
    );
  });

  it("does NOT auto-repair the missing engagement (read-only)", () => {
    const start = reconSrc.indexOf("MINTED_WITHOUT_ENGAGEMENT");
    const end = reconSrc.indexOf("Optional: open admin_risk_items");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = reconSrc.slice(start, end);
    expect(block).not.toMatch(/from\("poi_engagements"\)\s*\.insert/);
    expect(block).not.toMatch(/atomic_generate_poi_v2/);
    expect(block).not.toMatch(/ensure_poi_engagement_for_minted_match/);
  });

  it("exposes minted_without_engagement count in the response and audit row", () => {
    expect(reconSrc).toMatch(/minted_without_engagement:\s*\{\s*count:\s*mintedWithoutEngagement\.length/);
    expect(reconSrc).toMatch(/minted_without_engagement:\s*mintedWithoutEngagement\.length/);
  });
});

describe("AUD-003 Fix 5 — read-only invariants and existing probes still present", () => {
  it("still detects burns_without_poi, pois_without_burn, state_without_ledger", () => {
    expect(reconSrc).toMatch(/burnsWithoutPoi/);
    expect(reconSrc).toMatch(/poisWithoutBurn/);
    expect(reconSrc).toMatch(/stateWithoutLedger/);
  });

  it("still respects exempt_burn allowlist when classifying POI without burn", () => {
    expect(reconSrc).toMatch(/exempt_burn/);
  });

  it("never mutates token_balances or burns/credits credits", () => {
    expect(reconSrc).not.toMatch(/atomic_token_credit/);
    expect(reconSrc).not.toMatch(/atomic_token_burn/);
    expect(reconSrc).not.toMatch(/from\("token_balances"\)\s*\.update/);
    expect(reconSrc).not.toMatch(/from\("token_ledger"\)\s*\.insert/);
    expect(reconSrc).not.toMatch(/from\("token_ledger"\)\s*\.update/);
    expect(reconSrc).not.toMatch(/from\("token_ledger"\)\s*\.delete/);
  });

  it("never silently mints POIs or rewrites match state", () => {
    expect(reconSrc).not.toMatch(/from\("matches"\)\s*\.update/);
    expect(reconSrc).not.toMatch(/from\("ledger_events"\)\s*\.insert/);
    expect(reconSrc).not.toMatch(/from\("pois"\)\s*\.insert/);
  });

  it("risk-item insertion is idempotent (status='open' lookup before insert)", () => {
    const buildIdx = reconSrc.indexOf("buildAndInsert");
    expect(buildIdx).toBeGreaterThan(0);
    const helper = reconSrc.slice(buildIdx, buildIdx + 1000);
    expect(helper).toMatch(/from\("admin_risk_items"\)\s*\.select[\s\S]*\.eq\("status",\s*"open"\)/);
  });
});

// Lightweight migration discovery sanity — proves the test scans the right dir.
describe("AUD-003 — test infrastructure sanity", () => {
  it("migrations directory contains .sql files", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files.slice(0, 5)) {
      expect(statSync(join(MIGRATIONS_DIR, f)).size).toBeGreaterThan(0);
    }
  });
});
