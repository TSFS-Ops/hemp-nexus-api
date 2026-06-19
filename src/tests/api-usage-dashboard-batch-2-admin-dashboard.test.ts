/**
 * API Usage Dashboard V1 — Batch 2 (Platform Admin Dashboard) contract guards.
 *
 * Static source-contract tests. Pin the dashboard's structural surface so
 * later batches cannot silently regress:
 *
 *   • Panel exists and is mounted into HQ as a dedicated `api-usage` sub-tab.
 *   • Stable route alias /admin/api/usage exists and is platform_admin-gated.
 *   • Panel reuses the existing internal monitoring + security panels.
 *   • Required summary card labels are present.
 *   • Production-vs-Sandbox, Billable-vs-Non-billable separation is rendered.
 *   • Access is gated to platform_admin / api_admin / auditor (existing
 *     can_access_api_monitoring helper). No client-facing roles can render
 *     the dashboard body — RequireAuth at /admin/api/usage enforces
 *     platform_admin at route level.
 *   • New RPC get_api_usage_dashboard_summary exists, is gated via
 *     can_access_api_monitoring, never SELECTs request_body or response_body,
 *     never exposes IP / user_agent / key material, and limits production
 *     errors to the recent window.
 *   • No mutation calls (insert / update / delete / upsert) are emitted by
 *     the panel.
 *   • Forbidden payload tokens (request_body / response_body / key_hash /
 *     api_key secret / user_agent / ip_address) are absent from the panel.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

const PANEL = "src/components/admin/AdminApiUsageDashboardPanel.tsx";
const HQ = "src/pages/HQ.tsx";
const APP = "src/App.tsx";

function allMigrations(): string {
  const dir = path.join(ROOT, "supabase/migrations");
  let combined = "";
  for (const f of fs.readdirSync(dir)) {
    combined += "\n" + fs.readFileSync(path.join(dir, f), "utf-8");
  }
  return combined;
}
const MIG = allMigrations();

function summaryRpc(): string {
  const m = MIG.match(
    /CREATE OR REPLACE FUNCTION public\.get_api_usage_dashboard_summary[\s\S]*?\$\$;/,
  );
  expect(m, "get_api_usage_dashboard_summary migration not found").not.toBeNull();
  return m![0];
}

describe("API Usage Dashboard V1 · Batch 2 · Platform Admin Dashboard", () => {
  it("panel component file exists", () => {
    expect(exists(PANEL)).toBe(true);
  });

  it("HQ mounts the new api-usage sub-tab and renders AdminApiUsageDashboardPanel", () => {
    const hq = read(HQ);
    expect(hq).toMatch(/AdminApiUsageDashboardPanel/);
    expect(hq).toMatch(/TabsTrigger value="api-usage"/);
    expect(hq).toMatch(/TabsContent value="api-usage"/);
    // Sub-tab is registered with useUrlTab so deep-links like
    // /hq/organisations?sub=api-usage resolve.
    expect(hq).toMatch(/useUrlTab\([^)]*"api-usage"/);
  });

  it("stable /admin/api/usage route exists and is platform_admin-gated", () => {
    const app = read(APP);
    expect(app).toMatch(/path="\/admin\/api\/usage"/);
    // Route must wrap in RequireAuth role="platform_admin".
    expect(app).toMatch(
      /path="\/admin\/api\/usage"[\s\S]{0,160}RequireAuth role="platform_admin"/,
    );
    // And it must redirect into the api-usage sub-tab.
    expect(app).toMatch(/\/hq\/organisations\?sub=api-usage/);
  });

  it("panel composes existing monitoring + security panels (no rebuild)", () => {
    const src = read(PANEL);
    expect(src).toMatch(/AdminApiMonitoringPanel/);
    expect(src).toMatch(/AdminApiSecuritySignalsPanel/);
  });

  it("panel reads only the new summary RPC + no raw api_request_logs select", () => {
    const src = read(PANEL);
    expect(src).toMatch(/get_api_usage_dashboard_summary/);
    expect(src).not.toMatch(/\.from\(\s*["']api_request_logs["']\s*\)/);
  });

  it("panel emits no mutation calls", () => {
    const src = read(PANEL);
    // Strip the comment block before scanning so doc references to
    // "no mutations" do not trip the guard.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(code).not.toMatch(/\.insert\s*\(/);
    expect(code).not.toMatch(/\.update\s*\(/);
    expect(code).not.toMatch(/\.delete\s*\(/);
    expect(code).not.toMatch(/\.upsert\s*\(/);
  });

  it("panel never references payload / secret / key-material tokens", () => {
    const src = read(PANEL).toLowerCase();
    for (const tok of [
      "request_body",
      "response_body",
      "key_hash",
      "user_agent",
      "ip_address",
    ]) {
      expect(src, `panel must not reference ${tok}`).not.toContain(tok);
    }
  });

  it("panel renders required summary card labels", () => {
    const src = read(PANEL);
    const required = [
      "Calls today",
      "Calls this month",
      "Active API clients",
      "Active production keys",
      "Keys expiring",
      "Quota-threshold clients",
      "Production · today",
      "Production · month",
      "Sandbox · today",
      "Sandbox · month",
      "Billable · today",
      "Billable · month",
      "Non-billable · today",
      "Non-billable · month",
      "Failed calls",
      "Error rate",
      "Rate-limit events",
      "p50 response",
      "p95 response",
    ];
    for (const label of required) {
      expect(src, `missing card label: ${label}`).toContain(label);
    }
  });

  it("panel separates Production/Sandbox, Billable/Non-billable, Operational and Security sections", () => {
    const src = read(PANEL);
    expect(src).toMatch(/Production vs Sandbox/);
    expect(src).toMatch(/Billable vs Non-billable/);
    expect(src).toMatch(/Operational health/);
    expect(src).toMatch(/Security signals/);
    expect(src).toMatch(/Latest production errors/);
    expect(src).toMatch(/Top endpoints/);
  });

  it("panel access gate references platform_admin / api_admin / auditor", () => {
    const src = read(PANEL);
    expect(src).toMatch(/platform_admin/);
    expect(src).toMatch(/api_admin/);
    expect(src).toMatch(/auditor/);
  });

  // ─── RPC contract ──────────────────────────────────────────────────────
  it("get_api_usage_dashboard_summary RPC exists and routes through can_access_api_monitoring", () => {
    const rpc = summaryRpc();
    expect(rpc).toMatch(/can_access_api_monitoring\(\s*v_uid\s*\)/);
    expect(rpc).toMatch(/RAISE EXCEPTION 'forbidden'/);
    expect(rpc).toMatch(/SECURITY DEFINER/);
    expect(rpc).toMatch(/SET search_path = public/);
  });

  it("RPC never SELECTs request_body or response_body", () => {
    const rpc = summaryRpc();
    expect(rpc).not.toMatch(/\brequest_body\b/);
    expect(rpc).not.toMatch(/\bresponse_body\b/);
  });

  it("RPC never exposes IP / user_agent / key material in its return shape", () => {
    const rpc = summaryRpc();
    const ret = rpc.match(/jsonb_build_object\([\s\S]*?\)\s*INTO v_result/);
    expect(ret).not.toBeNull();
    const blob = ret![0].toLowerCase();
    for (const tok of ["ip_address", "user_agent", "key_hash", "api_key"]) {
      expect(blob, `summary jsonb must not expose ${tok}`).not.toContain(tok);
    }
  });

  it("RPC restricts recent production errors to a recent window and a hard limit", () => {
    const rpc = summaryRpc();
    expect(rpc).toMatch(/environment = 'production'/);
    expect(rpc).toMatch(/error_code IS NOT NULL/);
    expect(rpc).toMatch(/LIMIT\s+20/);
    expect(rpc).toMatch(/p_now\s*-\s*interval '24 hours'/);
  });

  it("RPC top-endpoints list is capped", () => {
    const rpc = summaryRpc();
    expect(rpc).toMatch(/LIMIT\s+5/);
  });

  it("RPC is granted to authenticated only (not anon)", () => {
    expect(MIG).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_api_usage_dashboard_summary\(timestamptz\) TO authenticated/,
    );
    expect(MIG).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_api_usage_dashboard_summary[^;]*TO anon/,
    );
  });

  it("Batch 2 migration does not create new tables", () => {
    // Pull the most recent migration only.
    const last = fs
      .readdirSync(path.join(ROOT, "supabase/migrations"))
      .filter((f) => /\.sql$/.test(f))
      .sort()
      .pop()!;
    const m = read("supabase/migrations/" + last);
    expect(m).not.toMatch(/CREATE TABLE/i);
  });

  it("Batch 2 deferrals are surfaced in the UI (no silent scope creep)", () => {
    const src = read(PANEL);
    expect(src).toMatch(/Batch 2 deferrals/);
    expect(src).toMatch(/platform_support/);
  });
});
