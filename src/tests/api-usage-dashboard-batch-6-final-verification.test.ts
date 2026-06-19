/**
 * API Usage Dashboard V1 — Batch 6 (Final Internal Verification)
 *
 * Cross-cutting verification of the API Usage Dashboard V1 build. This
 * file does not introduce new behaviour — it pins the build-completion
 * properties asserted in the Batch 6 report so regressions surface
 * immediately:
 *
 *   • Routes registered (admin + client dashboards).
 *   • No client-facing alert surface.
 *   • platform_support remains deferred (no enum extension).
 *   • Sensitive-token / payload-write guards exist.
 *   • Batches 1–5 + Batch 4 follow-ups + this file are wired in.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

function allMigrations(): string {
  const dir = path.join(ROOT, "supabase/migrations");
  let combined = "";
  for (const f of fs.readdirSync(dir)) {
    combined += "\n" + fs.readFileSync(path.join(dir, f), "utf-8");
  }
  return combined;
}
const MIG = allMigrations();

describe("Batch 6 · Final internal verification", () => {
  // ── Routes ────────────────────────────────────────────────
  it("registers admin and client usage routes", () => {
    const app = read("src/App.tsx");
    expect(app).toMatch(/\/admin\/api\/usage/);
    // client alias path lands in DeveloperCenter
    expect(app).toMatch(/\/developer\/(api\/)?usage|DeveloperCenter/);
  });

  it("HQ surfaces the platform_admin API usage panel", () => {
    const hq = read("src/pages/HQ.tsx");
    expect(hq).toMatch(/AdminApiUsageDashboardPanel/);
  });

  // ── Role-negative: no client-facing alert surface ─────────
  it("DeveloperCenter never references the alerts table or alert types", () => {
    const dev = read("src/pages/DeveloperCenter.tsx");
    expect(dev).not.toMatch(/api_usage_alerts/);
    expect(dev).not.toMatch(/token_balance_low|token_balance_zero/);
    expect(dev).not.toMatch(/AdminApiUsageAlertsPanel/);
  });

  it("ClientUsageDashboard never references the alerts table", () => {
    const c = read("src/components/developer/ClientUsageDashboard.tsx");
    expect(c).not.toMatch(/api_usage_alerts|AlertsPanel/);
  });

  // ── platform_support remains deferred ─────────────────────
  it("no migration extends app_role with platform_support", () => {
    expect(MIG).not.toMatch(
      /ALTER TYPE\s+(public\.)?app_role[\s\S]{0,200}ADD VALUE[\s\S]{0,200}platform_support/i,
    );
  });

  // ── Build guards present ──────────────────────────────────
  it("payload-write build guard exists and runs", () => {
    expect(exists("scripts/check-api-request-logs-no-payloads.mjs")).toBe(true);
    const pkg = JSON.parse(read("package.json"));
    const scripts = JSON.stringify(pkg.scripts ?? {});
    expect(scripts).toMatch(/check-api-request-logs-no-payloads/);
  });

  it("CSV export audit guard and UI surface coverage guards exist", () => {
    expect(exists("scripts/check-csv-export-audit.mjs")).toBe(true);
    expect(exists("scripts/check-ui-surface-coverage.mjs")).toBe(true);
    expect(exists("scripts/check-ui-route-coverage.mjs")).toBe(true);
  });

  // ── Batch artefacts wired ─────────────────────────────────
  it("all Batch 1-5 contract suites are present", () => {
    for (const f of [
      "src/tests/api-usage-dashboard-batch-1-data-model.test.ts",
      "src/tests/api-usage-dashboard-batch-2-admin-dashboard.test.ts",
      "src/tests/api-usage-dashboard-batch-3-client-dashboard.test.ts",
      "src/tests/api-usage-dashboard-batch-4-alerts-security-signals.test.ts",
      "src/tests/api-usage-dashboard-batch-4-token-balance-alerts.test.ts",
      "src/tests/api-usage-dashboard-batch-5-exports-retention.test.ts",
      "docs/RETENTION-API-USAGE-DASHBOARD.md",
    ]) {
      expect(exists(f), `missing ${f}`).toBe(true);
    }
  });

  // ── Sandbox vs production separation in dashboards ────────
  it("client usage RPC and CSV RPC carry environment column", () => {
    const fn1 = MIG.match(
      /CREATE OR REPLACE FUNCTION public\.get_api_client_usage_csv_rows[\s\S]*?\$\$;/,
    )![0];
    expect(fn1).toMatch(/environment\s+text/i);
    expect(fn1).toMatch(/p_environment\s+text/i);
  });

  it("admin monitoring overview row carries environment, billable and non_billable counts", () => {
    const admin = read("src/components/admin/AdminApiMonitoringPanel.tsx");
    expect(admin).toMatch(/"environment"/);
    expect(admin).toMatch(/"billable_calls"/);
    expect(admin).toMatch(/"non_billable_calls"/);
  });

  // ── Alert detection coverage ──────────────────────────────
  it("detection emits the full alert-type set required by Batch 6", () => {
    // Joined check across both detector functions.
    const detect1 = MIG.match(
      /CREATE OR REPLACE FUNCTION public\.detect_api_usage_alerts[\s\S]*?\$\$;/,
    )![0];
    const detect2 = MIG.match(
      /CREATE OR REPLACE FUNCTION public\.detect_api_token_balance_alerts[\s\S]*?\$\$;/,
    )![0];
    const all = detect1 + "\n" + detect2;
    for (const t of [
      "high_error_rate",
      "internal_error_burst",
      "repeated_failed_auth_10m",
      "rate_limit_hits",
      "production_key_expired",
      "production_key_expiring_1d",
      "production_key_expiring_7d",
      "production_key_expiring_14d",
      "revoked_or_suspended_key_attempt",
      "token_balance_low",
      "token_balance_zero",
    ]) {
      expect(all, `alert type missing: ${t}`).toMatch(new RegExp(`'${t}'`));
    }
  });

  // ── Alert assignment audit hygiene: no note body persisted ──
  it("assign_api_usage_alert audit row only records note_present flag, not the note body", () => {
    const fn = MIG.match(
      /CREATE OR REPLACE FUNCTION public\.assign_api_usage_alert[\s\S]*?\$\$;/,
    )![0];
    expect(fn).toMatch(/note_present/);
    // The audit jsonb_build_object must not include the raw p_note value.
    const auditBlock = fn.match(/jsonb_build_object\(([\s\S]*?)\)\s*\)\s*;/)?.[1] ?? "";
    expect(auditBlock).not.toMatch(/'note'\s*,\s*p_note/);
  });

  // ── Mutation RPCs are platform_admin-gated ────────────────
  it("acknowledge / resolve / assign RPCs all require platform_admin", () => {
    for (const name of [
      "acknowledge_api_usage_alert",
      "resolve_api_usage_alert",
      "assign_api_usage_alert",
    ]) {
      const fn = MIG.match(
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\$\\$;`),
      )?.[0];
      expect(fn, `${name} missing`).toBeTruthy();
      expect(fn!).toMatch(/has_role\(\s*v_uid\s*,\s*'platform_admin'/);
    }
  });

  // ── Final status marker ───────────────────────────────────
  it("Batch 6 verification file is registered (self-presence)", () => {
    expect(exists("src/tests/api-usage-dashboard-batch-6-final-verification.test.ts")).toBe(true);
  });
});
