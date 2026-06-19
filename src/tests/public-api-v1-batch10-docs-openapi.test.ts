/**
 * Public API V1 — Batch 10 contract guards.
 *
 * Static source-contract tests for the public-facing documentation and
 * OpenAPI specification. Confirms:
 *   • GET /v1/docs and GET /v1/docs/openapi.json are dispatched by the
 *     single public-api gateway entry.
 *   • Both routes go through handleV1 with the api:status_read scope.
 *   • Both routes are non-billable (no ctx.billable = true).
 *   • Both routes are not in the countable-endpoint set (no monthly burn).
 *   • A single source-of-truth module feeds both the readable docs and
 *     the OpenAPI spec.
 *   • The OpenAPI spec carries title "Izenzo Public API V1", X-API-Key
 *     security scheme, required X-Izenzo-Environment header, optional
 *     X-External-Reference, the canonical error envelope, every
 *     currently-available endpoint, the legal warning and the
 *     not-an-approval/clearance/payment-guarantee language.
 *   • The readable docs include the exact legal warning, the "what the
 *     API does NOT do" list, sandbox-vs-production separation, scopes,
 *     rate limits, monthly allowance, estimate-only billing visibility,
 *     and the full canonical error catalogue.
 *   • Hard exclusions: no support-intake, no payment/invoice logic, no
 *     webhook changes, no write API, no evidence/document/POI/WaD/
 *     compliance fields, no raw API key or key-hash exposure in docs.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const GATEWAY = "supabase/functions/public-api/index.ts";
const SPEC_MODULE = "supabase/functions/_shared/public-api-v1-openapi.ts";
const USAGE_MODULE = "supabase/functions/_shared/public-api-v1-usage.ts";

const LEGAL_WARNING =
  "API responses provide Izenzo status and risk signals based on available " +
  "records at the time of the request. They are not legal advice, not a " +
  "bank-payment guarantee, not a compliance clearance, not a credit " +
  "decision, and not a substitute for the client’s own approval process " +
  "unless expressly agreed in writing. No API response creates a POI, WaD, " +
  "verified status, or binding transaction approval by itself.";

const REQUIRED_ERROR_CODES = [
  "invalid_api_key", "expired_api_key", "insufficient_scope", "suspended_key",
  "revoked_key", "missing_required_field", "invalid_country",
  "unsupported_country", "invalid_identifier_format", "rate_limit_exceeded",
  "monthly_limit_reached", "sandbox_record_only", "production_access_required",
  "no_match", "multiple_possible_matches", "provider_unavailable", "timeout",
  "internal_error",
];

const AVAILABLE_PATHS = [
  "/v1/health",
  "/v1/status",
  "/v1/counterparty/lookup",
  "/v1/counterparty/{id}/summary",
  "/v1/docs",
  "/v1/docs/openapi.json",
];

describe("Public API V1 · Batch 10 · docs and OpenAPI", () => {
  it("single source-of-truth spec module exists", () => {
    expect(exists(SPEC_MODULE)).toBe(true);
  });

  it("gateway dispatches GET /v1/docs and GET /v1/docs/openapi.json via handleV1", () => {
    const gw = codeOnly(read(GATEWAY));
    expect(gw).toMatch(/['"`]\/v1\/docs['"`]/);
    expect(gw).toMatch(/['"`]\/v1\/docs\/openapi\.json['"`]/);
    // Both go through the shared handleV1 wrapper (same gateway pipeline).
    expect((gw.match(/handleV1\s*\(/g) || []).length).toBeGreaterThanOrEqual(6);
    // Both routes pull from the source-of-truth module.
    expect(gw).toMatch(/buildOpenApiSpec/);
    expect(gw).toMatch(/buildReadableDocsHtml/);
  });

  it("docs routes require api:status_read scope", () => {
    const gw = read(GATEWAY);
    // The V1_DOCS_SCOPE constant aliases the status_read scope.
    expect(gw).toMatch(/V1_DOCS_SCOPE\s*=\s*V1_SCOPE/);
    // and V1_SCOPE is api:status_read
    expect(gw).toMatch(/V1_SCOPE\s*=\s*["']api:status_read["']/);
  });

  it("docs routes are explicitly non-billable", () => {
    const gw = codeOnly(read(GATEWAY));
    // Both handlers set ctx.billable = false explicitly.
    const docsBlock = gw.slice(gw.indexOf("/v1/docs/openapi.json"));
    expect(docsBlock).toMatch(/ctx\.billable\s*=\s*false/);
    const readableBlock = gw.slice(gw.indexOf("/v1/docs\""), gw.indexOf("/v1/counterparty/lookup")) +
      gw.slice(gw.indexOf("'/v1/docs'") >= 0 ? gw.indexOf("'/v1/docs'") : 0);
    // Belt-and-braces: there must be at least two `ctx.billable = false`
    // assignments — one per docs route.
    const occurrences = (gw.match(/ctx\.billable\s*=\s*false/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
    void readableBlock;
  });

  it("docs and openapi paths are NOT in the countable-endpoint set", () => {
    const usage = read(USAGE_MODULE);
    expect(usage).not.toMatch(/['"`]\/v1\/docs['"`]/);
    expect(usage).not.toMatch(/['"`]\/v1\/docs\/openapi\.json['"`]/);
  });

  it("OpenAPI builder produces title, version, X-API-Key security and required env header", () => {
    const spec = read(SPEC_MODULE);
    expect(spec).toMatch(/V1_API_TITLE\s*=\s*["']Izenzo Public API V1["']/);
    expect(spec).toMatch(/V1_API_VERSION/);
    expect(spec).toMatch(/openapi:\s*["']3\.1\.0["']/);
    expect(spec).toMatch(/ApiKeyAuth/);
    expect(spec).toMatch(/X-API-Key/);
    expect(spec).toMatch(/X-Izenzo-Environment/);
    expect(spec).toMatch(/X-External-Reference/);
    expect(spec).toMatch(/required:\s*true/);
  });

  it("OpenAPI surface lists every currently-available endpoint", () => {
    const spec = read(SPEC_MODULE);
    for (const p of AVAILABLE_PATHS) {
      expect(spec).toContain(p);
    }
  });

  it("OpenAPI does not list deferred endpoints as available", () => {
    const spec = read(SPEC_MODULE);
    // /v1/usage/current must only appear in the deferred-list, never as an
    // OpenAPI path entry.
    const availableList = spec.match(/V1_AVAILABLE_ENDPOINTS[\s\S]*?\];/);
    expect(availableList).toBeTruthy();
    expect(availableList![0]).not.toContain("/v1/usage/current");
    expect(availableList![0]).not.toContain("/v1/support");
    expect(availableList![0]).not.toContain("/v1/webhooks");
    expect(availableList![0]).not.toContain("/v1/invoices");
  });

  it("OpenAPI exposes the canonical error envelope and every error code", () => {
    const spec = read(SPEC_MODULE);
    expect(spec).toMatch(/ErrorEnvelope/);
    for (const code of REQUIRED_ERROR_CODES) {
      expect(spec).toContain(code);
    }
  });

  it("readable docs include the EXACT required legal warning string", () => {
    const spec = read(SPEC_MODULE);
    expect(spec).toContain(LEGAL_WARNING);
  });

  it("readable docs cover sandbox vs production, scopes, rate limits, monthly allowance and estimate-only billing", () => {
    const spec = read(SPEC_MODULE);
    // Source-of-truth module emits the readable HTML; assertions target
    // the constants it embeds.
    expect(spec).toMatch(/Sandbox/);
    expect(spec).toMatch(/Production/);
    expect(spec).toMatch(/api:status_read/);
    expect(spec).toMatch(/counterparty:lookup/);
    expect(spec).toMatch(/signals:read/);
    expect(spec).toMatch(/profile:summary_read/);
    expect(spec).toMatch(/usage:read/);
    expect(spec).toMatch(/requests_per_minute_per_key:\s*60/);
    expect(spec).toMatch(/concurrent_requests_per_key:\s*3/);
    expect(spec).toMatch(/default_monthly_production_lookups:\s*5_000/);
    expect(spec).toMatch(/default_monthly_sandbox_requests:\s*10_000/);
    expect(spec).toMatch(/80[\s\S]{0,30}100[\s\S]{0,30}120/);
    expect(spec).toMatch(/estimate_only/);
    expect(spec).toMatch(/no invoices/i);
    expect(spec).toMatch(/no payment collection/i);
  });

  it("readable docs include a 'what this API does NOT do' section", () => {
    const spec = read(SPEC_MODULE);
    expect(spec).toMatch(/What this API does NOT do/i);
    // Key deferred items must be named in the deferred list.
    expect(spec).toContain("/v1/usage/current");
    expect(spec).toMatch(/Write APIs/);
    expect(spec).toMatch(/Webhooks/);
    expect(spec).toMatch(/Evidence \/ document downloads/);
    expect(spec).toMatch(/POI \/ WaD actions/);
    expect(spec).toMatch(/Self-serve signup/);
    expect(spec).toMatch(/OAuth/);
    expect(spec).toMatch(/Invoices \/ payment collection/);
  });

  it("docs do not expose raw API keys, key hashes, internal tables, evidence or governance fields", () => {
    const spec = read(SPEC_MODULE);
    expect(/key_hash/i.test(spec)).toBe(false);
    expect(/service_role/i.test(spec)).toBe(false);
    expect(/poi_records?\b/i.test(spec)).toBe(false);
    expect(/wad_records?\b/i.test(spec)).toBe(false);
    expect(/governance_audit/i.test(spec)).toBe(false);
    expect(/compliance_notes/i.test(spec)).toBe(false);
    expect(/internal_notes/i.test(spec)).toBe(false);
    expect(/evidence_documents?/i.test(spec)).toBe(false);
    expect(/bank_account/i.test(spec)).toBe(false);
    // Must not embed a literal example secret.
    expect(/sk_live_[A-Za-z0-9]/i.test(spec)).toBe(false);
  });

  it("docs include the canonical error catalogue", () => {
    const spec = read(SPEC_MODULE);
    for (const code of REQUIRED_ERROR_CODES) {
      expect(spec).toContain(code);
    }
  });

  it("no separate openapi or docs edge function was introduced (single gateway only)", () => {
    expect(exists("supabase/functions/public-api-openapi")).toBe(false);
    expect(exists("supabase/functions/public-api-docs")).toBe(false);
  });

  // ─── Hard exclusions ──────────────────────────────────────────────────
  it("no programmatic support endpoint on the public API (in-product intake only)", () => {
    const spec = read(SPEC_MODULE);
    expect(/create\s+table[^;]*support_tickets/i.test(spec)).toBe(false);
    expect(exists("supabase/functions/public-api-support-intake")).toBe(false);
    // Either the original "contact your Izenzo account owner" phrasing or
    // the Batch 11 in-product API Support tab must be present in Support
    // section text — but a programmatic /v1/support endpoint must NOT be
    // claimed.
    expect(
      /contact your Izenzo account owner or Izenzo support/i.test(spec) ||
      /in-product API Support tab/i.test(spec)
    ).toBe(true);
    expect(/no public \/v1\/support endpoint/i.test(spec)).toBe(true);
  });

  it("no payment/invoice/PayFast/Paystack/webhook/write logic introduced in Batch 10", () => {
    const spec = codeOnly(read(SPEC_MODULE));
    const banned = [
      /payment_intent/i,
      /paystack/i,
      /payfast/i,
      /create\s+table[^;]*invoice/i,
      /webhook_endpoint/i,
      /\bPUT\b\s*\/v1/i,
      /\bDELETE\b\s*\/v1/i,
      /\bPATCH\b\s*\/v1/i,
    ];
    for (const re of banned) expect(re.test(spec)).toBe(false);
  });

  it("docs explicitly disclaim approval / clearance / payment guarantee", () => {
    const spec = read(SPEC_MODULE);
    expect(spec).toMatch(/not a bank-payment guarantee/);
    expect(spec).toMatch(/not a compliance clearance/);
    expect(spec).toMatch(/not a credit\s*\n?\s*decision|not a credit decision/);
  });
});
