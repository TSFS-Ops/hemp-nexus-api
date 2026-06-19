/**
 * Public API V1 · Sandbox / Production Separation — Batch 8
 *
 * UI / monitoring surfaces only. Contract checks that:
 *   • CommercialPlanCataloguePanel is mounted in HQ.
 *   • SandboxScenarioViewer exists and is mounted (read-only).
 *   • AdminApiSecuritySignalsPanel exists and is mounted (no export).
 *   • WebhookLogs exposes an environment filter and the request stream
 *     selects the `environment` column.
 *   • AdminApiMonitoringPanel keeps environment filter + sandbox option.
 *   • ClientUsageDashboard keeps sandbox/production split.
 *   • No webhook event types, OpenAPI docs, write API routes, OAuth/SSO,
 *     self-serve signup, payment collection or new alert catalogues are
 *     introduced by these UI files.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function read(p: string): string {
  return readFileSync(resolve(p), "utf8");
}

describe("Public API V1 — Sand/Prod Batch 8 · UI monitoring surfaces", () => {
  it("CommercialPlanCataloguePanel is exported and mounted in HQ", () => {
    const panel = read("src/components/admin/AdminApiClientsPanel.tsx");
    expect(panel).toMatch(/export function CommercialPlanCataloguePanel/);
    const hq = read("src/pages/HQ.tsx");
    expect(hq).toMatch(/CommercialPlanCataloguePanel/);
    expect(hq).toMatch(/<CommercialPlanCataloguePanel\s*\/>/);
    expect(hq).toMatch(/value="api-plans"/);
  });

  it("SandboxScenarioViewer exists, is read-only, and is mounted in HQ", () => {
    const src = read("src/components/admin/SandboxScenarioViewer.tsx");
    expect(src).toMatch(/export function SandboxScenarioViewer/);
    expect(src).toMatch(/api_sandbox_records/);
    // Read-only: no inserts/updates/deletes from the viewer.
    expect(src).not.toMatch(/\.insert\(/);
    expect(src).not.toMatch(/\.update\(/);
    expect(src).not.toMatch(/\.delete\(/);
    // No exports from the viewer.
    expect(src).not.toMatch(/auditedDownloadCSV|download =|Blob\(/);

    const hq = read("src/pages/HQ.tsx");
    expect(hq).toMatch(/<SandboxScenarioViewer\s*\/>/);
    expect(hq).toMatch(/value="api-sandbox"/);
  });

  it("AdminApiSecuritySignalsPanel exists, is triage-only and is mounted", () => {
    const src = read("src/components/admin/AdminApiSecuritySignalsPanel.tsx");
    expect(src).toMatch(/export function AdminApiSecuritySignalsPanel/);
    // Uses the same security-definer RPC as the monitoring panel.
    expect(src).toMatch(/get_api_monitoring_overview/);
    // Surfaces the operational security signals.
    expect(src).toMatch(/failed_auth_attempts/);
    expect(src).toMatch(/rate_limit_events/);
    expect(src).toMatch(/monthly_limit_events/);
    expect(src).toMatch(/ip_allowlist_exception_active/);
    // No CSV export from the security signals triage view.
    expect(src).not.toMatch(/auditedDownloadCSV|Blob\(|csvBody/);
    // No forbidden fields.
    for (const t of ["key_hash", "api_key", "secret", "document", "evidence", "governance", "poi", "wad", "payment", "compliance_note"]) {
      expect(src.toLowerCase()).not.toContain(t);
    }
    const hq = read("src/pages/HQ.tsx");
    expect(hq).toMatch(/<AdminApiSecuritySignalsPanel\s*\/>/);
    expect(hq).toMatch(/value="api-security"/);
  });

  it("WebhookLogs surfaces environment filter and selects environment column", () => {
    const src = read("src/components/developer/WebhookLogs.tsx");
    expect(src).toMatch(/data-testid="env-filter"/);
    expect(src).toMatch(/envFilter/);
    expect(src).toMatch(/\.eq\("environment", envFilter\)/);
    // The selected columns include environment for badge rendering.
    expect(src).toMatch(/error_message, environment/);
    // No webhook event-type catalogue added here.
    expect(src).not.toMatch(/webhook\.[a-z_.]+/);
  });

  it("AdminApiMonitoringPanel keeps environment filter incl. sandbox/production", () => {
    const src = read("src/components/admin/AdminApiMonitoringPanel.tsx");
    expect(src).toMatch(/value="sandbox"/);
    expect(src).toMatch(/value="production"/);
    expect(src).toMatch(/p_environment/);
    // CSV export remains platform_admin only.
    expect(src).toMatch(/isPlatformAdmin/);
  });

  it("ClientUsageDashboard keeps sandbox/production split surfaced", () => {
    const src = read("src/components/developer/ClientUsageDashboard.tsx");
    expect(src).toMatch(/Sandbox calls/);
    expect(src).toMatch(/Production calls/);
    expect(src).toMatch(/sandbox_calls/);
    expect(src).toMatch(/production_calls/);
    expect(src).toMatch(/not an invoice/);
  });

  it("No Batch 8 UI file introduces OpenAPI docs, write API routes, OAuth/SSO, signup or payment collection", () => {
    const files = [
      "src/components/admin/SandboxScenarioViewer.tsx",
      "src/components/admin/AdminApiSecuritySignalsPanel.tsx",
      "src/components/developer/WebhookLogs.tsx",
      "src/components/developer/ClientUsageDashboard.tsx",
    ];
    const forbidden = [
      "openapi",
      "swagger",
      "oauth",
      "saml",
      "/v1/docs",
      "signup",
      "self-serve",
      "stripe.checkout",
      "paystack.charge",
    ];
    for (const f of files) {
      const blob = read(f).toLowerCase();
      for (const t of forbidden) {
        expect(blob, `${f} must not contain "${t}"`).not.toContain(t);
      }
    }
  });
});
