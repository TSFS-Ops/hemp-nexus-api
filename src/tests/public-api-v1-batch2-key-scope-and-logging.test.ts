/**
 * Public API V1 — Batch 2 contract guards.
 *
 * Static source-contract tests for:
 *   • V1 scope catalogue additions + forbidden scopes preserved
 *   • api-keys edge function gating + audit emission
 *   • _shared/auth.ts api_client status enforcement
 *   • Validation schema accepts api_client_id + environment
 *   • Migration adds api_keys.api_client_id, api_request_logs cols,
 *     api_ip_allowlist_exceptions table, and api_keys_v1_client_gate trigger
 *   • Admin panel surfaces key-readiness + IP exception sections
 *   • Hard exclusions — no public business endpoints, no billing, no
 *     sandbox seed records, no OpenAPI/docs, no webhook changes
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

function batch2Migration(): string {
  const dir = path.join(ROOT, "supabase/migrations");
  const files = fs.readdirSync(dir).sort();
  for (const f of files) {
    const body = fs.readFileSync(path.join(dir, f), "utf-8");
    if (/api_keys_v1_client_gate/.test(body)) return body;
  }
  throw new Error("Batch 2 migration not found");
}

describe("Public API V1 · Batch 2 · key gating, scopes, logging", () => {
  it("V1 scopes are added to the canonical catalogue", () => {
    const src = read("supabase/functions/_shared/api-scopes.ts");
    for (const s of [
      "api:status_read",
      "counterparty:lookup",
      "signals:read",
      "profile:summary_read",
      "usage:read",
    ]) {
      expect(src).toContain(`"${s}"`);
    }
  });

  it("forbidden scopes still rejected and legacy scopes preserved", () => {
    const src = read("supabase/functions/_shared/api-scopes.ts");
    expect(src).toMatch(/FORBIDDEN_SCOPES[\s\S]*"\*"[\s\S]*"admin"[\s\S]*""/);
    for (const legacy of ["match", "pois:read", "evidence", "webhooks", "wad"]) {
      expect(src).toContain(`"${legacy}"`);
    }
  });

  it("validation accepts api_client_id and environment", () => {
    const src = read("supabase/functions/_shared/validation.ts");
    expect(src).toMatch(/api_client_id:\s*z\.string\(\)\.uuid\(\)\.nullish\(\)/);
    expect(src).toMatch(/environment:\s*z\.enum\(\["sandbox",\s*"production"\]\)/);
  });

  it("api-keys edge fn forwards api_client_id + environment + maps gate codes", () => {
    const src = read("supabase/functions/api-keys/index.ts");
    expect(src).toContain("api_client_id, environment");
    expect(src).toContain("API_CLIENT_PRODUCTION_NOT_APPROVED");
    expect(src).toContain("API_CLIENT_PRODUCTION_CHECKLIST_INCOMPLETE");
    expect(src).toContain("API_KEY_PRODUCTION_REQUIRES_IP_ALLOWLIST_OR_EXCEPTION");
    expect(src).toContain("API_CLIENT_SANDBOX_NOT_APPROVED");
    // Differentiated audit actions
    expect(src).toContain("api_key.created.sandbox");
    expect(src).toContain("api_key.created.production");
    expect(src).toContain("api_key.blocked.production_not_approved");
    expect(src).toContain("api_key.blocked.production_ip_required");
    expect(src).toContain("api_key.blocked.sandbox_not_approved");
    expect(src).toContain("api_key.blocked.client_status");
  });

  it("rotation preserves api_client_id, environment, allowed_ips, allowed_origins", () => {
    const src = read("supabase/functions/api-keys/index.ts");
    expect(src).toMatch(/preserve linkage, environment, and IP\/origin allowlists across rotation/);
    expect(src).toMatch(/api_client_id:[^,]*existingKey/);
    expect(src).toMatch(/environment:[^,]*existingKey/);
  });

  it("plaintext API secret is only emitted on create/rotate, not on list/get", () => {
    const src = read("supabase/functions/api-keys/index.ts");
    // List response selects metadata only — no key_hash, no key field
    expect(src).toMatch(/\.select\('id, name, scopes, last_used_at, created_at, status, expires_at, environment, allowed_ips, allowed_origins'\)/);
    // PATCH rename returns only id+name
    expect(src).toMatch(/JSON\.stringify\(\{ id: data\.id, name: data\.name \}\)/);
  });

  it("auth.ts blocks otherwise-active keys when api_client is suspended/revoked", () => {
    const src = read("supabase/functions/_shared/auth.ts");
    expect(src).toContain("api_client_id, environment");
    expect(src).toMatch(/from\('api_clients'\)/);
    expect(src).toContain("api_key.blocked.client_status_use_attempt");
    expect(src).toMatch(/client\.status === 'suspended'/);
    expect(src).toMatch(/client\.status === 'revoked'/);
  });

  it("migration adds api_keys.api_client_id + api_request_logs additive columns", () => {
    const mig = batch2Migration();
    expect(mig).toMatch(/ALTER TABLE public\.api_keys\s+ADD COLUMN IF NOT EXISTS api_client_id uuid/i);
    expect(mig).toMatch(/api_request_logs[\s\S]*billable[\s\S]*scope_used[\s\S]*environment[\s\S]*external_reference[\s\S]*error_code/i);
  });

  it("migration creates api_ip_allowlist_exceptions with RLS + GRANTs", () => {
    const mig = batch2Migration();
    expect(mig).toMatch(/CREATE TABLE IF NOT EXISTS public\.api_ip_allowlist_exceptions/);
    expect(mig).toMatch(/GRANT[^;]*ON public\.api_ip_allowlist_exceptions TO authenticated/);
    expect(mig).toMatch(/GRANT ALL ON public\.api_ip_allowlist_exceptions TO service_role/);
    expect(mig).toMatch(/ENABLE ROW LEVEL SECURITY[\s\S]*ip_exception_platform_admin_all/);
    expect(mig).toMatch(/ip_exception_admin_auditor_read/);
  });

  it("migration installs api_keys_v1_client_gate trigger enforcing all gates", () => {
    const mig = batch2Migration();
    expect(mig).toMatch(/CREATE OR REPLACE FUNCTION public\.api_keys_v1_client_gate/);
    expect(mig).toContain("API_CLIENT_NOT_FOUND");
    expect(mig).toContain("API_CLIENT_BLOCKED_STATUS_");
    expect(mig).toContain("API_CLIENT_PRODUCTION_NOT_APPROVED");
    expect(mig).toContain("API_CLIENT_PRODUCTION_CHECKLIST_INCOMPLETE");
    expect(mig).toContain("API_KEY_PRODUCTION_REQUIRES_IP_ALLOWLIST_OR_EXCEPTION");
    expect(mig).toContain("API_CLIENT_SANDBOX_NOT_APPROVED");
    expect(mig).toMatch(/CREATE TRIGGER api_keys_v1_client_gate_trg[\s\S]*BEFORE INSERT ON public\.api_keys/);
  });

  it("admin panel surfaces key-readiness + IP exception sections", () => {
    const src = read("src/components/admin/AdminApiClientsPanel.tsx");
    expect(src).toContain("KeyReadinessSection");
    expect(src).toContain("IpExceptionSection");
    expect(src).toMatch(/from\("api_ip_allowlist_exceptions"\)/);
    expect(src).toContain("api_ip_exception.created");
    expect(src).toContain("api_ip_exception.deactivated");
  });

  it("hard exclusions — no public V1 business endpoints, OpenAPI, sandbox records, billing tables, webhook changes introduced", () => {
    // No new /v1/* edge functions yet
    expect(exists("supabase/functions/public-api-counterparty-lookup")).toBe(false);
    expect(exists("supabase/functions/public-api-counterparty-summary")).toBe(false);
    expect(exists("supabase/functions/public-api-usage-current")).toBe(false);
    expect(exists("supabase/functions/public-api-docs")).toBe(false);
    expect(exists("supabase/functions/public-api-openapi")).toBe(false);

    // No new sandbox / billing / commercial plan tables
    const mig = batch2Migration();
    expect(mig).not.toMatch(/CREATE TABLE[^;]*api_sandbox_records/i);
    expect(mig).not.toMatch(/CREATE TABLE[^;]*api_commercial_plans/i);
    expect(mig).not.toMatch(/CREATE TABLE[^;]*api_client_plans/i);
    expect(mig).not.toMatch(/CREATE TABLE[^;]*api_support_tickets/i);

    // No webhook table / function changes in this migration
    expect(mig).not.toMatch(/webhook_(endpoints|deliveries|events)/i);
  });
});
