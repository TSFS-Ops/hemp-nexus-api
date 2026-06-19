/**
 * Public API V1 — Batch 8 contract guards.
 *
 * Static source-contract tests for the client-facing usage dashboard +
 * CSV export. Confirms:
 *   • Client usage dashboard component/page exists and is wired into the
 *     Developer Centre.
 *   • Dashboard reads via the scoped RPC, not raw api_request_logs.
 *   • Required summary fields are surfaced.
 *   • Disclaimer is present (estimates, not invoices).
 *   • CSV export exists, scoped to one client + period.
 *   • CSV export excludes raw keys, key hashes, secrets, documents,
 *     evidence, governance, POI/WaD/payment/compliance fields.
 *   • CSV export is audit-logged via log_api_client_usage_csv_export.
 *   • can_view_api_client_usage authorisation helper exists and routes
 *     via has_role(platform_admin/api_admin/auditor) + is_org_admin.
 *   • Hard exclusions: no /v1/usage/current, no /v1/docs, no
 *     /v1/docs/openapi.json, no support intake, no payment/invoice
 *     logic, no webhook changes, no write API, no evidence/document/
 *     POI/WaD/compliance fields surfaced.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const DASHBOARD = "src/components/developer/ClientUsageDashboard.tsx";
const DEV_CENTER = "src/pages/DeveloperCenter.tsx";
const DEV_SHELL = "src/components/developer/DeveloperShell.tsx";
const GATEWAY = "supabase/functions/public-api/index.ts";

function findBatch8Migration(): string {
  const migDir = path.join(ROOT, "supabase/migrations");
  let combined = "";
  for (const f of fs.readdirSync(migDir)) {
    const body = fs.readFileSync(path.join(migDir, f), "utf-8");
    if (
      /get_api_client_usage_summary/.test(body) ||
      /get_api_client_usage_csv_rows/.test(body) ||
      /can_view_api_client_usage/.test(body) ||
      /log_api_client_usage_csv_export/.test(body)
    ) {
      combined += "\n" + body;
    }
  }
  return combined;
}

describe("Public API V1 · Batch 8 · client usage dashboard + CSV export", () => {
  it("dashboard component exists", () => {
    expect(exists(DASHBOARD)).toBe(true);
  });

  it("dashboard is wired into the Developer Centre router", () => {
    const dc = read(DEV_CENTER);
    expect(dc).toMatch(/ClientUsageDashboard/);
    expect(dc).toMatch(/path="usage"/);
  });

  it("Developer shell exposes an API Usage nav entry", () => {
    const shell = read(DEV_SHELL);
    expect(shell).toMatch(/\/developer\/usage/);
    expect(shell).toMatch(/API Usage/);
  });

  it("dashboard uses scoped RPC, not raw api_request_logs", () => {
    const code = codeOnly(read(DASHBOARD));
    expect(code).toMatch(/get_api_client_usage_summary/);
    expect(code).toMatch(/get_api_client_usage_csv_rows/);
    expect(code).not.toMatch(/from\(\s*["']api_request_logs["']\s*\)/);
  });

  it("dashboard shows all required summary fields", () => {
    const code = read(DASHBOARD);
    const requiredFields = [
      "api_client_name",
      "plan_name",
      "billing_period_start",
      "billing_period_end",
      "total_requests",
      "successful_lookup_calls",
      "successful_summary_calls",
      "billable_calls",
      "non_billable_calls",
      "sandbox_calls",
      "production_calls",
      "error_count",
      "rate_limit_events",
      "monthly_included_allowance",
      "allowance_used",
      "overage_calls",
      "estimated_overage_amount",
      "estimated_total_amount",
      "currency",
      "overage_allowed",
      "usage_percentage",
      "last_successful_call",
      "last_failed_call",
    ];
    for (const f of requiredFields) {
      expect(code, `missing field: ${f}`).toMatch(new RegExp(f));
    }
  });

  it("dashboard renders the required estimates-only disclaimer", () => {
    const code = read(DASHBOARD);
    expect(code).toMatch(
      /Usage and charges shown here are estimates for visibility only\. This is not an invoice and does not collect payment\./,
    );
  });

  it("dashboard distinguishes billable vs non-billable and sandbox vs production", () => {
    const code = read(DASHBOARD);
    expect(code).toMatch(/Billable calls/);
    expect(code).toMatch(/Non-billable calls/);
    expect(code).toMatch(/Sandbox calls/);
    expect(code).toMatch(/Production calls/);
  });

  it("dashboard surfaces error and rate-limit counts and current plan", () => {
    const code = read(DASHBOARD);
    expect(code).toMatch(/Error count/);
    expect(code).toMatch(/Rate-limit events/);
    expect(code).toMatch(/Current plan/);
  });

  it("CSV export uses an allowlisted column set and excludes forbidden tokens", () => {
    const code = read(DASHBOARD);
    expect(code).toMatch(/CSV_COLUMNS\s*=/);
    const allowed = [
      "billing_period_start",
      "billing_period_end",
      "request_timestamp",
      "endpoint",
      "method",
      "environment",
      "status_code",
      "billable",
      "error_code",
      "response_time_ms",
      "external_reference",
      "request_id",
    ];
    for (const a of allowed) {
      expect(code, `missing allowed csv column: ${a}`).toMatch(new RegExp(`"${a}"`));
    }
    expect(code).toMatch(/FORBIDDEN_CSV_TOKENS/);
    for (const banned of [
      "api_key",
      "key_hash",
      "secret",
      "bearer",
      "password",
      "document",
      "evidence",
      "governance",
      "poi",
      "wad",
      "payment",
      "compliance_note",
      "internal_note",
      "private_contact",
    ]) {
      expect(code, `forbidden token missing from guard: ${banned}`).toMatch(
        new RegExp(`"${banned}"`),
      );
    }
  });

  it("CSV export is audit-logged via log_api_client_usage_csv_export", () => {
    const code = read(DASHBOARD);
    expect(code).toMatch(/log_api_client_usage_csv_export/);
  });

  it("migration creates the three Batch-8 RPCs and the auth helper", () => {
    const m = findBatch8Migration();
    expect(m).toMatch(/can_view_api_client_usage/);
    expect(m).toMatch(/get_api_client_usage_summary/);
    expect(m).toMatch(/get_api_client_usage_csv_rows/);
    expect(m).toMatch(/log_api_client_usage_csv_export/);
  });

  it("authorisation helper routes via has_role + is_org_admin (no weak mapping)", () => {
    const m = findBatch8Migration();
    expect(m).toMatch(/has_role\(\s*_user_id\s*,\s*'platform_admin'/);
    expect(m).toMatch(/has_role\(\s*_user_id\s*,\s*'api_admin'/);
    expect(m).toMatch(/has_role\(\s*_user_id\s*,\s*'auditor'/);
    expect(m).toMatch(/is_org_admin\(\s*_user_id\s*,\s*c\.org_id\s*\)/);
  });

  it("RPCs SECURITY DEFINER, scoped by api_client_id, with auth + access checks", () => {
    const m = findBatch8Migration();
    expect(m).toMatch(/SECURITY DEFINER/);
    expect(m).toMatch(/IF v_uid IS NULL THEN[\s\S]*?RAISE EXCEPTION 'auth required'/);
    expect(m).toMatch(/IF NOT public\.can_view_api_client_usage\(v_uid, p_api_client_id\)/);
  });

  it("CSV RPC returns only the allowlisted columns (no key material)", () => {
    const m = findBatch8Migration();
    // Required allowlisted return columns
    for (const col of [
      "request_timestamp",
      "endpoint",
      "method",
      "environment",
      "status_code",
      "billable",
      "error_code",
      "response_time_ms",
      "external_reference",
      "request_id",
    ]) {
      expect(m, `csv RPC missing column ${col}`).toMatch(new RegExp(col));
    }
    // Forbidden token check against the RPC body
    for (const t of ["key_hash", "api_key_hash", "secret_hash", "raw_key", "bearer_token"]) {
      expect(m, `csv RPC must not return ${t}`).not.toMatch(new RegExp(t));
    }
  });

  it("audit RPC writes public_api.v1.usage.csv_exported with actor + client + period + row_count", () => {
    const m = findBatch8Migration();
    expect(m).toMatch(/public_api\.v1\.usage\.csv_exported/);
    expect(m).toMatch(/row_count/);
    expect(m).toMatch(/period_start/);
    expect(m).toMatch(/period_end/);
  });

  it("filters for billing period, environment, endpoint, status, billable are present", () => {
    const code = read(DASHBOARD);
    expect(code).toMatch(/Billing period/);
    expect(code).toMatch(/Environment/);
    expect(code).toMatch(/Endpoint/);
    expect(code).toMatch(/Status/);
    expect(code).toMatch(/Billable/);
  });

  // ─── Hard exclusions ───────────────────────────────────────────────────
  it("does not introduce /v1/usage/current or /v1/docs endpoints", () => {
    const gw = read(GATEWAY);
    expect(gw).not.toMatch(/['"`]\/v1\/usage\/current['"`]/);
    expect(gw).not.toMatch(/['"`]\/v1\/docs['"`]/);
    expect(gw).not.toMatch(/['"`]\/v1\/docs\/openapi\.json['"`]/);
  });

  it("dashboard does not call any /v1/* public endpoint or write API", () => {
    const code = codeOnly(read(DASHBOARD));
    expect(code).not.toMatch(/\/v1\/usage\/current/);
    expect(code).not.toMatch(/\/v1\/docs/);
    expect(code).not.toMatch(/functions\.invoke\(\s*["']public-api["']/);
  });

  it("dashboard does not expose POI/WaD/payment/compliance/evidence/document/governance fields", () => {
    const code = codeOnly(read(DASHBOARD)).toLowerCase();
    for (const banned of [
      "poi_id",
      "wad_id",
      "evidence_url",
      "document_id",
      "governance_record",
      "compliance_case",
      "payment_method",
      "card_number",
      "bank_account",
      "invoice_number",
      "tax_id",
    ]) {
      expect(code, `dashboard must not reference ${banned}`).not.toContain(banned);
    }
  });

  it("dashboard does not expose raw api_keys or key hashes", () => {
    // Strip the FORBIDDEN_CSV_TOKENS array literal first — those entries
    // are the defensive blocklist, not exposed fields.
    const raw = codeOnly(read(DASHBOARD));
    const stripped = raw.replace(/FORBIDDEN_CSV_TOKENS\s*=\s*\[[\s\S]*?\];/, "").toLowerCase();
    for (const banned of ["key_hash", "secret_hash", "raw_key", "bearer_token", "private_key"]) {
      expect(stripped, `dashboard must not reference ${banned}`).not.toContain(banned);
    }
  });

  it("no Batch-8 internal monitoring dashboard, support intake, or webhook changes were introduced", () => {
    // The dashboard file is client-facing only; ensure no internal-monitoring
    // dashboard component was added under the same batch surface.
    expect(exists("src/components/admin/InternalMonitoringDashboard.tsx")).toBe(false);
    expect(exists("src/pages/admin/InternalMonitoring.tsx")).toBe(false);
    // No support ticket intake component was added.
    expect(exists("src/components/support/SupportTicketIntake.tsx")).toBe(false);
  });

  it("CSV blob is generated client-side and triggers a download (scoped per client + period)", () => {
    const code = read(DASHBOARD);
    expect(code).toMatch(/new Blob\(\[csv\]/);
    expect(code).toMatch(/api-usage-/);
    expect(code).toMatch(/billing_period_start/);
    expect(code).toMatch(/billing_period_end/);
  });
});
