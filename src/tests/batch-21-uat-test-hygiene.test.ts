import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("Batch 21 — UAT Test Hygiene", () => {
  it("quarantine ledger is present and well-formed", () => {
    const raw = readFileSync("src/tests/quarantine.json", "utf8");
    const ledger = JSON.parse(raw);
    expect(Array.isArray(ledger.files)).toBe(true);
    expect(ledger.files.length).toBeGreaterThan(0);
    const allowed = new Set([
      "stale_source_pin_replaced_by_prebuild_guard",
      "post_refactor_route_layout_update_required",
      "ci_only_requires_provisioning_secret",
      "true_regression",
      "duplicate_legacy_test",
      "obsolete_batch_test",
      "needs_manual_review",
    ]);
    for (const f of ledger.files) {
      expect(typeof f.path).toBe("string");
      expect(allowed.has(f.classification)).toBe(true);
      expect(typeof f.reason).toBe("string");
      expect(Array.isArray(f.replaced_by_guards)).toBe(true);
      expect(f.classification).not.toBe("true_regression");
      expect(existsSync(f.path)).toBe(true);
    }
  });

  it("default vitest config excludes UAT journeys and quarantine", () => {
    const cfg = readFileSync("vitest.config.ts", "utf8");
    expect(cfg).toMatch(/quarantine\.json/);
    expect(cfg).toMatch(/src\/tests\/uat\/\*\*/);
  });

  it("every UAT journey file gates with skipIf(!UAT_PROVISIONING_ENABLED)", () => {
    const dir = "src/tests/uat";
    const files = readdirSync(dir).filter((f) => /^journey-.*\.test\.ts$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src).toMatch(/describe\.skipIf\(!UAT_PROVISIONING_ENABLED\)/);
      expect(src).toMatch(/from "\.\/_ci-gate"/);
    }
  });

  it("client-facing UAT report does not contain raw failed-test counts", () => {
    const r = readFileSync("docs/registry/uat-execution-summary.md", "utf8");
    expect(r).not.toMatch(/\b\d+\s+failed\b/i);
    // Must NOT claim production-ready without qualifier
    if (/\bproduction[- ]?ready\b/i.test(r)) {
      expect(r).toMatch(/not\s+production[- ]?ready/i);
    }
  });

  it("technical appendix records the historical failure count honestly", () => {
    const r = readFileSync("docs/registry/uat-technical-appendix.md", "utf8");
    expect(r).toMatch(/246/);
    expect(r).toMatch(/quarantine\.json/);
    expect(r).toMatch(/UAT_PROVISIONING_ENABLED/);
  });

  it("package.json exposes the UAT/legacy script set", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["test:uat:local"]).toBeTruthy();
    expect(pkg.scripts["test:uat:ci"]).toBeTruthy();
    expect(pkg.scripts["test:legacy"]).toBeTruthy();
    expect(pkg.scripts.prebuild).toMatch(/check-batch-21-uat-hygiene/);
  });

  it("batch-21 evidence README exists and ends with the final status token", () => {
    const r = readFileSync("evidence/batch-21-uat-test-hygiene/README.md", "utf8");
    expect(r).toMatch(/BATCH_21_UAT_TEST_HYGIENE_COMPLETE/);
  });

  it("central evidence index references Batch 21", () => {
    const idx = readFileSync("evidence/registry-evidence-index/README.md", "utf8");
    expect(idx).toMatch(/Batch 21|batch-21-uat-test-hygiene/);
  });

  it("RELEASE_GATE.md references Batch 21", () => {
    const r = readFileSync("RELEASE_GATE.md", "utf8");
    expect(r).toMatch(/Batch 21|BATCH_21_UAT_TEST_HYGIENE_COMPLETE/);
  });
});
