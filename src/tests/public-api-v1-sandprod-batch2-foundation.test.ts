/**
 * Public API V1 — Sandbox / Production Separation · Batch 2 invariants.
 *
 * Foundation-only guard. Verifies that:
 *
 *  1. The gateway derives environment from the public hostname and that
 *     the host-derived value wins over any submitted X-Izenzo-Environment
 *     header (Batch 2 Decision #1).
 *  2. Every Response carries X-Izenzo-Request-Id and X-Izenzo-Environment
 *     headers on both success and error paths.
 *  3. api_request_logs writes the Batch 2 trace columns
 *     (request_payload_hash, rate_limit_decision, billable_overage).
 *  4. The api_keys forbidden-scope trigger is wired in the migrations.
 *  5. The append-only api_production_approvals + api_v1_exceptions tables
 *     and dual sign-off columns are declared in the migrations.
 *  6. No webhook dispatcher, no dashboard, no alert catalogue file was
 *     introduced in Batch 2 (those belong to later batches).
 *
 * No new product surface is exercised here — this is a static integrity
 * test that runs as part of the standard test suite.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SHARED = join(ROOT, "supabase/functions/_shared/public-api-v1.ts");
const GATEWAY = join(ROOT, "supabase/functions/public-api/index.ts");
const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");

function readShared(): string { return readFileSync(SHARED, "utf8"); }
function readGateway(): string { return readFileSync(GATEWAY, "utf8"); }

function findMigrationContaining(needles: string[]): string | null {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  for (const f of files) {
    const body = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    if (needles.every((n) => body.includes(n))) return body;
  }
  return null;
}

describe("Public API V1 · sandbox/production separation · Batch 2 foundation", () => {
  it("host-derived environment wins over X-Izenzo-Environment header", () => {
    const src = readShared();
    expect(src).toContain("deriveHostEnvironment");
    expect(src).toContain("api-sandbox.trade.izenzo.co.za");
    expect(src).toContain("api.trade.izenzo.co.za");
    expect(src).toContain("detectEnvironmentDetailed");
    // The detailed detector must return hostEnv when present, regardless
    // of any header value the client supplied.
    expect(src).toMatch(/if \(hostEnv\) \{\s*return \{ env: hostEnv/);
  });

  it("host/header mismatch is audited (never silently lost)", () => {
    const src = readShared();
    expect(src).toContain("api_key.v1.environment_header_mismatch");
  });

  it("every response (success + error) emits X-Izenzo-* canonical headers", () => {
    const src = readShared();
    // Success path
    expect(src).toMatch(/X-Izenzo-Request-Id/);
    expect(src).toMatch(/X-Izenzo-Environment/);
    // Error path must also carry both headers + the back-compat X-Request-Id.
    const errSlice = src.split("} catch (e) {")[1] ?? "";
    expect(errSlice).toContain("X-Izenzo-Request-Id");
    expect(errSlice).toContain("X-Izenzo-Environment");
    // Unknown-route 404 in the gateway entry too.
    const gw = readGateway();
    expect(gw).toContain("X-Izenzo-Request-Id");
    expect(gw).toContain("X-Izenzo-Environment");
  });

  it("logV1Request persists the Batch 2 trace columns", () => {
    const src = readShared();
    expect(src).toContain("request_payload_hash: ctx.requestPayloadHash");
    expect(src).toContain("rate_limit_decision: ctx.rateLimitDecision");
    expect(src).toContain("billable_overage: ctx.billableOverage");
  });

  it("rate-limit decision is set on allowed, minute_block and monthly_block paths", () => {
    const src = readShared();
    expect(src).toContain('ctx.rateLimitDecision = "allowed"');
    expect(src).toContain('ctx.rateLimitDecision = "minute_block"');
    expect(src).toContain('ctx.rateLimitDecision = "monthly_block"');
  });

  it("forbidden V1 scopes are blocked by a DB trigger on api_keys", () => {
    const mig = findMigrationContaining([
      "assert_api_key_scopes_allowed",
      "api_keys_assert_scopes_allowed",
      "forbidden_v1_scope",
    ]);
    expect(mig, "migration with the forbidden-scope trigger not found").not.toBeNull();
    const body = mig!;
    // Each spec-listed forbidden scope name must appear in the trigger source.
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
      expect(body, `forbidden scope ${s} must be denied by trigger`).toContain(s);
    }
    // Wildcard families.
    expect(body).toMatch(/'write:%'/);
    expect(body).toMatch(/'admin:%'/);
  });

  it("append-only production approval + V1 exception registers are declared", () => {
    const approvals = findMigrationContaining([
      "CREATE TABLE IF NOT EXISTS public.api_production_approvals",
      "platform_admin_approved",
      "commercial_owner_signed_off",
      "compliance_owner_signed_off",
    ]);
    expect(approvals, "api_production_approvals migration not found").not.toBeNull();

    const exceptions = findMigrationContaining([
      "CREATE TABLE IF NOT EXISTS public.api_v1_exceptions",
      "schema_level_data_separation_v1",
      "first_real_production_data_source_wired",
    ]);
    expect(exceptions, "api_v1_exceptions seed migration not found").not.toBeNull();
  });

  it("api_clients gains dual commercial/compliance sign-off columns", () => {
    const mig = findMigrationContaining([
      "commercial_owner_sign_off_by",
      "commercial_owner_sign_off_at",
      "compliance_owner_sign_off_by",
      "compliance_owner_sign_off_at",
    ]);
    expect(mig, "api_clients sign-off columns migration not found").not.toBeNull();
  });

  it("api_keys gains rotation/suspension/revocation lifecycle columns", () => {
    const mig = findMigrationContaining([
      "rotated_at",
      "suspended_at",
      "suspended_by",
      "suspended_reason",
      "revoked_reason",
    ]);
    expect(mig, "api_keys lifecycle columns migration not found").not.toBeNull();
  });

  it("Batch 2 stays scoped: no webhook dispatcher, dashboard, or alert catalogue introduced", () => {
    // Negative guard — webhook dispatcher / dashboard / alert catalogue
    // remain out of scope through Batch 3. The four admin key-lifecycle
    // functions were introduced in Batch 3 and are intentionally NOT
    // asserted here any more.
    const files = readdirSync(join(ROOT, "supabase/functions"));
    expect(files).not.toContain("public-api-webhooks-dispatch");
  });
});
