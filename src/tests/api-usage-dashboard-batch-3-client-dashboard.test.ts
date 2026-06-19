/**
 * API Usage Dashboard V1 — Batch 3 (Client Own-Usage Dashboard) contract guards.
 *
 * Static source-contract tests. Pin the client-facing dashboard surface so
 * later batches cannot silently regress.
 *
 *  Goals:
 *   • /developer/usage and the stable alias /developer/api/usage both mount
 *     the existing ClientUsageDashboard (no rebuild).
 *   • /developer/* is gated by RequireAuth role=DEVELOPER_ROLES
 *     (platform_admin + org_admin). No standing api_admin / billing_admin /
 *     platform_support role was added in Batch 3.
 *   • Header makes the tenant-scoped intent explicit
 *     ("Your organisation's API usage").
 *   • The dashboard reuses the existing SECURITY DEFINER RPCs
 *     get_api_client_usage_summary + get_api_client_usage_csv_rows, gated
 *     by can_view_api_client_usage.
 *   • can_view_api_client_usage scopes org_admin viewers to api_clients of
 *     their own org (is_org_admin on c.org_id). platform_admin / api_admin /
 *     auditor remain platform-wide. Anonymous / non-admin client users are
 *     rejected.
 *   • The component emits no mutations against api_request_logs / api_keys /
 *     api_clients (writes are out of scope for the client dashboard).
 *   • Forbidden payload, secret and operational tokens are absent from the
 *     dashboard source (defence-in-depth, in addition to the RPC contract
 *     already pinned by Batch 1).
 *   • No new tables were created by Batch 3 and no RLS was weakened.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

const DASHBOARD = "src/components/developer/ClientUsageDashboard.tsx";
const DEV_CENTER = "src/pages/DeveloperCenter.tsx";
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

describe("API Usage Dashboard V1 · Batch 3 · Client Own-Usage Dashboard", () => {
  it("dashboard component file still exists (reused, not rebuilt)", () => {
    expect(exists(DASHBOARD)).toBe(true);
  });

  it("DeveloperCenter mounts /developer/usage and /developer/api/usage", () => {
    const dc = read(DEV_CENTER);
    expect(dc).toMatch(/ClientUsageDashboard/);
    expect(dc).toMatch(/path="usage"\s+element=\{<UsageView/);
    // Stable client-facing alias.
    expect(dc).toMatch(/path="api\/usage"[\s\S]{0,160}Navigate to="\/developer\/usage"/);
  });

  it("UsageView surfaces the tenant-scoped 'Your organisation's API usage' header", () => {
    const dc = read(DEV_CENTER);
    expect(dc).toMatch(/client-usage-org-header/);
    expect(dc).toMatch(/Your organisation's API usage/);
    // Tenant-isolation language is required for client-facing copy.
    expect(dc).toMatch(/Tenant-isolated|scoped to your organisation/i);
    // Sandbox/production labelling reminder.
    expect(dc).toMatch(/Sandbox/);
    expect(dc).toMatch(/Production/);
  });

  it("/developer/* is gated to DEVELOPER_ROLES (platform_admin + org_admin)", () => {
    const app = read(APP);
    expect(app).toMatch(/DEVELOPER_ROLES = \["platform_admin", "org_admin"\]/);
    expect(app).toMatch(
      /path="\/developer\/\*"[\s\S]{0,200}RequireAuth role=\{\[\.\.\.DEVELOPER_ROLES\]\}[\s\S]{0,80}<DeveloperCenter/,
    );
    // Batch 3 must not have introduced api_admin / billing_admin / platform_support
    // as standing developer route roles. They may exist elsewhere but must
    // not be wired into /developer/* in this batch.
    const devLine = app.match(/path="\/developer\/\*"[^\n]*/)?.[0] ?? "";
    expect(devLine).not.toMatch(/api_admin/);
    expect(devLine).not.toMatch(/billing_admin/);
    expect(devLine).not.toMatch(/platform_support/);
  });

  it("dashboard reuses existing SECURITY DEFINER RPCs (no rebuild)", () => {
    const src = read(DASHBOARD);
    expect(src).toMatch(/get_api_client_usage_summary/);
    expect(src).toMatch(/get_api_client_usage_csv_rows/);
    // No raw select against api_request_logs from the client surface.
    expect(src).not.toMatch(/\.from\(\s*["']api_request_logs["']\s*\)/);
  });

  it("can_view_api_client_usage scopes org_admin viewers to their own org", () => {
    expect(MIG).toMatch(/CREATE OR REPLACE FUNCTION public\.can_view_api_client_usage/);
    const fn = MIG.match(
      /CREATE OR REPLACE FUNCTION public\.can_view_api_client_usage[\s\S]*?\$\$;/,
    );
    expect(fn).not.toBeNull();
    const body = fn![0];
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/SET search_path = public/);
    expect(body).toMatch(/has_role\(_user_id,\s*'platform_admin'/);
    expect(body).toMatch(/is_org_admin\(_user_id,\s*c\.org_id\)/);
    expect(body).toMatch(/api_clients c[\s\S]*?c\.id = _api_client_id/);
    expect(MIG).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.can_view_api_client_usage\(uuid, uuid\) TO authenticated/,
    );
  });

  it("get_api_client_usage_summary enforces can_view_api_client_usage and is granted to authenticated only", () => {
    const fn = MIG.match(
      /CREATE OR REPLACE FUNCTION public\.get_api_client_usage_summary[\s\S]*?\$\$;/,
    );
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(
      /IF NOT public\.can_view_api_client_usage\(v_uid,\s*p_api_client_id\)/,
    );
    expect(fn![0]).toMatch(/RAISE EXCEPTION 'forbidden'/);
    expect(MIG).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_api_client_usage_summary[^;]*TO authenticated/,
    );
    expect(MIG).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_api_client_usage_summary[^;]*TO anon/,
    );
  });

  it("dashboard emits no mutations against api logs / keys / clients", () => {
    const raw = read(DASHBOARD);
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    for (const tbl of ["api_request_logs", "api_keys", "api_clients"]) {
      const re = new RegExp(
        String.raw`\.from\(\s*["']${tbl}["']\s*\)[\s\S]{0,200}?\.(insert|update|delete|upsert)\s*\(`,
      );
      expect(code, `client dashboard must not mutate ${tbl}`).not.toMatch(re);
    }
  });

  it("dashboard never references payload / secret / operational tokens", () => {
    const raw = read(DASHBOARD);
    // Strip comments AND the FORBIDDEN_CSV_TOKENS defensive allowlist — that
    // array names the very tokens we want to keep out of live data paths,
    // so its own contents must not trip the guard.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
      .replace(/FORBIDDEN_CSV_TOKENS\s*=\s*\[[\s\S]*?\];/g, "")
      .toLowerCase();
    for (const tok of [
      "request_body",
      "response_body",
      "key_hash",
      "bearer ",
      "stack_trace",
      "internal_note",
      "provider_credential",
    ]) {
      expect(code, `client dashboard must not reference ${tok}`).not.toContain(tok);
    }
  });


  it("CSV export column list excludes forbidden fields", () => {
    const src = read(DASHBOARD);
    const csvBlock = src.match(/CSV_COLUMNS = \[[\s\S]*?\] as const;/);
    expect(csvBlock).not.toBeNull();
    const blob = csvBlock![0].toLowerCase();
    for (const tok of [
      "request_body",
      "response_body",
      "api_key",
      "key_hash",
      "secret",
      "bearer",
      "ip_address",
      "user_agent",
      "internal_note",
    ]) {
      expect(blob, `CSV_COLUMNS must not include ${tok}`).not.toContain(tok);
    }
  });

  it("Batch 3 introduces no new tables and no RLS weakening", () => {
    // Latest migration must not create new tables or drop policies.
    const files = fs
      .readdirSync(path.join(ROOT, "supabase/migrations"))
      .filter((f) => /\.sql$/.test(f))
      .sort();
    const last = files[files.length - 1];
    const m = read("supabase/migrations/" + last);
    expect(m).not.toMatch(/CREATE TABLE/i);
    expect(m).not.toMatch(/DROP POLICY/i);
    expect(m).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
  });

  it("Batch 3 does not introduce platform_support as a standing app_role", () => {
    // platform_support is intentionally deferred — it needs an app_role enum
    // extension that Batch 3 must not perform.
    const recent = fs
      .readdirSync(path.join(ROOT, "supabase/migrations"))
      .filter((f) => /\.sql$/.test(f))
      .sort()
      .slice(-3)
      .map((f) => read("supabase/migrations/" + f))
      .join("\n");
    expect(recent).not.toMatch(/ALTER TYPE\s+(public\.)?app_role[\s\S]*ADD VALUE[\s\S]*platform_support/i);
  });
});
