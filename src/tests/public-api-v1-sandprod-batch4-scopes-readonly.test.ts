/**
 * Public API V1 · Sandbox / Production Separation · Batch 4 invariants.
 *
 * Verifies:
 *  1. Canonical V1 scope catalogue is the single source of truth and
 *     covers every spec-listed allowed scope.
 *  2. Forbidden scope list in the catalogue matches the DB trigger from
 *     Batch 2 (api_keys_assert_scopes_allowed).
 *  3. Allowed legacy scopes (signals:read, profile:summary_read) remain
 *     valid for back-compat with currently-issued keys.
 *  4. Sandbox-only scope `webhook:test` and production-only scope
 *     `webhook:events_read` are classified correctly.
 *  5. Canonical route table classifies every V1 endpoint and the new
 *     /v1/test/error/{code} route is sandbox_only.
 *  6. /v1/test/error/{code} route is wired into the gateway, rejects
 *     production environment BEFORE simulation, validates the error
 *     code against the canonical sandbox error catalogue, and stays
 *     non-billable (ctx.billable = false).
 *  7. Deterministic sandbox error catalogue maps each code to the
 *     canonical HTTP status from the spec.
 *  8. Read-only invariants: no V1 route hints at create/update/delete/
 *     upload/approve/clear/verify/issue/override/export, no POI/WaD/
 *     payment/compliance/verification/document/governance/bank routes.
 *  9. Production lookup path remains conservative (no read from
 *     api_sandbox_records, no sandbox-only fields, no_match envelope).
 * 10. Raw secrets are not persisted/logged.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SHARED = join(ROOT, "supabase/functions/_shared/public-api-v1.ts");
const GATEWAY = join(ROOT, "supabase/functions/public-api/index.ts");
const SCOPES_MODULE = join(ROOT, "supabase/functions/_shared/public-api-v1-scopes.ts");
const LEGACY_SCOPES = join(ROOT, "supabase/functions/_shared/api-scopes.ts");
const COUNTERPARTY = join(ROOT, "supabase/functions/_shared/public-api-v1-counterparty.ts");
const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");

function read(p: string): string { return readFileSync(p, "utf8"); }
function findMigrationContaining(needles: string[]): string | null {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  for (const f of files) {
    const body = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    if (needles.every((n) => body.includes(n))) return body;
  }
  return null;
}

describe("Public API V1 · sandbox/production separation · Batch 4 scopes + read-only", () => {
  it("canonical V1 scope catalogue lists every spec-allowed scope", () => {
    const src = read(SCOPES_MODULE);
    for (const s of [
      "api:status_read",
      "counterparty:lookup",
      "counterparty:summary_read",
      "usage:read",
      "webhook:test",
      "webhook:events_read",
    ]) {
      expect(src, `catalogue must list ${s}`).toContain(`scope: "${s}"`);
    }
  });

  it("legacy back-compat scopes (signals:read, profile:summary_read) preserved", () => {
    const src = read(SCOPES_MODULE);
    expect(src).toContain('scope: "signals:read"');
    expect(src).toContain('scope: "profile:summary_read"');
    // And the legacy scope validator still accepts them.
    const legacy = read(LEGACY_SCOPES);
    expect(legacy).toContain('"signals:read"');
    expect(legacy).toContain('"profile:summary_read"');
    expect(legacy).toContain('"counterparty:summary_read"');
  });

  it("webhook:test is sandbox-only and webhook:events_read is production-only", () => {
    const src = read(SCOPES_MODULE);
    // Snip each definition block and verify envRule.
    const block = (name: string) => {
      const i = src.indexOf(`scope: "${name}"`);
      expect(i, `definition for ${name} not found`).toBeGreaterThan(-1);
      return src.slice(i, i + 400);
    };
    expect(block("webhook:test")).toMatch(/envRule:\s*"sandbox"/);
    expect(block("webhook:events_read")).toMatch(/envRule:\s*"production"/);
  });

  it("forbidden scope catalogue matches the DB trigger (Batch 2)", () => {
    const src = read(SCOPES_MODULE);
    const trigger = findMigrationContaining([
      "assert_api_key_scopes_allowed",
      "forbidden_v1_scope",
    ]);
    expect(trigger, "Batch 2 forbidden-scope trigger migration not found").not.toBeNull();
    const tbody = trigger!;
    for (const s of [
      "evidence_export",
      "governance_record_write",
      "verification_override",
      "payment_approve",
      "compliance_clearance",
      "poi:create",
      "wad:issue",
      "document_upload",
      "bank_detail_change",
      "client_data_export",
    ]) {
      expect(src, `${s} must appear in V1_FORBIDDEN_SCOPES`).toContain(`"${s}"`);
      expect(tbody, `${s} must be denied by DB trigger`).toContain(s);
    }
    // Wildcard families.
    expect(src).toContain('"write:"');
    expect(src).toContain('"admin:"');
    expect(tbody).toMatch(/'write:%'/);
    expect(tbody).toMatch(/'admin:%'/);
  });

  it("canonical route table classifies every V1 route + tags /v1/test/error as sandbox_only", () => {
    const src = read(SCOPES_MODULE);
    for (const tag of [
      "v1.health",
      "v1.status",
      "v1.docs.openapi",
      "v1.docs.readable",
      "v1.counterparty.lookup",
      "v1.counterparty.summary",
      "v1.test.error",
    ]) {
      expect(src, `route ${tag} must be classified`).toContain(`endpointTag: "${tag}"`);
    }
    // /v1/test/error{...} row must be sandbox_only.
    const idx = src.indexOf('endpointTag: "v1.test.error"');
    const row = src.slice(idx, idx + 400);
    expect(row).toMatch(/classification:\s*"sandbox_only"/);
    // Health/status remain both.
    const hi = src.indexOf('endpointTag: "v1.health"');
    expect(src.slice(hi, hi + 400)).toMatch(/classification:\s*"both"/);
  });

  it("/v1/test/error/{code} route is wired and rejects production BEFORE simulation", () => {
    const gw = read(GATEWAY);
    expect(gw).toContain('parts[1] === "test"');
    expect(gw).toContain('parts[2] === "error"');
    // Production env detected → sandbox_endpoint_required, 403, before handleV1.
    expect(gw).toContain('sandbox_endpoint_required');
    expect(gw).toMatch(/detected\.env\s*===\s*"production"/);
    // Sandbox error simulation must remain non-billable.
    expect(gw).toContain("ctx.billable = false");
    // Throws via central V1Error so envelope/status come from the canonical table.
    expect(gw).toMatch(/throw new V1Error\(c, retry\)/);
  });

  it("deterministic sandbox error catalogue covers spec codes with the canonical HTTP statuses", () => {
    const src = read(SCOPES_MODULE);
    const expected: Record<string, number> = {
      invalid_api_key: 401,
      expired_api_key: 401,
      insufficient_scope: 403,
      missing_required_field: 400,
      invalid_country: 400,
      rate_limit_exceeded: 429,
      provider_unavailable: 503,
      internal_error_simulated: 500,
    };
    for (const [code, status] of Object.entries(expected)) {
      expect(src, `error code ${code} listed`).toContain(`"${code}"`);
      const re = new RegExp(`${code}:\\s*${status}\\b`);
      expect(src, `error code ${code} mapped to HTTP ${status}`).toMatch(re);
    }
  });

  it("Batch 4 error codes are registered in the central V1 error table", () => {
    const src = read(SHARED);
    for (const code of [
      "sandbox_endpoint_required",
      "production_endpoint_required",
      "unknown_scope",
      "forbidden_scope",
      "api_key_environment_mismatch",
      "internal_error_simulated",
    ]) {
      expect(src, `${code} must appear in V1_ERROR_CODES`).toContain(`"${code}"`);
    }
    // HTTP status entries present (403 for the gate codes, 500 for sim).
    expect(src).toMatch(/sandbox_endpoint_required:\s*403/);
    expect(src).toMatch(/production_endpoint_required:\s*403/);
    expect(src).toMatch(/internal_error_simulated:\s*500/);
    // Public messages do not leak internals.
    expect(src).toMatch(/sandbox_endpoint_required:\s*"[^"]*sandbox[^"]*"/);
    expect(src).toMatch(/production_endpoint_required:\s*"[^"]*production[^"]*"/);
  });

  it("read-only V1: no route names hint at write/governance/payment surfaces", () => {
    const gw = read(GATEWAY);
    // Direct forbidden tokens in route paths (case-insensitive).
    const forbiddenTokens = [
      "/v1/orgs/create",
      "/v1/poi/create",
      "/v1/wad/issue",
      "/v1/payment",
      "/v1/payments/",
      "/v1/compliance/clear",
      "/v1/verification/override",
      "/v1/governance/",
      "/v1/documents/upload",
      "/v1/evidence/export",
      "/v1/clients/export",
      "/v1/bank/",
      "/v1/pricing/",
      "/v1/packages/",
    ];
    for (const t of forbiddenTokens) {
      expect(gw.toLowerCase(), `gateway must not expose ${t}`).not.toContain(t);
    }
  });

  it("V1 router only declares the canonical, read-only verbs", () => {
    const gw = read(GATEWAY);
    // The gateway must only branch on GET + POST + OPTIONS for V1.
    expect(gw).not.toMatch(/req\.method\s*===\s*"PUT"/);
    expect(gw).not.toMatch(/req\.method\s*===\s*"DELETE"/);
    expect(gw).not.toMatch(/req\.method\s*===\s*"PATCH"/);
  });

  it("production lookup path stays conservative: never reads api_sandbox_records and never returns sandbox-only fields", () => {
    const gw = read(GATEWAY);
    // Production branch of /v1/counterparty/lookup explicitly returns
    // buildNoMatchEnvelope and never queries api_sandbox_records.
    const lookupStart = gw.indexOf("Production path — CONSERVATIVE");
    expect(lookupStart, "production lookup branch not found").toBeGreaterThan(-1);
    const prodLookup = gw.slice(lookupStart, lookupStart + 1200);
    expect(prodLookup).not.toContain("api_sandbox_records");
    expect(prodLookup).toContain("buildNoMatchEnvelope");
    // Production summary branch also throws no_match and never reads sandbox.
    const summaryStart = gw.indexOf("Production path — conservative; no internal tables exposed");
    expect(summaryStart, "production summary branch not found").toBeGreaterThan(-1);
    const prodSummary = gw.slice(summaryStart, summaryStart + 800);
    expect(prodSummary).not.toContain("api_sandbox_records");
    expect(prodSummary).toMatch(/throw new V1Error\("no_match"\)/);

    // Sandbox-only marker fields are permitted in Batch 5 but MUST be
    // gated behind the sandbox-only `withSandboxMarkers` helper, which
    // short-circuits when the environment is anything other than sandbox.
    const cp = read(COUNTERPARTY);
    expect(cp).not.toContain("simulated_provider");
    const gate = cp.match(/function\s+withSandboxMarkers[\s\S]*?\n\}/);
    expect(gate, "withSandboxMarkers helper missing").not.toBeNull();
    expect(gate![0]).toMatch(/ctx\.environment\s*!==\s*"sandbox"/);
    // Outside that helper, no envelope builder may directly assign
    // sandbox markers without going through the gate.
    const stripped = cp.replace(/function\s+withSandboxMarkers[\s\S]*?\n\}/, "");
    expect(stripped).not.toMatch(/body\.test_record\s*=\s*true/);
    expect(stripped).not.toMatch(/body\.sandbox_case_id\s*=/);
  });

  it("Batch 2 schema-level separation exception remains live (not yet retired)", () => {
    const ex = findMigrationContaining([
      "CREATE TABLE IF NOT EXISTS public.api_v1_exceptions",
      "schema_level_data_separation_v1",
      "first_real_production_data_source_wired",
    ]);
    expect(ex, "Batch 2 V1 exception register must still be present").not.toBeNull();
  });

  it("raw secrets are never persisted or logged by the gateway", () => {
    const shared = read(SHARED);
    // logV1Request must NOT insert the raw key under any column name.
    const logFn = shared.split("export async function logV1Request")[1]?.split("export async function")[0] ?? "";
    expect(logFn, "logV1Request body not found").not.toBe("");
    for (const bad of [
      "presented",       // the raw X-API-Key variable
      "x-api-key",       // header value
      "key_value",
      "raw_key",
      "secret",
    ]) {
      expect(logFn.toLowerCase(), `raw secret token "${bad}" must not appear in logV1Request body`)
        .not.toContain(bad);
    }
    // Audits also do not pass the raw key.
    expect(shared).not.toMatch(/extra:\s*\{[^}]*presented/);
  });

  it("scope catalogue helper functions exist for runtime classification", () => {
    const src = read(SCOPES_MODULE);
    expect(src).toContain("export function classifyScopeForEnv");
    expect(src).toContain("export function isForbiddenV1Scope");
    expect(src).toContain("export function isSandboxTestErrorCode");
  });

  it("Batch 4 stays scoped: no dashboard or alert catalogue shipped (webhook dispatcher arrives in Batch 7)", () => {
    const files = readdirSync(join(ROOT, "supabase/functions"));
    expect(files).not.toContain("public-api-alerts-catalogue");
    expect(files).not.toContain("public-api-usage-dashboard");
  });
});
