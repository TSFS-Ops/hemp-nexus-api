/**
 * Public API V1 — Batch 11 contract guards.
 *
 * Static source-contract tests for the API support ticket intake and
 * status visibility layer:
 *   • api_support_tickets table exists with the required fields,
 *     CHECK constraints, and RLS scoped to internal roles + RPC paths.
 *   • SECURITY DEFINER RPCs gate client access via can_manage_api_client_support
 *     and never expose internal_notes / internal_owner to client users.
 *   • Audit events for create / status change / owner assigned / internal
 *     note added / client-visible response updated / resolved / closed.
 *   • Batch 9 internal monitoring overview is rewired so open_support_tickets
 *     is a real count from api_support_tickets, not a deferred placeholder.
 *   • Batch 10 docs/OpenAPI references the in-product API Support tab.
 *   • Hard exclusions: no payment, invoice, webhook, write API, file
 *     upload, evidence/document, POI/WaD/compliance decision logic.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

const CLIENT_PANEL = "src/components/developer/ClientSupportPanel.tsx";
const ADMIN_PANEL = "src/components/admin/AdminApiSupportTicketsPanel.tsx";
const DEV_SHELL = "src/components/developer/DeveloperShell.tsx";
const DEV_CENTER = "src/pages/DeveloperCenter.tsx";
const HQ = "src/pages/HQ.tsx";
const MONITORING_PANEL = "src/components/admin/AdminApiMonitoringPanel.tsx";
const OPENAPI = "supabase/functions/_shared/public-api-v1-openapi.ts";

function findBatch11Migration(): string {
  const dir = path.join(ROOT, "supabase/migrations");
  for (const f of fs.readdirSync(dir)) {
    const body = fs.readFileSync(path.join(dir, f), "utf-8");
    if (/CREATE TABLE public\.api_support_tickets/i.test(body)) return body;
  }
  return "";
}

describe("Public API V1 · Batch 11 · support ticket intake & status visibility", () => {
  // ─── Files exist ─────────────────────────────────────────────────
  it("client support panel exists", () => {
    expect(exists(CLIENT_PANEL)).toBe(true);
  });
  it("admin support tickets panel exists", () => {
    expect(exists(ADMIN_PANEL)).toBe(true);
  });
  it("Batch 11 migration creates api_support_tickets", () => {
    const mig = findBatch11Migration();
    expect(mig.length).toBeGreaterThan(0);
  });

  // ─── Required table fields ───────────────────────────────────────
  const REQUIRED_FIELDS = [
    "api_client_id", "org_id", "created_by", "subject", "environment",
    "severity", "category", "description", "contact_name", "contact_email",
    "status", "internal_owner", "internal_notes", "client_visible_response",
    "resolved_at", "closed_at", "created_at", "updated_at",
  ];
  it("api_support_tickets includes every required field", () => {
    const mig = findBatch11Migration();
    for (const f of REQUIRED_FIELDS) {
      expect(mig.includes(f)).toBe(true);
    }
  });

  it("status / severity / category constraints exist with the agreed enums", () => {
    const mig = findBatch11Migration();
    expect(mig).toMatch(/status text NOT NULL DEFAULT 'open' CHECK \(status IN \(/);
    for (const s of ["open", "triaged", "in_progress", "waiting_on_client", "resolved", "closed"]) {
      expect(mig.includes(`'${s}'`)).toBe(true);
    }
    expect(mig).toMatch(/severity text NOT NULL CHECK \(severity IN \(/);
    for (const s of ["low", "medium", "high", "urgent"]) {
      expect(mig.includes(`'${s}'`)).toBe(true);
    }
    expect(mig).toMatch(/category text NOT NULL CHECK \(category IN \(/);
    for (const c of [
      "authentication", "sandbox", "production", "rate_limit", "monthly_limit",
      "unexpected_response", "outage_or_degradation", "billing_visibility",
      "documentation", "other",
    ]) {
      expect(mig.includes(`'${c}'`)).toBe(true);
    }
  });

  it("environment constraint exists", () => {
    const mig = findBatch11Migration();
    expect(mig).toMatch(/environment text NOT NULL CHECK \(environment IN \('sandbox','production','unspecified'\)\)/);
  });

  // ─── RLS / access pattern ─────────────────────────────────────────
  it("RLS is enabled on api_support_tickets", () => {
    const mig = findBatch11Migration();
    expect(mig).toMatch(/ALTER TABLE public\.api_support_tickets ENABLE ROW LEVEL SECURITY/);
  });

  it("direct SELECT is restricted to internal roles only", () => {
    const mig = findBatch11Migration();
    expect(mig).toMatch(/Internal API roles read all support tickets[\s\S]*?has_role\(auth\.uid\(\), 'platform_admin'[\s\S]*?'api_admin'[\s\S]*?'auditor'/);
  });

  it("UPDATE policy is restricted to platform_admin / api_admin only (auditor read-only)", () => {
    const mig = findBatch11Migration();
    const block = (mig.match(/CREATE POLICY "Platform\/API admins manage support tickets"[\s\S]*?WITH CHECK \([\s\S]*?\);/) || [""])[0];
    expect(block).toMatch(/has_role\(auth\.uid\(\), 'platform_admin'/);
    expect(block).toMatch(/has_role\(auth\.uid\(\), 'api_admin'/);
    expect(block).not.toMatch(/'auditor'/);
  });

  it("no INSERT policy on the table (client writes go via RPC only)", () => {
    const mig = findBatch11Migration();
    expect(/CREATE POLICY[^;]*ON public\.api_support_tickets FOR INSERT/i.test(mig)).toBe(false);
  });

  // ─── Authorisation helper + RPC entry points ──────────────────────
  it("can_manage_api_client_support routes via has_role + is_org_admin", () => {
    const mig = findBatch11Migration();
    expect(mig).toMatch(/CREATE OR REPLACE FUNCTION public\.can_manage_api_client_support\(/);
    expect(mig).toMatch(/is_org_admin\(_user_id,\s*c\.org_id\)/);
    expect(mig).toMatch(/has_role\(_user_id, 'platform_admin'/);
    expect(mig).toMatch(/has_role\(_user_id, 'api_admin'/);
    expect(mig).toMatch(/has_role\(_user_id, 'auditor'/);
  });

  it("create / list / update RPCs are SECURITY DEFINER and granted to authenticated", () => {
    const mig = findBatch11Migration();
    for (const fn of [
      "create_api_support_ticket",
      "list_api_support_tickets_for_client",
      "list_api_support_tickets_internal",
      "update_api_support_ticket_internal",
    ]) {
      expect(mig.includes(fn)).toBe(true);
      expect(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}`).test(mig)).toBe(true);
    }
    expect((mig.match(/SECURITY DEFINER/g) || []).length).toBeGreaterThanOrEqual(4);
  });

  it("client-shape RPC NEVER returns internal_notes or internal_owner", () => {
    const mig = findBatch11Migration();
    const shape = (mig.match(/public_api_support_ticket_client_shape[\s\S]*?\$\$/) || [""])[0];
    expect(shape.length).toBeGreaterThan(0);
    expect(/'internal_notes'/i.test(shape)).toBe(false);
    expect(/'internal_owner'/i.test(shape)).toBe(false);
  });

  it("internal-shape RPC includes internal_notes and internal_owner", () => {
    const mig = findBatch11Migration();
    const shape = (mig.match(/public_api_support_ticket_internal_shape[\s\S]*?\$\$/) || [""])[0];
    expect(/'internal_notes'/i.test(shape)).toBe(true);
    expect(/'internal_owner'/i.test(shape)).toBe(true);
  });

  it("list_api_support_tickets_for_client gates on can_manage_api_client_support", () => {
    const mig = findBatch11Migration();
    const fn = (mig.match(/CREATE OR REPLACE FUNCTION public\.list_api_support_tickets_for_client[\s\S]*?\$\$;/) || [""])[0];
    expect(fn).toMatch(/can_manage_api_client_support\(v_uid, p_api_client_id\)/);
    expect(fn).toMatch(/public_api_support_ticket_client_shape/);
  });

  it("list_api_support_tickets_internal gates on platform_admin / api_admin / auditor", () => {
    const mig = findBatch11Migration();
    const fn = (mig.match(/CREATE OR REPLACE FUNCTION public\.list_api_support_tickets_internal[\s\S]*?\$\$;/) || [""])[0];
    expect(fn).toMatch(/has_role\(v_uid, 'platform_admin'/);
    expect(fn).toMatch(/has_role\(v_uid, 'api_admin'/);
    expect(fn).toMatch(/has_role\(v_uid, 'auditor'/);
    expect(fn).toMatch(/public_api_support_ticket_internal_shape/);
  });

  it("update_api_support_ticket_internal blocks auditor and ordinary users", () => {
    const mig = findBatch11Migration();
    const fn = (mig.match(/CREATE OR REPLACE FUNCTION public\.update_api_support_ticket_internal[\s\S]*?\$\$;/) || [""])[0];
    expect(fn).toMatch(/has_role\(v_uid, 'platform_admin'/);
    expect(fn).toMatch(/has_role\(v_uid, 'api_admin'/);
    // No fallthrough to auditor; auditor read-only.
    expect(/has_role\(v_uid, 'auditor'/.test(fn)).toBe(false);
  });

  // ─── Audit events ─────────────────────────────────────────────────
  const AUDIT_ACTIONS = [
    "public_api.v1.support.ticket_created",
    "public_api.v1.support.ticket_status_changed",
    "public_api.v1.support.internal_owner_assigned",
    "public_api.v1.support.internal_note_added",
    "public_api.v1.support.client_visible_response_updated",
    "public_api.v1.support.ticket_resolved",
    "public_api.v1.support.ticket_closed",
  ];
  it("all required audit events are emitted from the RPCs", () => {
    const mig = findBatch11Migration();
    for (const a of AUDIT_ACTIONS) {
      expect(mig.includes(`'${a}'`)).toBe(true);
    }
  });

  it("audit metadata never references raw API keys / secrets / key_hash", () => {
    const mig = findBatch11Migration();
    for (const banned of [/'api_key'/i, /'key_hash'/i, /'secret'/i]) {
      expect(banned.test(mig)).toBe(false);
    }
  });

  // ─── Notifications via existing infrastructure only ───────────────
  it("notifications are written into the existing public.notifications table", () => {
    const mig = findBatch11Migration();
    expect(mig).toMatch(/INSERT INTO public\.notifications/);
    // No new external messaging providers / no SMS / no WhatsApp.
    for (const re of [/twilio/i, /\bsms\b/i, /whatsapp/i, /slack/i]) {
      expect(re.test(mig)).toBe(false);
    }
  });

  // ─── Monitoring rewire (Batch 9) ──────────────────────────────────
  it("Batch 9 monitoring no longer shows support ticket placeholder when wired", () => {
    const mig = findBatch11Migration();
    expect(mig).toMatch(/'open_support_tickets',\s*open_support_tickets/);
    expect(mig).toMatch(/'open_support_tickets_status',\s*'live_from_api_support_tickets'/);
    const panel = read(MONITORING_PANEL);
    expect(/"deferred"/.test(panel)).toBe(false);
  });

  // ─── Client UI surface ────────────────────────────────────────────
  it("client support panel uses RPCs only — no direct table access for tickets", () => {
    const src = read(CLIENT_PANEL);
    expect(src).toMatch(/create_api_support_ticket/);
    expect(src).toMatch(/list_api_support_tickets_for_client/);
    // Client UI must never reference internal-only columns.
    expect(/internal_notes/i.test(src)).toBe(false);
    expect(/internal_owner/i.test(src)).toBe(false);
  });

  it("client support panel exposes required form fields", () => {
    const src = read(CLIENT_PANEL);
    for (const f of [
      "subject", "environment", "severity", "category", "description",
      "contactName", "contactEmail", "requestIdField", "endpointField",
      "externalRef", "approxTime", "apiClientId",
    ]) {
      expect(src.includes(f)).toBe(true);
    }
  });

  it("client support panel exposes all required category values", () => {
    const src = read(CLIENT_PANEL);
    for (const c of [
      "authentication", "sandbox", "production", "rate_limit", "monthly_limit",
      "unexpected_response", "outage_or_degradation", "billing_visibility",
      "documentation", "other",
    ]) {
      expect(src.includes(`"${c}"`)).toBe(true);
    }
  });

  it("Developer Centre exposes /developer/support route + sidebar nav", () => {
    const shell = read(DEV_SHELL);
    const center = read(DEV_CENTER);
    expect(shell).toMatch(/\/developer\/support/);
    expect(shell).toMatch(/API Support/);
    expect(center).toMatch(/path="support"/);
    expect(center).toMatch(/ClientSupportPanel/);
  });

  it("HQ exposes an internal api-support sub-tab", () => {
    const hq = read(HQ);
    expect(hq).toMatch(/AdminApiSupportTicketsPanel/);
    expect(hq).toMatch(/"api-support"/);
  });

  it("admin panel renders internal_notes only and labels them as never shown to client", () => {
    const src = read(ADMIN_PANEL);
    expect(src).toMatch(/NEVER shown to client/);
    expect(src).toMatch(/list_api_support_tickets_internal/);
    expect(src).toMatch(/update_api_support_ticket_internal/);
  });

  // ─── Docs update (Batch 10) ───────────────────────────────────────
  it("Batch 10 docs/OpenAPI now references the in-product API Support tab", () => {
    const spec = read(OPENAPI);
    expect(spec).toMatch(/in-product API Support tab/i);
    expect(spec).toMatch(/no public \/v1\/support endpoint/i);
  });

  // ─── Hard exclusions ──────────────────────────────────────────────
  it("no payment / invoice / webhook / write-API / file-upload logic in Batch 11", () => {
    const mig = findBatch11Migration();
    const banned = [
      /payment_intent/i,
      /\binvoice\b/i,
      /tax_invoice/i,
      /payfast/i,
      /paystack/i,
      /webhook/i,
      /storage\.from\(/i,
      /file_upload/i,
      /attachment/i,
    ];
    for (const re of banned) expect(re.test(mig)).toBe(false);
  });

  it("no public-API gateway support endpoint introduced", () => {
    expect(exists("supabase/functions/public-api-support-intake")).toBe(false);
    expect(exists("supabase/functions/public-api-support")).toBe(false);
    const gw = read("supabase/functions/public-api/index.ts");
    expect(/\/v1\/support/i.test(gw)).toBe(false);
  });

  it("no POI / WaD / payment / credit / compliance / verification decisions in Batch 11", () => {
    const mig = findBatch11Migration();
    const banned = [
      /\bpois\b/i, /\bwads\b/i, /collapse_ledger/i, /compliance_holds/i,
      /token_ledger/i, /governance_documents/i, /vault_documents/i,
      /screening_results/i, /atomic_token_burn/i, /atomic_generate_poi/i,
    ];
    for (const re of banned) expect(re.test(mig)).toBe(false);
  });

  it("client UI does not allow file uploads in Batch 11", () => {
    const src = read(CLIENT_PANEL);
    expect(/type="file"/i.test(src)).toBe(false);
    expect(/FormData\(/i.test(src)).toBe(false);
  });
});
