/**
 * Public API V1 — Batch 1 contract guards (api_clients onboarding record).
 *
 * Static source-contract tests (file content invariants). Verifies the Batch 1
 * scope was NOT silently expanded into key issuance, public endpoints,
 * billing, sandbox seed records, OpenAPI/docs, or webhook changes.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const PANEL_PATH = path.join(PROJECT_ROOT, "src/components/admin/AdminApiClientsPanel.tsx");
const HQ_PATH = path.join(PROJECT_ROOT, "src/pages/HQ.tsx");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "supabase/migrations");

function readFile(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

function findMigrationCreatingApiClients(): string {
  const files = fs.readdirSync(MIGRATIONS_DIR).sort();
  for (const f of files) {
    const body = readFile(path.join(MIGRATIONS_DIR, f));
    if (/CREATE TABLE public\.api_clients/i.test(body)) return body;
  }
  throw new Error("Batch 1: migration creating public.api_clients not found");
}

describe("Public API V1 · Batch 1 · api_clients onboarding record", () => {
  it("admin panel exists and is platform-admin gated", () => {
    expect(fs.existsSync(PANEL_PATH)).toBe(true);
    const src = readFile(PANEL_PATH);
    // canWrite is derived from isAdmin (platform_admin)
    expect(src).toMatch(/const canWrite = !!isAdmin/);
    // read-only banner exists for non-admins
    expect(src).toMatch(/Read-only view/i);
  });

  it("admin panel writes audit events for every lifecycle action", () => {
    const src = readFile(PANEL_PATH);
    for (const action of [
      "api_client.created",
      "api_client.updated",
      "api_client.sandbox_approved",
      "api_client.production_requested",
      "api_client.production_checklist_updated",
      "api_client.production_approved",
      "api_client.suspended",
      "api_client.revoked",
    ]) {
      expect(src, `missing audit action: ${action}`).toContain(action);
    }
  });

  it("HQ page wires the API Clients sub-tab under Organisations", () => {
    const src = readFile(HQ_PATH);
    expect(src).toMatch(/AdminApiClientsPanel/);
    expect(src).toMatch(/value="api-clients"/);
  });

  it("migration enforces production-approval checklist at DB level", () => {
    const sql = findMigrationCreatingApiClients();
    expect(sql).toMatch(/api_clients_enforce_production_checklist/);
    // every checklist field must be referenced inside the gate
    for (const field of [
      "signed_api_agreement_confirmed",
      "commercial_plan_approved",
      "sandbox_checklist_completed",
      "production_scopes_approved",
      "production_technical_contact_confirmed",
      "billing_details_confirmed",
      "retention_rules_confirmed",
      "security_contact_confirmed",
      "ip_allowlist_or_exception_confirmed",
      "sandbox_approved",
    ]) {
      expect(sql, `gate must check ${field}`).toContain(field);
    }
  });

  it("migration enforces RLS with platform_admin write + api_admin/auditor read only", () => {
    const sql = findMigrationCreatingApiClients();
    expect(sql).toMatch(/ALTER TABLE public\.api_clients ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/Platform admins manage api_clients[\s\S]*FOR ALL[\s\S]*is_admin\(auth\.uid\(\)\)/);
    expect(sql).toMatch(/API admins read api_clients[\s\S]*FOR SELECT[\s\S]*has_role\(auth\.uid\(\), 'api_admin'\)/);
    expect(sql).toMatch(/Auditors read api_clients[\s\S]*FOR SELECT[\s\S]*has_role\(auth\.uid\(\), 'auditor'\)/);
    // No INSERT/UPDATE/DELETE policy for api_admin or auditor.
    const apiAdminWritePolicy = /API admins[\s\S]*?(INSERT|UPDATE|DELETE)/i;
    expect(apiAdminWritePolicy.test(sql.replace(/API admins read api_clients[\s\S]*?USING[\s\S]*?\);/, ""))).toBe(false);
  });

  it("status CHECK constraint covers the seven lifecycle values", () => {
    const sql = findMigrationCreatingApiClients();
    for (const status of [
      "draft",
      "sandbox_pending",
      "sandbox_approved",
      "production_pending",
      "production_approved",
      "suspended",
      "revoked",
    ]) {
      expect(sql).toContain(`'${status}'`);
    }
  });

  it("table references organizations.id and does NOT mutate organisations schema", () => {
    const sql = findMigrationCreatingApiClients();
    expect(sql).toMatch(/REFERENCES public\.organizations\(id\)/);
    // Batch 1 must not ALTER organizations
    expect(sql).not.toMatch(/ALTER TABLE public\.organizations/i);
  });

  it("Batch 1 does NOT introduce API keys, endpoints, billing, or webhook changes", () => {
    const sql = findMigrationCreatingApiClients();
    // Forbidden artefacts in this batch's migration:
    expect(sql).not.toMatch(/CREATE TABLE public\.api_commercial_plans/i);
    expect(sql).not.toMatch(/CREATE TABLE public\.api_sandbox_records/i);
    expect(sql).not.toMatch(/CREATE TABLE public\.api_support_tickets/i);
    expect(sql).not.toMatch(/ALTER TABLE public\.api_keys/i);
    expect(sql).not.toMatch(/ALTER TABLE public\.api_request_logs/i);
    expect(sql).not.toMatch(/ALTER TABLE public\.webhook_endpoints/i);

    // Panel must not call key issuance / rotate / revoke edge fns or build endpoints.
    const panel = readFile(PANEL_PATH);
    expect(panel).not.toMatch(/functions\.invoke\(["']api-keys/);
    expect(panel).not.toMatch(/\/v1\/counterparty/);
    expect(panel).not.toMatch(/openapi/i);
    expect(panel).not.toMatch(/rotate.{0,20}key/i);
  });
});
