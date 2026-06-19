/**
 * API Usage Alerts · RBAC tightening
 *
 *   View   = platform_admin + api_admin
 *   Manage = platform_admin only (unchanged)
 *   Auditor: removed from live alert visibility.
 *
 * Static migration + UI contract guards.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

function allMigrations(): string {
  const dir = path.join(ROOT, "supabase/migrations");
  return fs
    .readdirSync(dir)
    .map((f) => fs.readFileSync(path.join(dir, f), "utf-8"))
    .join("\n");
}
const MIG = allMigrations();

describe("api_usage_alerts · RBAC tightening", () => {
  it("creates can_view_api_usage_alerts gated to platform_admin + api_admin (no auditor)", () => {
    const fn = MIG.match(
      /CREATE OR REPLACE FUNCTION public\.can_view_api_usage_alerts[\s\S]*?\$\$;/,
    )?.[0];
    expect(fn, "can_view_api_usage_alerts not found").toBeTruthy();
    expect(fn!).toMatch(/'platform_admin'/);
    expect(fn!).toMatch(/'api_admin'/);
    expect(fn!).not.toMatch(/'auditor'/);
    expect(fn!).toMatch(/SECURITY DEFINER/);
    expect(fn!).toMatch(/SET search_path = public/);
  });

  it("creates can_manage_api_usage_alerts gated to platform_admin only", () => {
    const fn = MIG.match(
      /CREATE OR REPLACE FUNCTION public\.can_manage_api_usage_alerts[\s\S]*?\$\$;/,
    )?.[0];
    expect(fn).toBeTruthy();
    expect(fn!).toMatch(/'platform_admin'/);
    expect(fn!).not.toMatch(/'api_admin'/);
    expect(fn!).not.toMatch(/'auditor'/);
  });

  it("drops legacy monitoring SELECT policy and creates the tighter one", () => {
    expect(MIG).toMatch(
      /DROP POLICY IF EXISTS "internal monitors read api usage alerts"\s+ON public\.api_usage_alerts/i,
    );
    expect(MIG).toMatch(
      /CREATE POLICY "authorised admins read api usage alerts"[\s\S]*?ON public\.api_usage_alerts[\s\S]*?USING \(public\.can_view_api_usage_alerts\(auth\.uid\(\)\)\)/,
    );
  });

  it("api_usage_alerts still has NO authenticated insert/update/delete policies", () => {
    const forbidden = /create policy[\s\S]{0,200}on public\.api_usage_alerts[\s\S]{0,200}for (insert|update|delete)/i;
    expect(forbidden.test(MIG)).toBe(false);
  });

  it("list_api_usage_alerts is now gated by can_view_api_usage_alerts", () => {
    const all = [
      ...MIG.matchAll(
        /CREATE OR REPLACE FUNCTION public\.list_api_usage_alerts[\s\S]*?\$\$;/g,
      ),
    ];
    expect(all.length).toBeGreaterThan(0);
    const latest = all[all.length - 1][0];
    expect(latest).toMatch(/can_view_api_usage_alerts\(v_uid\)/);
  });

  it("mutation RPCs remain platform_admin-only after the tightening", () => {
    for (const name of [
      "acknowledge_api_usage_alert",
      "resolve_api_usage_alert",
      "assign_api_usage_alert",
      "add_api_usage_alert_note",
    ]) {
      const matches = [
        ...MIG.matchAll(
          new RegExp(
            `CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\$\\$;`,
            "g",
          ),
        ),
      ];
      expect(matches.length, `${name} missing`).toBeGreaterThan(0);
      const latest = matches[matches.length - 1][0];
      expect(latest).toMatch(/has_role\(\s*v_uid\s*,\s*'platform_admin'/);
      expect(latest).not.toMatch(/has_role\(\s*v_uid\s*,\s*'api_admin'/);
    }
  });

  it("AdminApiUsageAlertsPanel gates view to platform_admin + api_admin only", () => {
    const panel = read("src/components/admin/AdminApiUsageAlertsPanel.tsx");
    expect(panel).toMatch(/isPlatformAdmin\s*\|\|\s*isApiAdmin/);
    const accessGate = panel.match(/const hasAccess[\s\S]{0,200};/)?.[0] ?? "";
    expect(accessGate).not.toMatch(/auditor/);
    expect(panel).toMatch(/isPlatformAdmin && r\.status !== "resolved"/);
  });

  it("panel denial copy reflects the new role split", () => {
    const panel = read("src/components/admin/AdminApiUsageAlertsPanel.tsx");
    expect(panel).toMatch(/restricted to platform_admin and api_admin/);
  });

  it("RBAC tightening is recorded in admin_audit_logs", () => {
    expect(MIG).toMatch(/'api_usage_alert\.rbac_tightened'/);
    expect(MIG).toMatch(/'auditor_view_revoked'/);
  });

  it("DeveloperCenter and ClientUsageDashboard still have no alert surface", () => {
    const dev = read("src/pages/DeveloperCenter.tsx");
    const client = read("src/components/developer/ClientUsageDashboard.tsx");
    for (const src of [dev, client]) {
      expect(src).not.toMatch(/api_usage_alerts/);
      expect(src).not.toMatch(/AlertsPanel/);
    }
  });
});
