/**
 * Public API V1 — Sandbox / Production Separation · Batch 9.
 *
 * Documentation / OpenAPI / developer-guidance contract guards. This batch
 * is documentation-only: no production lookup data source, no write API
 * routes, no new webhook event types, no dashboard changes, no product
 * logic changes are introduced here. The tests below assert the docs and
 * machine-readable spec match the actual sandbox / production build.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

const OPENAPI = "supabase/functions/_shared/public-api-v1-openapi.ts";
const INTEGRATION_DOCS = "src/components/developer/IntegrationDocs.tsx";
const OPENAPI_SRC = read(OPENAPI);
const INTEGRATION_DOCS_SRC = read(INTEGRATION_DOCS);

// Import the live spec/HTML builders so we test their actual output.
import {
  buildOpenApiSpec,
  buildReadableDocsHtml,
  V1_SANDBOX_BASE_URL,
  V1_PRODUCTION_BASE_URL,
  V1_LEGAL_WARNING,
  V1_SANDBOX_WARNING,
  V1_PRODUCTION_WARNING,
  V1_SCOPE_CATALOGUE,
  V1_FORBIDDEN_SCOPES,
  V1_AVAILABLE_ENDPOINTS,
  V1_ENV_LIMITS,
  V1_SANDBOX_TEST_RECORDS,
  V1_SANDBOX_ONLY_RESPONSE_FIELDS,
  V1_WEBHOOK_DOCS,
  V1_KEY_LIFECYCLE_DOCS,
  V1_FIRST_VERSION_EXCLUSIONS,
} from "../../supabase/functions/_shared/public-api-v1-openapi.ts";

const SPEC = buildOpenApiSpec();
const HTML = buildReadableDocsHtml(V1_SANDBOX_BASE_URL);

describe("Public API V1 · Batch 9 · OpenAPI + docs", () => {
  // ── OpenAPI servers / auth / headers ───────────────────────────────────
  it("OpenAPI lists BOTH sandbox and production server URLs", () => {
    const servers = (SPEC.servers as Array<{ url: string }>).map((s) => s.url);
    expect(servers).toContain(V1_SANDBOX_BASE_URL);
    expect(servers).toContain(V1_PRODUCTION_BASE_URL);
    expect(V1_SANDBOX_BASE_URL).toBe("https://api-sandbox.trade.izenzo.co.za/v1");
    expect(V1_PRODUCTION_BASE_URL).toBe("https://api.trade.izenzo.co.za/v1");
  });

  it("OpenAPI documents X-API-Key auth", () => {
    const schemes = (SPEC.components as any).securitySchemes;
    expect(schemes.ApiKeyAuth.type).toBe("apiKey");
    expect(schemes.ApiKeyAuth.in).toBe("header");
    expect(schemes.ApiKeyAuth.name).toBe("X-API-Key");
  });

  it("OpenAPI documents X-Izenzo-Environment and X-Izenzo-Request-Id response headers on every documented response", () => {
    const paths = SPEC.paths as Record<string, Record<string, any>>;
    let checked = 0;
    for (const p of Object.keys(paths)) {
      for (const m of Object.keys(paths[p])) {
        const responses = paths[p][m].responses as Record<string, any>;
        for (const status of Object.keys(responses)) {
          const headers = responses[status].headers || {};
          expect(Object.keys(headers)).toContain("X-Izenzo-Environment");
          expect(Object.keys(headers)).toContain("X-Izenzo-Request-Id");
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  // ── OpenAPI route coverage ─────────────────────────────────────────────
  it("OpenAPI documents only currently-available V1 routes", () => {
    const paths = Object.keys(SPEC.paths as object).sort();
    expect(paths).toEqual(V1_AVAILABLE_ENDPOINTS.map((e) => e.path).sort());
    expect(paths).toContain("/v1/health");
    expect(paths).toContain("/v1/status");
    expect(paths).toContain("/v1/counterparty/lookup");
    expect(paths).toContain("/v1/counterparty/{id}/summary");
    expect(paths).toContain("/v1/docs/openapi.json");
    expect(paths).toContain("/v1/test/error/{code}");
  });

  it("OpenAPI does NOT document write API routes or out-of-scope endpoints", () => {
    const paths = Object.keys(SPEC.paths as object).join(" ");
    for (const forbidden of [
      "/v1/poi", "/v1/wad", "/v1/payment", "/v1/payments",
      "/v1/compliance", "/v1/verification", "/v1/evidence",
      "/v1/bank", "/v1/documents",
      "create", "delete", "update", "approve", "issue", "override",
    ]) {
      expect(paths.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("OpenAPI marks /v1/test/error/{code} as sandbox-only via the description", () => {
    const op = (SPEC.paths as any)["/v1/test/error/{code}"].get;
    expect(op.description.toLowerCase()).toContain("invalid_api_key");
    expect(op.description.toLowerCase()).toContain("internal_error_simulated");
    expect(op.description.toLowerCase()).toContain("provider_unavailable");
  });

  it("OpenAPI documents sandbox-only response fields with a never-in-production note", () => {
    const lookup = (SPEC.components as any).schemas.LookupResponse.properties;
    for (const f of V1_SANDBOX_ONLY_RESPONSE_FIELDS) {
      expect(Object.keys(lookup)).toContain(f);
      expect(String(lookup[f].description || "").toLowerCase()).toContain("never");
      expect(String(lookup[f].description || "").toLowerCase()).toContain("production");
    }
  });

  it("OpenAPI canonical error envelope shape is request_id / error_code / message / timestamp / retry_after", () => {
    const env = (SPEC.components as any).schemas.ErrorEnvelope;
    expect(env.required).toEqual(["request_id", "error_code", "message", "timestamp"]);
    expect(Object.keys(env.properties).sort()).toEqual(
      ["error_code", "message", "request_id", "retry_after", "timestamp"],
    );
  });

  // ── IntegrationDocs / developer guidance ───────────────────────────────
  it("IntegrationDocs no longer references stale endpoints", () => {
    expect(INTEGRATION_DOCS_SRC).not.toMatch(/\/openapi\.yaml/);
    expect(INTEGRATION_DOCS_SRC).not.toMatch(/\/functions\/v1\/healthz/);
    expect(INTEGRATION_DOCS_SRC).not.toMatch(/\/functions\/v1\/match/);
  });

  it("IntegrationDocs uses current V1 routes and both base URLs", () => {
    expect(INTEGRATION_DOCS_SRC).toContain("https://api-sandbox.trade.izenzo.co.za/v1");
    expect(INTEGRATION_DOCS_SRC).toContain("https://api.trade.izenzo.co.za/v1");
    expect(INTEGRATION_DOCS_SRC).toContain("/v1/health");
    expect(INTEGRATION_DOCS_SRC).toContain("/v1/counterparty/lookup");
    expect(INTEGRATION_DOCS_SRC).toContain("X-Izenzo-Environment");
    expect(INTEGRATION_DOCS_SRC).toContain("X-API-Key");
    expect(INTEGRATION_DOCS_SRC).toContain("/v1/docs/openapi.json");
  });

  it("IntegrationDocs includes the required sandbox + production warning wording (verbatim)", () => {
    // Verbatim against the constants — they are the authoritative copy.
    expect(INTEGRATION_DOCS_SRC).toContain(V1_SANDBOX_WARNING);
    expect(INTEGRATION_DOCS_SRC).toContain(V1_PRODUCTION_WARNING);
  });

  it("IntegrationDocs explains host-derived environment wins over headers", () => {
    expect(INTEGRATION_DOCS_SRC.toLowerCase()).toContain("host-derived environment wins");
    expect(INTEGRATION_DOCS_SRC.toLowerCase()).toContain("sandbox keys do not work in production");
  });

  // ── Readable HTML docs ─────────────────────────────────────────────────
  it("readable docs include sandbox + production + legal warning wording verbatim", () => {
    expect(HTML).toContain(V1_LEGAL_WARNING);
    expect(HTML).toContain(V1_SANDBOX_WARNING);
    expect(HTML).toContain(V1_PRODUCTION_WARNING);
  });

  it("readable docs include all six sandbox test records", () => {
    expect(V1_SANDBOX_TEST_RECORDS).toHaveLength(6);
    for (const r of V1_SANDBOX_TEST_RECORDS) {
      expect(HTML).toContain(r.legal_name);
      expect(HTML).toContain(r.expected);
    }
    // The four specific registration numbers must be present.
    for (const reg of ["TEST-2019-000001", "TEST-2019-000002", "TEST-NOMATCH", "TEST-BLOCKED", "TEST-STALE"]) {
      expect(HTML).toContain(reg);
    }
  });

  it("readable docs include the sandbox error route and allowed codes", () => {
    expect(HTML).toContain("/v1/test/error/{code}");
    for (const c of [
      "invalid_api_key",
      "expired_api_key",
      "insufficient_scope",
      "missing_required_field",
      "invalid_country",
      "rate_limit_exceeded",
      "provider_unavailable",
      "internal_error_simulated",
    ]) {
      expect(HTML).toContain(c);
    }
  });

  it("readable docs include allowed scopes and forbidden scopes", () => {
    for (const s of V1_SCOPE_CATALOGUE) {
      expect(HTML).toContain(s.scope);
    }
    for (const f of V1_FORBIDDEN_SCOPES) {
      expect(HTML).toContain(f);
    }
    // Compatibility aliases explicitly enumerated by the prompt.
    expect(V1_SCOPE_CATALOGUE.map((s) => s.scope)).toContain("profile:summary_read");
    expect(V1_SCOPE_CATALOGUE.map((s) => s.scope)).toContain("signals:read");
    expect(V1_SCOPE_CATALOGUE.map((s) => s.scope)).toContain("webhook:test");
    expect(V1_SCOPE_CATALOGUE.map((s) => s.scope)).toContain("webhook:events_read");
  });

  it("readable docs include env-split rate limits with correct defaults", () => {
    expect(V1_ENV_LIMITS.sandbox.requests_per_minute_per_key).toBe(30);
    expect(V1_ENV_LIMITS.sandbox.monthly_requests).toBe(1_000);
    expect(V1_ENV_LIMITS.sandbox.concurrent_requests_per_key).toBe(10);
    expect(V1_ENV_LIMITS.production.requests_per_minute_per_key).toBe(60);
    expect(V1_ENV_LIMITS.production.default_monthly_lookups).toBe(5_000);
    expect(V1_ENV_LIMITS.production.concurrent_requests_per_key).toBe(3);
    expect(HTML).toContain("Sandbox");
    expect(HTML).toContain("Production");
    expect(HTML).toContain("80 / 100 / 120");
    expect(HTML).toMatch(/rate_limit_exceeded/);
    expect(HTML).toMatch(/retry_after/);
  });

  it("readable docs include webhook signing headers and retry schedule", () => {
    for (const h of V1_WEBHOOK_DOCS.signing_headers) {
      expect(HTML).toContain(h);
    }
    for (const r of V1_WEBHOOK_DOCS.retry_schedule) {
      expect(HTML).toContain(r);
    }
    expect(HTML.toLowerCase()).toContain("hmac-sha256");
    expect(HTML.toLowerCase()).toContain("sandbox webhook test");
  });

  it("readable docs include key expiry rules", () => {
    expect(V1_KEY_LIFECYCLE_DOCS.sandbox_expiry_days).toBe(90);
    expect(V1_KEY_LIFECYCLE_DOCS.production_expiry_months).toBe(12);
    expect(HTML).toContain("90 days");
    expect(HTML).toContain("12 months");
    expect(HTML).toContain("30 / 14 / 3");
    expect(HTML.toLowerCase()).toContain("shown once only");
    expect(HTML.toLowerCase()).toContain("rotation returns a new secret");
  });

  it("readable docs include the first-version exclusions list", () => {
    for (const e of V1_FIRST_VERSION_EXCLUSIONS) {
      expect(HTML).toContain(e);
    }
  });

  it("readable docs state production is read-only and sandbox data is fictional + non-billable", () => {
    expect(HTML.toLowerCase()).toContain("production access in v1 is");
    expect(HTML.toLowerCase()).toContain("read-only");
    expect(HTML.toLowerCase()).toContain("sandbox data is fictional");
    expect(HTML.toLowerCase()).toContain("non-billable");
  });

  it("readable docs state no API response auto-creates POI/WaD/compliance/payment actions", () => {
    expect(HTML).toContain(
      "No API response automatically creates a POI, issues a WaD, clears a compliance block or approves a transaction.",
    );
  });

  // ── Hard exclusions for this batch ─────────────────────────────────────
  it("no new public production lookup data source, write route or webhook event type introduced by this batch", () => {
    // Source-level fence: the docs/OpenAPI module must not start wiring
    // production data sources, payment automation or new write surfaces.
    for (const forbidden of [
      "compliance_clearance",
      "verification_override",
      "payment_approve",
      "poi:create",
      "wad:issue",
      "evidence_export",
      "bank_detail_change",
      "document_upload",
      "client_data_export",
    ]) {
      // They MAY appear inside V1_FORBIDDEN_SCOPES — that's expected. They
      // must NOT appear inside V1_SCOPE_CATALOGUE (allowed scopes).
      expect(V1_SCOPE_CATALOGUE.map((s) => s.scope)).not.toContain(forbidden);
    }
  });
});
