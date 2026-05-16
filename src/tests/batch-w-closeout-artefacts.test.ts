/**
 * Batch W — closeout artefacts and regression lock.
 * Source-pinned proof of the handover proof pack.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const has = (rel: string) => existsSync(join(ROOT, rel));

describe("Batch W — closeout proof pack", () => {
  it("1. docs/closeout-report.md exists", () => {
    expect(has("docs/closeout-report.md")).toBe(true);
  });

  it("2. docs/deferred-policy-register.md exists", () => {
    expect(has("docs/deferred-policy-register.md")).toBe(true);
  });

  it("3. docs/launch-runbook.md exists", () => {
    expect(has("docs/launch-runbook.md")).toBe(true);
  });

  it("4. docs/handover.md exists", () => {
    expect(has("docs/handover.md")).toBe(true);
  });

  it("5. closeout report references batches A–V", () => {
    const src = read("docs/closeout-report.md");
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUV") {
      expect(src).toMatch(new RegExp(`\\|\\s*${ch}\\s*\\|`));
    }
  });

  it("6. closeout report includes source-pinned vs live-proof disclaimer", () => {
    const src = read("docs/closeout-report.md");
    expect(src.toLowerCase()).toMatch(/source-pinned/);
    expect(src.toLowerCase()).toMatch(/live (production|environment|db)/);
  });

  it("7. deferred policy register contains all known policy decisions", () => {
    const src = read("docs/deferred-policy-register.md").toLowerCase();
    const needles = [
      "document taxonomy",
      "evidence override",
      "notification template",
      "event-to-role",
      "email-log anonymisation",
      "org deletion",
      "hash-chain",
      "canonical counterparty",
      "jurisdiction mismatch",
      "break-glass",
      "auto-close",
      "public launch",
      "demo rows",
      "aal2",
    ];
    for (const n of needles) expect(src).toContain(n);
  });

  it("8. package.json includes test:regression", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["test:regression"]).toBeTruthy();
    expect(pkg.scripts["test:regression"]).toMatch(/batch-\*/);
  });

  it("9. release gate references test:regression", () => {
    expect(read("RELEASE_GATE.md")).toMatch(/test:regression/);
  });

  it("10. check-batch-suite-presence script exists and is wired into prebuild", () => {
    expect(has("scripts/check-batch-suite-presence.mjs")).toBe(true);
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.prebuild).toContain("check-batch-suite-presence.mjs");
  });

  it("11. check-release-gate-sync script exists and is wired into prebuild", () => {
    expect(has("scripts/check-release-gate-sync.mjs")).toBe(true);
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.prebuild).toContain("check-release-gate-sync.mjs");
  });

  it("12. closeout-snapshot script exists", () => {
    expect(has("scripts/closeout-snapshot.mjs")).toBe(true);
  });

  it("13. launch runbook mentions closeout_drift_summary / Closeout Drift tile", () => {
    const src = read("docs/launch-runbook.md");
    expect(src).toMatch(/closeout_drift_summary/);
    expect(src).toMatch(/Closeout Drift/);
  });

  it("14. launch runbook mentions secrets, cron heartbeats, Sentry, demo exclusion, seeders refused", () => {
    const src = read("docs/launch-runbook.md").toLowerCase();
    expect(src).toMatch(/secret/);
    expect(src).toMatch(/cron_heartbeats|cron heartbeat/);
    expect(src).toMatch(/sentry/);
    expect(src).toMatch(/demo (orgs?|excluded|exclusion)/);
    expect(src).toMatch(/seed_production_refused|seeders refused/);
  });

  it("15. handover does not claim unconditional production-ready", () => {
    const src = read("docs/handover.md");
    // Must not assert "production ready" without qualifying with release gate / runbook.
    const naked = /\bproduction[\s-]?ready\b(?![^.]*?(release gate|runbook|evidence|defensible))/i;
    expect(naked.test(src)).toBe(false);
  });
});
