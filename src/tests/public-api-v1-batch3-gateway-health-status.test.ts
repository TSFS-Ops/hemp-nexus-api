/**
 * Public API V1 — Batch 3 contract guards.
 *
 * Static source-contract tests for the V1 gateway foundation and the
 * health/status endpoints. Verifies that the gateway is in place, the
 * error catalogue is canonical, request logging is wired to the Batch 2
 * columns, raw API keys are not logged, and that no out-of-scope V1
 * surface (counterparty/usage/docs/sandbox seed/billing/dashboards/
 * support/webhooks) was introduced.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));
// Strip /* … */ block comments and // … line comments so prose like
// "no counterparty endpoint" in a header doesn't trip exclusion regexes.
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const GATEWAY = "supabase/functions/_shared/public-api-v1.ts";
const ENTRY = "supabase/functions/public-api/index.ts";

describe("Public API V1 · Batch 3 · gateway + health + status", () => {
  it("gateway shared helper exists", () => {
    expect(exists(GATEWAY)).toBe(true);
  });

  it("public-api edge function exists with /v1/health and /v1/status", () => {
    expect(exists(ENTRY)).toBe(true);
    const src = codeOnly(read(ENTRY));
    expect(src).toMatch(/parts\[0\] === "v1" && parts\[1\] === "health"/);
    expect(src).toMatch(/parts\[0\] === "v1" && parts\[1\] === "status"/);
    // Both require api:status_read
    expect(src).toMatch(/const V1_SCOPE = "api:status_read"/);
    expect(src).toContain('"/v1/health"');
    expect(src).toContain('"/v1/status"');
  });

  it("canonical V1 error catalogue contains every required code", () => {
    const src = codeOnly(read(GATEWAY));
    for (const c of [
      "invalid_api_key",
      "expired_api_key",
      "insufficient_scope",
      "suspended_key",
      "revoked_key",
      "missing_required_field",
      "invalid_country",
      "unsupported_country",
      "invalid_identifier_format",
      "rate_limit_exceeded",
      "monthly_limit_reached",
      "sandbox_record_only",
      "production_access_required",
      "no_match",
      "multiple_possible_matches",
      "provider_unavailable",
      "timeout",
      "internal_error",
    ]) {
      expect(src).toContain(`"${c}"`);
    }
  });

  it("standard error envelope shape is request_id / error_code / message / timestamp / retry_after", () => {
    const src = codeOnly(read(GATEWAY));
    expect(src).toMatch(/request_id:\s*requestId,\s*\n\s*error_code:\s*code,\s*\n\s*message:\s*ERROR_PUBLIC_MESSAGE\[code\],\s*\n\s*timestamp:[\s\S]*retry_after:\s*retryAfter/);
  });

  it("gateway enforces env header, key, status, expiry, env match, client status, IP allowlist, scope, rate limit", () => {
    const src = codeOnly(read(GATEWAY));
    expect(src).toMatch(/detectEnvironment\(req\)/);
    expect(src).toMatch(/x-api-key/i);
    expect(src).toMatch(/V1Error\("revoked_key"\)/);
    expect(src).toMatch(/V1Error\("suspended_key"\)/);
    expect(src).toMatch(/V1Error\("expired_api_key"\)/);
    expect(src).toMatch(/V1Error\("production_access_required"\)/);
    expect(src).toMatch(/V1Error\("sandbox_record_only"\)/);
    expect(src).toMatch(/from\("api_clients"\)/);
    expect(src).toMatch(/V1Error\("insufficient_scope"\)/);
    expect(src).toMatch(/checkRateLimit\(/);
    expect(src).toMatch(/V1Error\("rate_limit_exceeded"/);
  });

  it("environment is read from X-Izenzo-Environment header", () => {
    const src = codeOnly(read(GATEWAY));
    expect(src).toMatch(/x-izenzo-environment/);
    expect(src).toMatch(/raw === "sandbox" \|\| raw === "production"/);
  });

  it("request logger populates Batch 2 columns and never logs raw API key", () => {
    const src = codeOnly(read(GATEWAY));
    expect(src).toMatch(/from\("api_request_logs"\)\s*\.insert\(\{/);
    expect(src).toMatch(/billable:\s*false/);
    expect(src).toMatch(/scope_used:\s*ctx\.scopeUsed/);
    expect(src).toMatch(/environment:\s*ctx\.environment/);
    expect(src).toMatch(/external_reference:\s*ctx\.externalReference/);
    expect(src).toMatch(/error_code:\s*errorCode/);
    // Never store presented secret
    expect(src).not.toMatch(/request_body:\s*presented/);
    expect(src).not.toMatch(/key_hash:\s*presented/);
    // No raw 'sk_' is ever inserted into a log row anywhere in the file
    const insertBlocks = src.match(/from\("api_request_logs"\)[\s\S]*?\}\)/g) || [];
    for (const b of insertBlocks) {
      expect(b).not.toMatch(/presented/);
      expect(b).not.toMatch(/sk_/);
    }
  });

  it("audit events for invalid/expired/suspended/revoked/insufficient scope/IP blocked/env mismatch are emitted", () => {
    const src = codeOnly(read(GATEWAY));
    expect(src).toContain("api_key.v1.invalid_key_attempt");
    expect(src).toContain("api_key.v1.expired_use_attempt");
    expect(src).toContain("api_key.v1.suspended_use_attempt");
    expect(src).toContain("api_key.v1.revoked_use_attempt");
    expect(src).toContain("api_key.v1.insufficient_scope");
    expect(src).toContain("api_key.v1.ip_blocked");
    expect(src).toContain("api_key.v1.environment_mismatch");
    expect(src).toContain("api_key.v1.client_suspended_use_attempt");
    expect(src).toContain("api_key.v1.client_revoked_use_attempt");
  });

  it("/v1/health response is minimal (no internal service details, no secrets)", () => {
    const src = codeOnly(read(ENTRY));
    // Body shape — request_id, environment, status:"ok", service, timestamp
    expect(src).toMatch(/status:\s*"ok"/);
    expect(src).toMatch(/service:\s*"public_api"/);
    // No table names, no provider internals, no stack
    expect(src).not.toMatch(/api_keys|api_clients|service_role|SUPABASE_SERVICE_ROLE_KEY/);
    expect(src).not.toMatch(/stack/i);
  });

  it("/v1/status response exposes only key/client/environment status — no secrets, no documents, no POI/WaD/notes/governance/bank", () => {
    const src = codeOnly(read(ENTRY));
    expect(src).toMatch(/api_client_status:/);
    expect(src).toMatch(/key_status:/);
    expect(src).toMatch(/scopes:/);
    expect(src).toMatch(/expires_at,/);
    // Forbidden fields never appear
    for (const forbidden of ["key_hash", "documents", "governance", "poi", "wad", "bank", "internal_notes", "notes:"]) {
      expect(src.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("scope catalogue still rejects forbidden scopes (regression)", () => {
    const src = read("supabase/functions/_shared/api-scopes.ts");
    expect(src).toMatch(/FORBIDDEN_SCOPES[\s\S]*"\*"[\s\S]*"admin"[\s\S]*""/);
  });

  it("rate limit uses existing helper (60 rpm default) — not a new bespoke table", () => {
    const src = codeOnly(read(GATEWAY));
    expect(src).toMatch(/import \{ checkRateLimit \} from "\.\/rate-limit\.ts"/);
    // No new bespoke commercial-plan table referenced in Batch 3 gateway.
    expect(src).not.toMatch(/api_commercial_plans|api_client_plans/);
  });

  it("hard exclusions — still-forbidden V1 surface not introduced (counterparty became in-scope in Batch 5; sandbox records in Batch 4)", () => {
    // The V1 surface stays consolidated under the single `public-api`
    // dispatcher — no standalone per-endpoint edge functions.
    expect(exists("supabase/functions/public-api-counterparty-lookup")).toBe(false);
    expect(exists("supabase/functions/public-api-counterparty-summary")).toBe(false);
    expect(exists("supabase/functions/public-api-usage-current")).toBe(false);
    expect(exists("supabase/functions/public-api-docs")).toBe(false);
    expect(exists("supabase/functions/public-api-openapi")).toBe(false);

    // Entry file still does not dispatch usage / docs / openapi routes.
    const src = codeOnly(read(ENTRY));
    expect(src).not.toMatch(/\/v1\/usage/);
    expect(src).not.toMatch(/\/v1\/docs/);
    expect(src).not.toMatch(/openapi/i);

    // No support-intake tables introduced anywhere. Commercial plans are
    // intentionally scoped to Batch 7 — excluded here only from Batch-3-
    // tagged migrations.
    const migDir = path.join(ROOT, "supabase/migrations");
    for (const f of fs.readdirSync(migDir)) {
      const body = fs.readFileSync(path.join(migDir, f), "utf-8");
      expect(body).not.toMatch(/CREATE TABLE[^;]*api_support_tickets/i);
      if (/Batch 3/i.test(body)) {
        expect(body).not.toMatch(/CREATE TABLE[^;]*api_commercial_plans/i);
      }
    }
  });
});
