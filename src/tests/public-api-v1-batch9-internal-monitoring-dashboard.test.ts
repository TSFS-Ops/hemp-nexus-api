/**
 * Public API V1 — Batch 9 contract guards.
 *
 * Static source-contract tests for the INTERNAL operational monitoring
 * dashboard. Confirms:
 *   • Internal monitoring panel exists and is mounted in HQ.
 *   • Access gate `can_access_api_monitoring` restricts to
 *     platform_admin / api_admin / auditor.
 *   • Overview is served by `get_api_monitoring_overview`, not via raw
 *     unfiltered logs in the UI.
 *   • All required fields are surfaced (latency incl. p95, error count,
 *     top error, rate-limit + monthly-limit events, key counts and next
 *     expiry, IP allowlist exception status, last calls, status label).
 *   • Operational status labels are defined and do NOT imply compliance.
 *   • Filters exist for period, environment, client, status, plan,
 *     threshold and errors.
 *   • CSV export is summary-only, platform_admin only, audit-logged via
 *     `log_api_monitoring_csv_export`, and defensively rejects forbidden
 *     column tokens.
 *   • Hard exclusions: no /v1/docs, no /v1/docs/openapi.json, no support
 *     ticket intake, no payment/invoice/tax logic, no PayFast/Paystack
 *     changes, no webhook changes, no write API, no evidence/document/
 *     POI/WaD/payment/compliance fields, no raw API key or key-hash
 *     exposure.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const PANEL = "src/components/admin/AdminApiMonitoringPanel.tsx";
const HQ = "src/pages/HQ.tsx";
const GATEWAY = "supabase/functions/public-api/index.ts";

function findBatch9Migration(): string {
  const dir = path.join(ROOT, "supabase/migrations");
  let combined = "";
  for (const f of fs.readdirSync(dir)) {
    const body = fs.readFileSync(path.join(dir, f), "utf-8");
    if (
      /get_api_monitoring_overview/.test(body) ||
      /can_access_api_monitoring/.test(body) ||
      /log_api_monitoring_csv_export/.test(body)
    ) {
      combined += "\n" + body;
    }
  }
  return combined;
}

describe("Public API V1 · Batch 9 · internal monitoring dashboard", () => {
  it("internal monitoring panel exists", () => {
    expect(exists(PANEL)).toBe(true);
  });

  it("panel is mounted in HQ under Organisations → API Monitoring", () => {
    const hq = read(HQ);
    expect(hq).toMatch(/AdminApiMonitoringPanel/);
    expect(hq).toMatch(/api-monitoring/);
  });

  it("panel is clearly internal (not client-facing)", () => {
    const src = read(PANEL);
    expect(/Internal/i.test(src)).toBe(true);
  });

  it("panel reads via secure RPC, not raw api_request_logs", () => {
    const src = read(PANEL);
    expect(src).toMatch(/get_api_monitoring_overview/);
    expect(/from\(['"`]api_request_logs/i.test(src)).toBe(false);
  });

  // ─── Access model ──────────────────────────────────────────────────
  it("access gate function exists with correct roles", () => {
    const mig = findBatch9Migration();
    expect(mig).toMatch(/can_access_api_monitoring/);
    expect(mig).toMatch(/has_role\(\s*_user_id\s*,\s*'platform_admin'/);
    expect(mig).toMatch(/has_role\(\s*_user_id\s*,\s*'api_admin'/);
    expect(mig).toMatch(/has_role\(\s*_user_id\s*,\s*'auditor'/);
  });

  it("overview RPC enforces auth + access gate", () => {
    const mig = findBatch9Migration();
    expect(mig).toMatch(/get_api_monitoring_overview/);
    expect(mig).toMatch(/can_access_api_monitoring\(v_uid\)/);
    expect(mig).toMatch(/SECURITY DEFINER/);
    expect(mig).toMatch(/SET search_path = public/);
  });

  it("UI blocks non-eligible roles", () => {
    const src = read(PANEL);
    expect(src).toMatch(/hasAccess/);
    expect(src).toMatch(/Internal monitoring is\s+restricted/);
  });

  // ─── Required fields ───────────────────────────────────────────────
  const requiredJson = [
    "api_client_name",
    "environment",
    "plan_name",
    "request_count",
    "successful_lookup_calls",
    "successful_summary_calls",
    "billable_calls",
    "non_billable_calls",
    "allowance",
    "allowance_used",
    "allowance_used_pct",
    "overage_calls",
    "estimated_overage_amount",
    "estimated_total_amount",
    "success_rate_pct",
    "error_count",
    "top_error_code",
    "avg_latency_ms",
    "p95_latency_ms",
    "rate_limit_events",
    "monthly_limit_events",
    "failed_auth_attempts",
    "key_count",
    "active_key_count",
    "suspended_revoked_key_count",
    "expired_key_count",
    "next_key_expiry",
    "key_expiry_warning",
    "ip_allowlist_exception_active",
    "last_successful_call",
    "last_failed_call",
    "open_support_tickets",
    "status_label",
  ];
  it("overview RPC emits all required dashboard fields", () => {
    const mig = findBatch9Migration();
    for (const k of requiredJson) {
      expect(mig.includes(`'${k}'`)).toBe(true);
    }
  });

  it("p95 latency is computed via percentile_cont", () => {
    const mig = findBatch9Migration();
    expect(mig).toMatch(/percentile_cont\(0\.95\)/);
  });

  it("average latency is computed", () => {
    const mig = findBatch9Migration();
    expect(mig).toMatch(/AVG\(l\.response_time_ms\)/i);
  });

  it("support-ticket field is deferred (no support intake)", () => {
    const mig = findBatch9Migration();
    expect(mig).toMatch(/'open_support_tickets',\s*NULL/);
    expect(mig).toMatch(/deferred_no_support_ticket_table/);
  });

  // ─── Status label semantics ────────────────────────────────────────
  const statusLabels = [
    "healthy",
    "warning",
    "blocked",
    "suspended",
    "no_recent_traffic",
    "needs_attention",
  ];
  it("operational status labels are defined", () => {
    const mig = findBatch9Migration();
    for (const s of statusLabels) {
      expect(mig.includes(`'${s}'`)).toBe(true);
    }
  });

  it("status labels do not imply compliance clearance", () => {
    const src = read(PANEL);
    expect(/do not imply compliance clearance/i.test(src)).toBe(true);
  });

  // ─── Filters ───────────────────────────────────────────────────────
  it("dashboard exposes required filters", () => {
    const src = codeOnly(read(PANEL));
    expect(src).toMatch(/periodStart/);
    expect(src).toMatch(/environment/);
    expect(src).toMatch(/statusLabel/);
    expect(src).toMatch(/apiClientId/);
    expect(src).toMatch(/planId/);
    expect(src).toMatch(/minUsagePct/);
    expect(src).toMatch(/errorsOnly/);
  });

  // ─── CSV export ────────────────────────────────────────────────────
  it("CSV export is platform_admin only", () => {
    const src = read(PANEL);
    expect(src).toMatch(/Only platform_admin can export/);
    const mig = findBatch9Migration();
    expect(mig).toMatch(/log_api_monitoring_csv_export/);
    expect(mig).toMatch(/has_role\(v_uid,\s*'platform_admin'/);
  });

  it("CSV export is audit-logged before download", () => {
    const src = read(PANEL);
    expect(src).toMatch(/log_api_monitoring_csv_export/);
    expect(src).toMatch(/Audit log failed; export aborted/);
  });

  it("CSV export defensively forbids raw-log/secret tokens", () => {
    const src = read(PANEL);
    const forbidden = [
      "key_hash",
      "api_key",
      "secret",
      "request_body",
      "response_body",
      "ip_address",
      "user_agent",
      "document",
      "evidence",
      "governance",
      "poi",
      "wad",
      "payment",
      "compliance",
    ];
    for (const t of forbidden) {
      expect(src.includes(`"${t}"`)).toBe(true);
    }
    expect(src).toMatch(/CSV export blocked: forbidden column/);
  });

  it("CSV export is summary rows only (no raw log row columns)", () => {
    const src = read(PANEL);
    // headers array must NOT include raw-log identifiers
    expect(/headers\s*=\s*\[[\s\S]*?\]/.test(src)).toBe(true);
    const headersBlock = (src.match(/const headers\s*=\s*\[([\s\S]*?)\];/) || [])[1] || "";
    expect(/request_body|response_body|key_hash|ip_address|user_agent|request_id/i.test(headersBlock)).toBe(false);
  });

  // ─── Hard exclusions ───────────────────────────────────────────────
  it("no /v1/docs or /v1/docs/openapi.json gateway endpoint introduced", () => {
    if (!exists(GATEWAY)) return;
    const gw = read(GATEWAY);
    expect(/\/v1\/docs/.test(gw)).toBe(false);
    expect(/openapi\.json/.test(gw)).toBe(false);
  });

  it("no support ticket intake table/route introduced in Batch 9", () => {
    const mig = findBatch9Migration();
    expect(/create\s+table\s+public\.support_tickets/i.test(mig)).toBe(false);
    const src = read(PANEL);
    expect(/support[_-]?ticket(s)?[_-]?intake/i.test(src)).toBe(false);
  });

  it("no payment/invoice/tax/PayFast/Paystack/webhook/write logic in Batch 9", () => {
    const mig = findBatch9Migration();
    const banned = [
      /payment_intent/i,
      /invoice/i,
      /tax_invoice/i,
      /payfast/i,
      /paystack/i,
      /webhook/i,
      /\bINSERT INTO public\.api_request_logs\b/i,
    ];
    for (const b of banned) {
      expect(b.test(mig)).toBe(false);
    }
  });

  it("no new public-schema tables in Batch 9", () => {
    const mig = findBatch9Migration();
    expect(/create\s+table\s+public\./i.test(mig)).toBe(false);
  });

  it("no raw API key or key-hash exposure in panel or overview RPC", () => {
    const mig = findBatch9Migration();
    expect(/key_hash/i.test(mig)).toBe(false);
    const src = read(PANEL);
    expect(/key_hash/i.test(src)).toBe(false);
  });

  it("no POI/WaD/payment/credit/compliance fields exposed", () => {
    const mig = findBatch9Migration();
    const banned = [
      /\bpois\b/i,
      /\bwads\b/i,
      /collapse_ledger/i,
      /compliance_holds/i,
      /token_ledger/i,
      /governance_documents/i,
      /vault_documents/i,
    ];
    for (const b of banned) {
      expect(b.test(mig)).toBe(false);
    }
  });
});
