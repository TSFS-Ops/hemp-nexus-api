/**
 * Batch U — Production safety, test-mode, secrets and deployment gates.
 * Static guards that ride on source code; no DB / browser required.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireSecrets } from "../../supabase/functions/_shared/require-secrets.ts";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("Batch U — production safety static guards", () => {
  // SEC-011 — bypass callsite guard still enforced (script wired into prebuild).
  it("1. test-mode production lockout remains pinned in shared helper", () => {
    const src = read("supabase/functions/_shared/test-mode-bypass.ts");
    expect(src).toMatch(/isProductionTier\s*\(/);
    expect(src).toMatch(/PRODUCTION_LOCKOUT_REASON/);
  });

  it("2. bypass callsite drift script is in prebuild", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.prebuild).toContain("check-bypass-callsites.mjs");
  });

  // SEC-012 — demo exclusion.
  it("3. AdminRevenuePanel filters demo orgs from revenue rows", () => {
    const src = read("src/components/admin/AdminRevenuePanel.tsx");
    expect(src).toMatch(/is_demo/);
    expect(src).toMatch(/demoOrgIds/);
  });

  it("4. AdminRevenuePanel CSV preamble records demo_excluded=true", () => {
    const src = read("src/components/admin/AdminRevenuePanel.tsx");
    expect(src).toMatch(/demo_excluded:\s*true/);
  });

  it("5. HealthBoard excludes demo risk items from open-incident counter", () => {
    const src = read("src/components/governance/HealthBoard.tsx");
    expect(src).toMatch(/isDemoRiskItem/);
    expect(src).toMatch(/!isDemoRiskItem\(i\)/);
  });

  // SEC-014 — seeder production refusal.
  it("6. seed-daniel-fixtures refuses production tier", () => {
    const src = read("supabase/functions/seed-daniel-fixtures/index.ts");
    expect(src).toMatch(/isProductionTier/);
    expect(src).toMatch(/SEED_PRODUCTION_REFUSED/);
  });

  it("7. unseed-daniel-fixtures refuses production tier", () => {
    const src = read("supabase/functions/unseed-daniel-fixtures/index.ts");
    expect(src).toMatch(/isProductionTier/);
    expect(src).toMatch(/SEED_PRODUCTION_REFUSED/);
  });

  it("8. production refusal writes seed.production_refused audit row", () => {
    const seed = read("supabase/functions/seed-daniel-fixtures/index.ts");
    const unseed = read("supabase/functions/unseed-daniel-fixtures/index.ts");
    expect(seed).toMatch(/seed\.production_refused/);
    expect(unseed).toMatch(/seed\.production_refused/);
  });

  // SEC-013 — secret health helper.
  it("9. require-secrets helper never logs or returns secret values", () => {
    const src = read("supabase/functions/_shared/require-secrets.ts");
    // No console.* in this helper at all.
    expect(src).not.toMatch(/console\.(log|info|warn|error|debug)/);
    // It returns missing names, never values.
    expect(src).toMatch(/missing_required/);
    expect(src).toMatch(/missing_optional/);
  });

  it("10. missing required secret produces failed status", () => {
    const r = requireSecrets({
      required: ["__BATCH_U_NEVER_SET_REQUIRED__"],
      optional: [],
      source: "batch-u-test",
    });
    expect(r.status).toBe("failed");
    expect(r.required_ok).toBe(false);
    expect(r.missing_required).toContain("__BATCH_U_NEVER_SET_REQUIRED__");
  });

  it("11. missing optional secret produces degraded (not ok, not green)", () => {
    const r = requireSecrets({
      required: [],
      optional: ["__BATCH_U_NEVER_SET_OPTIONAL__"],
      source: "batch-u-test",
    });
    expect(r.status).toBe("degraded");
    expect(r.required_ok).toBe(true);
    expect(r.missing_optional).toContain("__BATCH_U_NEVER_SET_OPTIONAL__");
  });

  // SEC-014 / OPS-008 — prebuild guards.
  it("12. check-edge-function-rpc-coverage is wired into prebuild", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.prebuild).toContain("check-edge-function-rpc-coverage.mjs");
    // Script file exists.
    expect(() => read("scripts/check-edge-function-rpc-coverage.mjs")).not.toThrow();
  });

  it("13. check-csv-export-audit is wired into prebuild", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.prebuild).toContain("check-csv-export-audit.mjs");
    expect(() => read("scripts/check-csv-export-audit.mjs")).not.toThrow();
  });

  // AUD-018 — break-glass hardening.
  it("14. break-glass requires AAL2 via assertAal2", () => {
    const src = read("supabase/functions/break-glass/index.ts");
    expect(src).toMatch(/assertAal2\s*\(/);
    expect(src).toMatch(/from\s+"\.\.\/_shared\/aal\.ts"/);
  });

  it("15. break-glass captures actor IP + user-agent in audit metadata", () => {
    const src = read("supabase/functions/break-glass/index.ts");
    expect(src).toMatch(/extractClientIp/);
    expect(src).toMatch(/extractUserAgent/);
    expect(src).toMatch(/actor_ip:\s*actorIp/);
    expect(src).toMatch(/user_agent:\s*userAgent/);
  });

  // OPS-008 — release-gate checklist sync.
  it("16. RELEASE_GATE.md references the new prebuild guards", () => {
    const src = read("RELEASE_GATE.md");
    expect(src).toMatch(/check-csv-export-audit/);
    expect(src).toMatch(/check-edge-function-rpc-coverage/);
    expect(src).toMatch(/check-bypass-callsites/);
  });
});
