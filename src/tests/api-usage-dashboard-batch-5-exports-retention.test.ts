/**
 * API Usage Dashboard V1 — Batch 5 (Exports, Audit Logging, Retention)
 *
 * Non-rebuild hardening pass. This file VERIFIES the existing CSV export
 * surface and its audit / tenant-scoping guarantees rather than rebuilding
 * them. It also pins the retention-alignment doc into the repo.
 *
 *   • Client CSV export is tenant-scoped server-side
 *     (can_view_api_client_usage), not by UI alone.
 *   • Client CSV export shape excludes every forbidden field (payloads,
 *     key material, secrets, bearer tokens, webhook secrets, stack traces,
 *     internal notes).
 *   • Both panels run a FORBIDDEN_CSV_TOKENS defensive scan before
 *     download.
 *   • Both panels write a domain-specific audit row via the existing
 *     log_api_*_csv_export RPCs.
 *   • Admin export additionally routes file delivery through
 *     auditedDownloadCSVRaw (generic audit_logs row) and requires a
 *     non-empty reason (>= 10 chars).
 *   • Retention alignment is documented (docs/RETENTION-API-USAGE-DASHBOARD.md)
 *     and Batch 5 does not introduce destructive cleanup.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

const CLIENT_PANEL = "src/components/developer/ClientUsageDashboard.tsx";
const ADMIN_PANEL = "src/components/admin/AdminApiMonitoringPanel.tsx";
const RETENTION_DOC = "docs/RETENTION-API-USAGE-DASHBOARD.md";

function allMigrations(): string {
  const dir = path.join(ROOT, "supabase/migrations");
  let combined = "";
  for (const f of fs.readdirSync(dir)) {
    combined += "\n" + fs.readFileSync(path.join(dir, f), "utf-8");
  }
  return combined;
}
const MIG = allMigrations();

const FORBIDDEN = [
  "request_body",
  "response_body",
  "api_key",
  "key_hash",
  "secret",
  "bearer",
  "stack_trace",
  "internal_note",
];

describe("Batch 5 · CSV exports, audit logging, retention alignment", () => {
  // ── Server-side tenant scoping ─────────────────────────────
  it("get_api_client_usage_csv_rows is gated by can_view_api_client_usage", () => {
    const fn = MIG.match(
      /CREATE OR REPLACE FUNCTION public\.get_api_client_usage_csv_rows[\s\S]*?\$\$;/,
    );
    expect(fn, "RPC missing").not.toBeNull();
    expect(fn![0]).toMatch(/can_view_api_client_usage\(\s*v_uid\s*,\s*p_api_client_id\s*\)/);
    expect(fn![0]).toMatch(/SECURITY DEFINER/);
    expect(fn![0]).toMatch(/SET search_path\s*=\s*public/);
  });

  it("log_api_client_usage_csv_export is gated by can_view_api_client_usage", () => {
    const fn = MIG.match(
      /CREATE OR REPLACE FUNCTION public\.log_api_client_usage_csv_export[\s\S]*?\$\$;/,
    );
    expect(fn, "audit RPC missing").not.toBeNull();
    expect(fn![0]).toMatch(/can_view_api_client_usage\(\s*v_uid\s*,\s*p_api_client_id\s*\)/);
    expect(fn![0]).toMatch(/SECURITY DEFINER/);
    // Audit row uses the canonical action name and does not store payloads.
    expect(fn![0]).toMatch(/public_api\.v1\.usage\.csv_exported/);
    expect(fn![0]).not.toMatch(/request_body|response_body|api_key|key_hash|secret/i);
  });

  it("can_view_api_client_usage scopes org admins to their own org_id", () => {
    const fn = MIG.match(
      /CREATE OR REPLACE FUNCTION public\.can_view_api_client_usage[\s\S]*?\$\$;/,
    )![0];
    expect(fn).toMatch(/is_org_admin\(_user_id,\s*c\.org_id\)/);
  });

  // ── CSV shape: no forbidden fields ─────────────────────────
  it("get_api_client_usage_csv_rows RETURNS shape excludes all forbidden fields", () => {
    const fn = MIG.match(
      /CREATE OR REPLACE FUNCTION public\.get_api_client_usage_csv_rows[\s\S]*?\$\$;/,
    )![0];
    const returnsBlock = fn.match(/RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/i);
    expect(returnsBlock, "RETURNS block not found").not.toBeNull();
    const cols = returnsBlock![1].toLowerCase();
    for (const t of FORBIDDEN) {
      expect(cols, `forbidden token "${t}" found in CSV row shape`).not.toMatch(
        new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
  });

  it("client panel guards the export with FORBIDDEN_CSV_TOKENS scan", () => {
    const src = read(CLIENT_PANEL);
    expect(src).toMatch(/FORBIDDEN_CSV_TOKENS\b/);
    expect(src).toMatch(/Export blocked/i);
    // The list itself must include the most dangerous tokens.
    for (const t of ["api_key", "key_hash", "secret", "internal_note"]) {
      expect(src).toMatch(new RegExp(`"${t}"`));
    }
  });

  it("admin panel guards the export with FORBIDDEN_CSV_TOKENS scan", () => {
    const src = read(ADMIN_PANEL);
    expect(src).toMatch(/FORBIDDEN_CSV_TOKENS\b/);
    for (const t of ["request_body", "response_body", "api_key", "key_hash", "secret"]) {
      expect(src).toMatch(new RegExp(`"${t}"`));
    }
  });

  // ── Audit wiring ───────────────────────────────────────────
  it("client panel writes the domain audit row via log_api_client_usage_csv_export", () => {
    const src = read(CLIENT_PANEL);
    expect(src).toMatch(/log_api_client_usage_csv_export/);
    // Audit call must include p_api_client_id, period and row count only.
    expect(src).toMatch(/p_api_client_id/);
    expect(src).toMatch(/p_row_count/);
  });

  it("admin panel writes the domain audit row + audited file download", () => {
    const src = read(ADMIN_PANEL);
    expect(src).toMatch(/log_api_monitoring_csv_export/);
    expect(src).toMatch(/auditedDownloadCSVRaw/);
    // Reason gate >= 10 chars.
    expect(src).toMatch(/at least 10 characters/i);
  });

  it("admin export is platform_admin-only", () => {
    const src = read(ADMIN_PANEL);
    expect(src).toMatch(/isPlatformAdmin/);
    expect(src).toMatch(/Only platform_admin can export/i);
  });

  // ── Retention alignment doc ────────────────────────────────
  it("retention alignment doc is present and lists the required categories", () => {
    expect(exists(RETENTION_DOC)).toBe(true);
    const doc = read(RETENTION_DOC);
    expect(doc).toMatch(/12 months/);
    expect(doc).toMatch(/7 years/);
    expect(doc).toMatch(/24 months/i);
    expect(doc).toMatch(/api_request_logs/);
    expect(doc).toMatch(/api_usage_alerts/);
    expect(doc).toMatch(/DATA-004/);
    expect(doc).toMatch(/no destructive cleanup/i);
  });

  // ── Defensive: no batch-5 migration introduces destructive cleanup ──
  it("Batch 5 does not introduce DROP/TRUNCATE/DELETE FROM public.api_request_logs", () => {
    const dangerous = [
      /TRUNCATE\s+(TABLE\s+)?public\.api_request_logs/i,
      /DELETE\s+FROM\s+public\.api_request_logs/i,
      /DROP\s+TABLE\s+public\.api_request_logs/i,
    ];
    for (const re of dangerous) {
      expect(MIG, `destructive statement matched: ${re}`).not.toMatch(re);
    }
  });
});
