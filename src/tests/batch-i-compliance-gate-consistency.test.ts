/**
 * Batch I — Compliance / KYB / WaD gate consistency hardening.
 *
 * Static-source verification (CI-safe, no DB roundtrip). Confirms that the
 * code-shape contracts agreed in Batch I are present:
 *
 *  Fix 1 — Bypassed rows stamped at the data layer (screening_results.metadata,
 *          entities.metadata) so a bypassed clear/verified is distinguishable
 *          from a real provider result without joining audit_logs.
 *  Fix 2 — IDV `review` opens an idempotent dd_approval_requests row and does
 *          NOT promote the entity to verified.
 *  Fix 3 — WaD asserts POI state is compatible (typed POI_STATE_INCOMPATIBLE)
 *          before sealing.
 *  Fix 4 — Lifecycle scheduler runs a WaD/POI drift reconciliation probe and
 *          creates idempotent admin_risk_items on drift.
 *  Fix 5 — p3-wad creates a dd_approval_requests follow-up when UBO_COMPLETENESS
 *          fails at WaD time.
 *  Fix 6 — Provider retry cooldown helper exists and is wired into idv-verify
 *          and dilisense-screen; returns typed PROVIDER_RETRY_COOLDOWN.
 *  Fix 7 — Build-time guard forbids `isBypassEnabled` without
 *          `recordBypassUsage`/`tryBypass`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FN = (p: string) => join(ROOT, "supabase", "functions", p);
const SQL_DIR = join(ROOT, "supabase", "migrations");

function readFn(p: string) {
  return readFileSync(FN(p), "utf8");
}

function findMigration(pattern: RegExp): string {
  const files = readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql")).sort().reverse();
  for (const f of files) {
    const sql = readFileSync(join(SQL_DIR, f), "utf8");
    if (pattern.test(sql)) return sql;
  }
  throw new Error(`No migration matched: ${pattern}`);
}

describe("Batch I Fix 1 — bypassed rows stamped at data layer", () => {
  it("dilisense-screen stamps screening_results.metadata on bypass", () => {
    const src = readFn("dilisense-screen/index.ts");
    expect(src).toMatch(/bypass_gate:\s*"sanctions"/);
    expect(src).toMatch(/test_mode:\s*true/);
    expect(src).toMatch(/bypass_used_at/);
    expect(src).toMatch(/bypass_actor/);
  });

  it("idv-verify stamps entities.metadata on bypass with bypass_gates includes idv", () => {
    const src = readFn("idv-verify/index.ts");
    expect(src).toMatch(/bypass_gates/);
    expect(src).toMatch(/last_bypass_at/);
    expect(src).toMatch(/"idv"/);
  });

  it("ubo-verify stamps entities.metadata on bypass with bypass_gates includes ubo", () => {
    const src = readFn("ubo-verify/index.ts");
    expect(src).toMatch(/bypass_gates/);
    expect(src).toMatch(/"ubo"/);
    expect(src).toMatch(/test_mode:\s*true/);
  });

  it("migration adds metadata columns to screening_results, entities, admin_risk_items, dd_approval_requests", () => {
    const sql = findMigration(/screening_results[\s\S]+ADD COLUMN IF NOT EXISTS metadata/);
    expect(sql).toMatch(/ALTER TABLE public\.entities[\s\S]+metadata jsonb/);
    expect(sql).toMatch(/admin_risk_items[\s\S]+dedup_key/);
    expect(sql).toMatch(/dd_approval_requests[\s\S]+dedup_key/);
  });
});

describe("Batch I Fix 2 — IDV review opens manual-review queue, never verifies", () => {
  const src = readFn("idv-verify/index.ts");

  it("only promotes entity to verified when status === 'verified'", () => {
    expect(src).toMatch(/if \(result\.status === "verified"\)/);
  });

  it("creates dd_approval_requests when status === 'review' with idempotent dedup_key", () => {
    expect(src).toMatch(/result\.status === "review"/);
    expect(src).toMatch(/dd_approval_requests/);
    expect(src).toMatch(/idv_review/);
    expect(src).toMatch(/dedup_key/);
    expect(src).toMatch(/onConflict:\s*"dedup_key"/);
  });

  it("response signals manual_review_queued", () => {
    expect(src).toMatch(/manual_review_queued/);
  });
});

describe("Batch I Fix 3 — WaD asserts compatible POI state", () => {
  const src = readFn("wad/index.ts");

  it("throws POI_STATE_INCOMPATIBLE for non-allowed states", () => {
    expect(src).toMatch(/POI_STATE_INCOMPATIBLE/);
    expect(src).toMatch(/COMPATIBLE_POI_STATES/);
  });

  it("allow-list includes COMPLETED / COMPLETION_REQUESTED / ELIGIBLE", () => {
    expect(src).toMatch(/"COMPLETED"/);
    expect(src).toMatch(/"COMPLETION_REQUESTED"/);
    expect(src).toMatch(/"ELIGIBLE"/);
  });
});

describe("Batch I Fix 4 — Lifecycle scheduler WaD/POI drift probe", () => {
  const src = readFn("lifecycle-scheduler/index.ts");

  it("scans sealed WaDs and detects terminal-drift / missing-POI cases", () => {
    expect(src).toMatch(/wad_poi_drift/);
    expect(src).toMatch(/wad_missing_poi/);
    expect(src).toMatch(/wad_poi_terminal_drift/);
  });

  it("writes idempotent admin_risk_items via dedup_key onConflict", () => {
    expect(src).toMatch(/admin_risk_items/);
    expect(src).toMatch(/onConflict:\s*"dedup_key"/);
  });

  it("audits the detection and never mutates WaD/POI state in the drift block", () => {
    expect(src).toMatch(/wad\.poi_drift_detected/);
    // The drift probe must not mutate wads.status
    const driftBlock = src.split("Batch I Fix 4")[1] ?? "";
    expect(driftBlock).not.toMatch(/from\("wads"\)[\s\S]{0,200}\.update/);
  });
});

describe("Batch I Fix 5 — UBO incomplete creates compliance follow-up", () => {
  const src = readFn("p3-wad/index.ts");

  it("opens dd_approval_requests with kind=ubo_incomplete on UBO failure", () => {
    expect(src).toMatch(/UBO_COMPLETENESS/);
    expect(src).toMatch(/ubo_incomplete/);
    expect(src).toMatch(/dd_approval_requests/);
    expect(src).toMatch(/dedup_key/);
  });

  it("writes wad.ubo_incomplete.queued audit row", () => {
    expect(src).toMatch(/wad\.ubo_incomplete\.queued/);
  });
});

describe("Batch I Fix 6 — Provider retry cooldown", () => {
  it("shared helper exists and exposes check + record + envelope", () => {
    const src = readFileSync(FN("_shared/provider-retry.ts"), "utf8");
    expect(src).toMatch(/checkProviderCooldown/);
    expect(src).toMatch(/recordProviderFailure/);
    expect(src).toMatch(/cooldownResponseEnvelope/);
    expect(src).toMatch(/PROVIDER_RETRY_COOLDOWN/);
  });

  it("migration adds bump_provider_retry RPC and provider_retry_state table", () => {
    const sql = findMigration(/CREATE OR REPLACE FUNCTION public\.bump_provider_retry/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.provider_retry_state/);
    expect(sql).toMatch(/cooldown_until/);
  });

  it("idv-verify checks cooldown before provider call and bumps on error", () => {
    const src = readFn("idv-verify/index.ts");
    expect(src).toMatch(/checkProviderCooldown/);
    expect(src).toMatch(/recordProviderFailure/);
    expect(src).toMatch(/cooldownResponseEnvelope/);
    expect(src).toMatch(/idv\.provider_retry_cooldown_blocked/);
  });

  it("dilisense-screen checks cooldown before provider call and bumps on error", () => {
    const src = readFn("dilisense-screen/index.ts");
    expect(src).toMatch(/checkProviderCooldown/);
    expect(src).toMatch(/recordProviderFailure/);
    expect(src).toMatch(/screening\.provider_retry_cooldown_blocked/);
  });
});

describe("Batch I Fix 7 — bypass callsite drift guard", () => {
  const SCRIPT = join(ROOT, "scripts", "check-bypass-callsites.mjs");

  it("script exists", () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it("script is wired into prebuild", () => {
    const pkg = readFileSync(join(ROOT, "package.json"), "utf8");
    expect(pkg).toMatch(/check-bypass-callsites\.mjs/);
  });

  it("guard forbids isBypassEnabled without recordBypassUsage/tryBypass", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).toMatch(/isBypassEnabled/);
    expect(src).toMatch(/recordBypassUsage/);
    expect(src).toMatch(/tryBypass/);
  });
});

describe("Batch I — POI mint gates still fail-closed (regression guard)", () => {
  it("pois.ts routes KYB through tryBypass (Stage 3G production lockout applies)", () => {
    const src = readFn("pois/index.ts");
    expect(src).toMatch(/tryBypass/);
  });

  it("dilisense-screen treats provider_error as non-clear (status='provider_error')", () => {
    const src = readFn("dilisense-screen/index.ts");
    expect(src).toMatch(/status:\s*"provider_error"/);
  });
});
