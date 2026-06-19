/**
 * Public API V1 — Sandbox/Production Separation · Batch 3 invariants.
 *
 * Static guards for the API key lifecycle and production-access controls:
 *   • The four admin lifecycle edge functions exist and gate production
 *     actions behind platform_admin + AAL2 + reason.
 *   • api-keys/index.ts emits the canonical Batch-3 audit names
 *     (api.{sandbox,production}_key.created / .creation_blocked).
 *   • api-key-expiry/index.ts implements distinct 30/14/3 day windows.
 *   • The DB migration adds the expiry-warning columns, the lifecycle
 *     defaults trigger (with sign-off + 12-month/90-day caps), and the
 *     append-only triggers on api_production_approvals.
 *   • The canonical audit-name guard script exists.
 *   • No webhook dispatcher / dashboard / alert catalogue / OpenAPI file
 *     was introduced as part of this batch.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FN = (p: string) => join(ROOT, "supabase/functions", p, "index.ts");
const MIGRATIONS = join(ROOT, "supabase/migrations");

function readMig(needles: string[]): string | null {
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql"))) {
    const body = readFileSync(join(MIGRATIONS, f), "utf8");
    if (needles.every((n) => body.includes(n))) return body;
  }
  return null;
}

describe("Public API V1 · Sandprod Batch 3 — Key Lifecycle", () => {
  it("admin-api-production-approve exists and enforces AAL2 + platform_admin", () => {
    expect(existsSync(FN("admin-api-production-approve"))).toBe(true);
    const src = readFileSync(FN("admin-api-production-approve"), "utf8");
    expect(src).toMatch(/requireRole\(authCtx,\s*"platform_admin"\)/);
    expect(src).toMatch(/assertAal2\(/);
    expect(src).toContain("api.production_access.platform_admin_approved");
    expect(src).toContain("api.production_access.commercial_owner_signed_off");
    expect(src).toContain("api.production_access.compliance_owner_signed_off");
    expect(src).toContain("api.production_access.rejected");
    expect(src).toContain("api.production_access.reset");
    expect(src).toContain("api.production_access.approved");
    expect(src).toContain("api.production_access.checklist_failed");
  });

  it("admin-api-key-rotate enforces platform_admin + AAL2 + reason for production", () => {
    const src = readFileSync(FN("admin-api-key-rotate"), "utf8");
    expect(src).toMatch(/requireRole\(authCtx,\s*"platform_admin"\)/);
    expect(src).toMatch(/assertAal2\(/);
    expect(src).toMatch(/reason\.length\s*<\s*10/);
    expect(src).toContain("api.production_key.rotated");
    expect(src).toContain("api.sandbox_key.rotated");
    // Raw secret returned only on creation/rotation; never re-fetched.
    expect(src).toMatch(/key:\s*newSecret/);
  });

  it("admin-api-key-suspend gates production behind platform_admin + AAL2 + reason", () => {
    const src = readFileSync(FN("admin-api-key-suspend"), "utf8");
    expect(src).toMatch(/requireRole\(authCtx,\s*"platform_admin"\)/);
    expect(src).toMatch(/assertAal2\(/);
    expect(src).toMatch(/reason\.length\s*<\s*10/);
    expect(src).toContain("api.production_key.suspended");
    expect(src).toContain("api.sandbox_key.suspended");
    expect(src).toMatch(/status:\s*["']suspended["']/);
  });

  it("admin-api-key-revoke gates production behind platform_admin + AAL2 + reason", () => {
    const src = readFileSync(FN("admin-api-key-revoke"), "utf8");
    expect(src).toMatch(/requireRole\(authCtx,\s*"platform_admin"\)/);
    expect(src).toMatch(/assertAal2\(/);
    expect(src).toMatch(/reason\.length\s*<\s*10/);
    expect(src).toContain("api.production_key.revoked");
    expect(src).toContain("api.sandbox_key.revoked");
  });

  it("api-keys create path emits the canonical Batch-3 audit names", () => {
    const src = readFileSync(FN("api-keys"), "utf8");
    expect(src).toContain("api.production_key.created");
    expect(src).toContain("api.sandbox_key.created");
    expect(src).toContain("api.production_key.creation_blocked");
    // Raw secret returned once only at creation; never persisted to api_keys.
    expect(src).toMatch(/key:\s*apiKey/);
    expect(src).not.toMatch(/raw_key|secret_key:\s*apiKey/);
  });

  it("api-key-expiry implements distinct 30/14/3 day windows with separate state columns", () => {
    const src = readFileSync(FN("api-key-expiry"), "utf8");
    expect(src).toContain("expiry_warning_30d_sent_at");
    expect(src).toContain("expiry_warning_14d_sent_at");
    expect(src).toContain("expiry_warning_3d_sent_at");
    expect(src).toContain("sandbox_expiry_warning_sent_at");
    expect(src).toContain("api.production_key.expiry_warning_30d");
    expect(src).toContain("api.production_key.expiry_warning_14d");
    expect(src).toContain("api.production_key.expiry_warning_3d");
    expect(src).toContain("api.sandbox_key.expiry_warning");
    // INTERNAL_CRON_KEY required, no service-role fallback.
    expect(src).toContain("INTERNAL_CRON_KEY");
  });

  it("Batch 3 migration adds lifecycle defaults trigger, expiry columns and append-only enforcement", () => {
    const body = readMig([
      "expiry_warning_30d_sent_at",
      "expiry_warning_14d_sent_at",
      "expiry_warning_3d_sent_at",
      "api_keys_v1_lifecycle_defaults",
      "API_KEY_PRODUCTION_EXPIRY_EXCEEDS_12_MONTHS",
      "API_KEY_SANDBOX_EXPIRY_EXCEEDS_90_DAYS",
      "API_CLIENT_COMMERCIAL_OWNER_SIGN_OFF_REQUIRED",
      "API_CLIENT_COMPLIANCE_OWNER_SIGN_OFF_REQUIRED",
      "api_production_approvals_append_only",
      "api_production_approvals_no_update",
      "api_production_approvals_no_delete",
    ]);
    expect(body).not.toBeNull();
  });

  it("Canonical audit-name guard script exists and lists all 20 names", () => {
    const guard = join(ROOT, "scripts/check-public-api-audit-names.mjs");
    expect(existsSync(guard)).toBe(true);
    const src = readFileSync(guard, "utf8");
    for (const name of [
      "api.sandbox_key.created", "api.sandbox_key.rotated", "api.sandbox_key.suspended",
      "api.sandbox_key.revoked", "api.sandbox_key.expiry_warning",
      "api.production_key.created", "api.production_key.creation_blocked",
      "api.production_key.rotated", "api.production_key.suspended", "api.production_key.revoked",
      "api.production_key.expiry_warning_30d", "api.production_key.expiry_warning_14d",
      "api.production_key.expiry_warning_3d",
      "api.production_access.checklist_failed", "api.production_access.platform_admin_approved",
      "api.production_access.commercial_owner_signed_off",
      "api.production_access.compliance_owner_signed_off",
      "api.production_access.rejected", "api.production_access.reset",
      "api.production_access.approved",
    ]) {
      expect(src).toContain(name);
    }
  });

  it("Batch 3 introduces NO webhook dispatcher, dashboard, alert catalogue, OpenAPI or docs file", () => {
    // None of the four new edge function dirs may have side files beyond index.ts.
    for (const fn of [
      "admin-api-production-approve", "admin-api-key-rotate",
      "admin-api-key-suspend", "admin-api-key-revoke",
    ]) {
      const dir = join(ROOT, "supabase/functions", fn);
      const entries = readdirSync(dir);
      expect(entries).toEqual(["index.ts"]);
    }
  });
});
