/**
 * Public API V1 — Batch 4 contract guards.
 *
 * Static source-contract tests for the sandbox seed records and isolation
 * layer. Verifies the api_sandbox_records table migration, the 16 required
 * scenario codes are seeded, isolation/fictionality rules are encoded, and
 * no out-of-scope V1 surface (counterparty lookup/summary, usage, docs,
 * billing, dashboards, support, webhooks, write APIs) was introduced.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

const MIG_DIR = path.join(ROOT, "supabase/migrations");

function findBatch4Migration(): string {
  for (const f of fs.readdirSync(MIG_DIR)) {
    const body = fs.readFileSync(path.join(MIG_DIR, f), "utf-8");
    if (/CREATE TABLE\s+public\.api_sandbox_records/i.test(body)) {
      return body;
    }
  }
  throw new Error("Batch 4 sandbox migration not found");
}

const REQUIRED_SCENARIOS = [
  "verified_match",
  "unverified_match",
  "no_match",
  "multiple_possible_matches",
  "blocked_record",
  "stale_record",
  "unsupported_country",
  "missing_required_field",
  "invalid_api_key",
  "expired_api_key",
  "insufficient_scope",
  "sandbox_only_record",
  "production_access_required",
  "provider_unavailable",
  "internal_error",
  "rate_limit_exceeded",
];

describe("Public API V1 · Batch 4 · sandbox seed records", () => {
  const mig = findBatch4Migration();

  it("api_sandbox_records table is created with required columns", () => {
    expect(mig).toMatch(/CREATE TABLE\s+public\.api_sandbox_records/);
    for (const col of [
      "scenario_code",
      "legal_name",
      "trading_name",
      "registration_number",
      "country",
      "website_domain",
      "email_domain",
      "match_status",
      "confidence_band",
      "verification_status",
      "risk_signal_summary",
      "data_freshness_date",
      "record_scope",
      "next_action",
      "candidates",
      "test_data",
      "active",
      "created_at",
      "updated_at",
    ]) {
      expect(mig).toContain(col);
    }
  });

  it("scenario_code is unique", () => {
    expect(mig).toMatch(/UNIQUE\s*\(\s*scenario_code\s*\)/i);
  });

  it("test_data is locked to true at the database level", () => {
    expect(mig).toMatch(/CHECK\s*\(\s*test_data\s*=\s*true\s*\)/i);
  });

  it("record_scope is locked to sandbox_only", () => {
    expect(mig).toMatch(/record_scope[^)]*IN\s*\(\s*'sandbox_only'\s*\)/i);
  });

  it("candidates array is capped at 5 (multi-match scenario)", () => {
    expect(mig).toMatch(/jsonb_array_length\s*\(\s*candidates\s*\)\s*<=\s*5/i);
  });

  it("RLS is enabled with platform_admin manage and api_admin / auditor read", () => {
    expect(mig).toMatch(/ALTER TABLE\s+public\.api_sandbox_records\s+ENABLE ROW LEVEL SECURITY/i);
    expect(mig).toMatch(/CREATE POLICY[^;]*api_sandbox_records[^;]*FOR ALL[^;]*is_admin/is);
    expect(mig).toMatch(/CREATE POLICY[^;]*api_sandbox_records[^;]*FOR SELECT[^;]*'api_admin'/is);
    expect(mig).toMatch(/CREATE POLICY[^;]*api_sandbox_records[^;]*FOR SELECT[^;]*'auditor'/is);
  });

  it("GRANTs are present (authenticated + service_role) — no anon grant", () => {
    expect(mig).toMatch(/GRANT[^;]*ON\s+public\.api_sandbox_records\s+TO\s+authenticated/i);
    expect(mig).toMatch(/GRANT\s+ALL[^;]*ON\s+public\.api_sandbox_records\s+TO\s+service_role/i);
    expect(mig).not.toMatch(/GRANT[^;]*ON\s+public\.api_sandbox_records\s+TO\s+anon/i);
  });

  it("fictional-domain enforcement trigger is installed", () => {
    expect(mig).toMatch(/api_sandbox_records_enforce_fictional/);
    expect(mig).toMatch(/api_sandbox_records_fictional_gate/);
    // The allowed suffixes are encoded
    for (const dom of ["example.com", "example.test", "izenzo.test", "sandbox.izenzo.test"]) {
      expect(mig).toContain(dom);
    }
  });

  it("all 16 required scenario codes are seeded", () => {
    for (const code of REQUIRED_SCENARIOS) {
      expect(mig).toContain(`'${code}'`);
    }
  });

  it("seed is idempotent (ON CONFLICT scenario_code DO UPDATE)", () => {
    expect(mig).toMatch(/ON CONFLICT\s*\(\s*scenario_code\s*\)\s*DO UPDATE/i);
  });

  it("multi-match scenario has up to 5 candidate summaries in JSONB", () => {
    expect(mig).toContain("multiple_possible_matches");
    // Five candidate ids
    for (const cid of ["cand-1", "cand-2", "cand-3", "cand-4", "cand-5"]) {
      expect(mig).toContain(cid);
    }
  });

  it("seed uses only reserved test domains (no real client domains)", () => {
    // Pull the INSERT body and check every quoted host-shaped token
    const insertMatch = mig.match(/INSERT INTO public\.api_sandbox_records[\s\S]*?ON CONFLICT/);
    expect(insertMatch).toBeTruthy();
    const body = insertMatch![0];
    // Any 'foo.bar' style domain literal must end in a reserved suffix
    const domainTokens = body.match(/'[a-z0-9][a-z0-9.-]*\.(?:com|test|net|org|io|co|uk|za|ie|de|fr|us)'/gi) || [];
    for (const tok of domainTokens) {
      const lc = tok.toLowerCase();
      const ok =
        lc.endsWith(".example.com'") ||
        lc.endsWith("'example.com'") ||
        lc.endsWith(".example.test'") ||
        lc.endsWith("'example.test'") ||
        lc.endsWith(".izenzo.test'") ||
        lc.endsWith("'izenzo.test'") ||
        lc.endsWith(".sandbox.izenzo.test'") ||
        lc.endsWith("'sandbox.izenzo.test'");
      expect(ok, `seed domain ${tok} is not a reserved test domain`).toBe(true);
    }
  });

  it("seed never references real internal tables", () => {
    const insertMatch = mig.match(/INSERT INTO public\.api_sandbox_records[\s\S]*?ON CONFLICT/);
    const body = insertMatch![0];
    for (const forbidden of [
      "organizations",
      "matches",
      "pois",
      "wads",
      "match_documents",
      "governance_doc_registry",
      "governance_documents",
      "vault_documents",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("hard exclusions — no Batch-4-forbidden V1 surface introduced", () => {
    // No new edge functions for counterparty / usage / docs / openapi / billing / support / webhooks
    expect(exists("supabase/functions/public-api-counterparty-lookup")).toBe(false);
    expect(exists("supabase/functions/public-api-counterparty-summary")).toBe(false);
    expect(exists("supabase/functions/public-api-usage-current")).toBe(false);
    expect(exists("supabase/functions/public-api-docs")).toBe(false);
    expect(exists("supabase/functions/public-api-openapi")).toBe(false);
    expect(exists("supabase/functions/public-api-support-intake")).toBe(false);

    // The existing public-api entry was NOT extended with these routes
    const entry = read("supabase/functions/public-api/index.ts");
    expect(entry).not.toMatch(/counterparty/i);
    expect(entry).not.toMatch(/\/v1\/usage/);
    expect(entry).not.toMatch(/\/v1\/docs/);
    expect(entry).not.toMatch(/openapi/i);
    expect(entry).not.toMatch(/sandbox_record|api_sandbox_records/);

    // No Batch 4 migration introduces commercial plans / support intake / webhook changes
    expect(mig).not.toMatch(/CREATE TABLE[^;]*api_commercial_plans/i);
    expect(mig).not.toMatch(/CREATE TABLE[^;]*api_support_tickets/i);
    expect(mig).not.toMatch(/ALTER TABLE[^;]*webhook_(endpoints|deliveries|events)/i);
    expect(mig).not.toMatch(/CREATE TABLE[^;]*webhook_/i);

    // Sandbox records never reference auth.users, organizations, etc. via FK
    expect(mig).not.toMatch(/REFERENCES\s+public\.organizations/i);
    expect(mig).not.toMatch(/REFERENCES\s+auth\.users/i);
    expect(mig).not.toMatch(/REFERENCES\s+public\.(matches|pois|wads|match_documents)/i);
  });
});
