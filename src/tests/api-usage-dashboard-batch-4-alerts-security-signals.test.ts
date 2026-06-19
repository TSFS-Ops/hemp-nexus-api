/**
 * API Usage Dashboard V1 — Batch 4 (Alerts & Suspicious Activity)
 * contract guards. Static source-contract tests.
 *
 *   • api_usage_alerts table exists and is RLS-enabled, with NO
 *     authenticated INSERT/UPDATE/DELETE policies (mutations only via
 *     SECURITY DEFINER RPCs).
 *   • Read policy gated by can_access_api_monitoring.
 *   • Sensitive-stripping trigger removes payload/key/secret/stack fields.
 *   • Mutation RPCs require platform_admin (has_role check).
 *   • RPCs are SECURITY DEFINER with explicit search_path.
 *   • detect_api_usage_alerts uses ON CONFLICT (dedupe_key) DO NOTHING.
 *   • Panel exists, embeds in AdminApiUsageDashboardPanel, never references
 *     request_body / response_body / key_hash / secret / ip_address / user_agent.
 *   • Mutations are audit-logged.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

const PANEL = "src/components/admin/AdminApiUsageAlertsPanel.tsx";
const HOST = "src/components/admin/AdminApiUsageDashboardPanel.tsx";

function allMigrations(): string {
  const dir = path.join(ROOT, "supabase/migrations");
  let combined = "";
  for (const f of fs.readdirSync(dir)) {
    combined += "\n" + fs.readFileSync(path.join(dir, f), "utf-8");
  }
  return combined;
}
const MIG = allMigrations();

describe("API Usage Dashboard V1 · Batch 4 · Alerts & Suspicious Activity", () => {
  it("panel file exists", () => {
    expect(exists(PANEL)).toBe(true);
  });

  it("panel is embedded in the platform admin dashboard host", () => {
    const host = read(HOST);
    expect(host).toMatch(/AdminApiUsageAlertsPanel/);
  });

  it("api_usage_alerts table is created", () => {
    expect(MIG).toMatch(/create table if not exists public\.api_usage_alerts/i);
  });

  it("api_usage_alerts has RLS enabled and read-only authenticated policy", () => {
    expect(MIG).toMatch(/alter table public\.api_usage_alerts enable row level security/i);
    expect(MIG).toMatch(/policy "internal monitors read api usage alerts"/i);
    // No insert/update/delete policies for authenticated on this table
    const forbiddenPolicy = /create policy[\s\S]*?on public\.api_usage_alerts[\s\S]*?for (insert|update|delete)/i;
    expect(forbiddenPolicy.test(MIG)).toBe(false);
  });

  it("sensitive-stripping trigger exists and drops payload/key/secret keys", () => {
    expect(MIG).toMatch(/api_usage_alerts_strip_sensitive/);
    expect(MIG).toMatch(/'request_body'/);
    expect(MIG).toMatch(/'response_body'/);
    expect(MIG).toMatch(/'api_key'/);
    expect(MIG).toMatch(/'key_hash'/);
    expect(MIG).toMatch(/'secret'/);
    expect(MIG).toMatch(/'stack'/);
  });

  it("detect_api_usage_alerts uses ON CONFLICT (dedupe_key) DO NOTHING for idempotency", () => {
    const fn = MIG.match(/CREATE OR REPLACE FUNCTION public\.detect_api_usage_alerts[\s\S]*?\$\$;/);
    expect(fn, "detect_api_usage_alerts not found").not.toBeNull();
    const body = fn![0];
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/SET search_path = public/);
    // Each insert path must dedupe
    const conflicts = body.match(/ON CONFLICT \(dedupe_key\) DO NOTHING/g) ?? [];
    expect(conflicts.length).toBeGreaterThanOrEqual(6);
    // Triggers covered
    expect(body).toMatch(/high_error_rate/);
    expect(body).toMatch(/internal_error_burst/);
    expect(body).toMatch(/repeated_failed_auth_10m/);
    expect(body).toMatch(/rate_limit_hits/);
    expect(body).toMatch(/production_key_expir/);
    expect(body).toMatch(/revoked_or_suspended_key_attempt/);
  });

  it("list_api_usage_alerts is gated by can_access_api_monitoring", () => {
    const fn = MIG.match(/CREATE OR REPLACE FUNCTION public\.list_api_usage_alerts[\s\S]*?\$\$;/);
    expect(fn, "list_api_usage_alerts not found").not.toBeNull();
    expect(fn![0]).toMatch(/can_access_api_monitoring/);
    expect(fn![0]).toMatch(/SECURITY DEFINER/);
  });

  it("mutation RPCs require platform_admin and audit-log", () => {
    for (const name of [
      "acknowledge_api_usage_alert",
      "resolve_api_usage_alert",
      "add_api_usage_alert_note",
      "assign_api_usage_alert",
    ]) {
      // Match the LAST occurrence so re-defined functions are tested.
      const re = new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\$\\$;`,
        "g",
      );
      const matches = MIG.match(re);
      expect(matches, `${name} not found`).not.toBeNull();
      const body = matches![matches!.length - 1];
      expect(body, `${name} must require platform_admin`).toMatch(
        /has_role\([^,]+,\s*'platform_admin'::public\.app_role\)/,
      );
      expect(body, `${name} must write admin_audit_logs`).toMatch(
        /admin_audit_logs/,
      );
      expect(body).toMatch(/SECURITY DEFINER/);
      expect(body).toMatch(/SET search_path = public/);
    }
  });

  it("assignment fields are added to api_usage_alerts and surfaced via list RPC", () => {
    expect(MIG).toMatch(/ADD COLUMN IF NOT EXISTS assigned_to uuid/i);
    expect(MIG).toMatch(/ADD COLUMN IF NOT EXISTS assigned_at timestamptz/i);
    expect(MIG).toMatch(/ADD COLUMN IF NOT EXISTS assigned_by uuid/i);
    // list_api_usage_alerts must include assignment fields in latest definition
    const fns = MIG.match(/CREATE OR REPLACE FUNCTION public\.list_api_usage_alerts[\s\S]*?\$\$;/g);
    expect(fns, "list_api_usage_alerts not found").not.toBeNull();
    const latest = fns![fns!.length - 1];
    expect(latest).toMatch(/'assigned_to'/);
    expect(latest).toMatch(/'assigned_at'/);
    expect(latest).toMatch(/p_assigned_to/);
    // Audit emissions for assign/unassign
    expect(MIG).toMatch(/api_usage_alert\.assigned/);
    expect(MIG).toMatch(/api_usage_alert\.unassigned/);
  });

  it("panel never references payload/secret/IP/user-agent fields", () => {
    const panel = read(PANEL);
    const forbidden = [
      "request_body",
      "response_body",
      "key_hash",
      "ip_address",
      "user_agent",
      "stack_trace",
    ];
    for (const tok of forbidden) {
      expect(panel.includes(tok), `panel must not reference ${tok}`).toBe(false);
    }
  });

  it("panel hides mutation controls from non-platform_admin (UI guard string present)", () => {
    const panel = read(PANEL);
    expect(panel).toMatch(/isPlatformAdmin/);
    expect(panel).toMatch(/acknowledge_api_usage_alert/);
    expect(panel).toMatch(/resolve_api_usage_alert/);
    expect(panel).toMatch(/add_api_usage_alert_note/);
  });

  it("no client-facing developer/usage surface references alerts table or RPCs", () => {
    const dev = read("src/pages/DeveloperCenter.tsx");
    expect(dev.includes("api_usage_alerts")).toBe(false);
    expect(dev.includes("list_api_usage_alerts")).toBe(false);
    expect(dev.includes("AdminApiUsageAlertsPanel")).toBe(false);
  });
});
