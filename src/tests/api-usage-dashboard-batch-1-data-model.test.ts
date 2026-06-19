/**
 * API Usage Dashboard V1 — Batch 1 (Data Model & Aggregation) contract guards.
 *
 * Small hardening batch. Pins the data-model surface for the dashboard so
 * later batches cannot silently regress payload safety, tenant isolation,
 * RPC signatures, or permission-helper shapes.
 *
 * Scope guards:
 *   • Required scalar log columns exist OR are documented as mapped to an
 *     existing column (correlation_id → request_id).
 *   • request_body / response_body payload columns are hard-nulled by a
 *     BEFORE INSERT/UPDATE trigger (defence-in-depth).
 *   • No code writes request_body / response_body into api_request_logs
 *     (build guard wired into prebuild).
 *   • Dashboard RPCs do not surface request_body / response_body.
 *   • Dashboard RPC argument shapes remain stable.
 *   • Permission helper signatures remain stable.
 *   • api_request_logs RLS / tenant scoping remains intact and the
 *     client-usage RPCs route via can_view_api_client_usage so one
 *     client cannot read another client's logs.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

function allMigrations(): string {
  const dir = path.join(ROOT, "supabase/migrations");
  let combined = "";
  for (const f of fs.readdirSync(dir)) {
    combined += "\n" + fs.readFileSync(path.join(dir, f), "utf-8");
  }
  return combined;
}

const MIG = allMigrations();

describe("API Usage Dashboard V1 · Batch 1 · data model & aggregation", () => {
  // ─── 1. Scalar log columns: present OR documented mapping ──────────────
  it("adds non_billable_reason / quota_position_after / token_cost_units as nullable scalar columns on api_request_logs", () => {
    expect(MIG).toMatch(/ADD COLUMN IF NOT EXISTS\s+non_billable_reason\s+text/i);
    expect(MIG).toMatch(/ADD COLUMN IF NOT EXISTS\s+quota_position_after\s+integer/i);
    expect(MIG).toMatch(/ADD COLUMN IF NOT EXISTS\s+token_cost_units\s+integer/i);
  });

  it("does NOT duplicate correlation_id — it maps to the existing request_id column", () => {
    // No ADD COLUMN for correlation_id anywhere.
    expect(MIG).not.toMatch(/ADD COLUMN[^;]*\bcorrelation_id\b/i);
    // Mapping is documented on the request_id column comment.
    expect(MIG).toMatch(
      /COMMENT ON COLUMN public\.api_request_logs\.request_id[\s\S]*correlation_id maps to this column/i,
    );
  });

  // ─── 2. Payload safety: trigger + build guard ──────────────────────────
  it("installs a BEFORE INSERT OR UPDATE trigger that hard-nulls request_body and response_body", () => {
    expect(MIG).toMatch(/CREATE OR REPLACE FUNCTION public\.api_request_logs_strip_payloads/);
    expect(MIG).toMatch(/NEW\.request_body\s*:=\s*NULL/);
    expect(MIG).toMatch(/NEW\.response_body\s*:=\s*NULL/);
    expect(MIG).toMatch(
      /CREATE TRIGGER\s+trg_api_request_logs_strip_payloads[\s\S]*BEFORE INSERT OR UPDATE ON public\.api_request_logs/i,
    );
  });

  it("ships the check-api-request-logs-no-payloads build guard and wires it into prebuild", () => {
    expect(exists("scripts/check-api-request-logs-no-payloads.mjs")).toBe(true);
    const pkg = read("package.json");
    expect(pkg).toMatch(/check-api-request-logs-no-payloads\.mjs/);
  });

  it("no source file writes request_body or response_body into api_request_logs", () => {
    // Mirror of the build guard, executed inline so the contract is also
    // pinned by the vitest run, not only by the prebuild chain.
    const ROOTS = ["supabase/functions", "src"];
    const forbidden = ["request_body", "response_body"];
    const offences: string[] = [];

    function walk(dir: string): string[] {
      const out: string[] = [];
      if (!fs.existsSync(dir)) return out;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(p));
        else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
      }
      return out;
    }

    for (const r of ROOTS) {
      for (const file of walk(path.join(ROOT, r))) {
        const src = fs.readFileSync(file, "utf-8");
        if (!/api_request_logs/.test(src)) continue;
        const lines = src.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (!/from\(\s*["']api_request_logs["']\s*\)/.test(lines[i])) continue;
          const slice = lines.slice(i, i + 60).join("\n");
          if (!/\.(insert|update|upsert)\s*\(/.test(slice)) continue;
          for (const f of forbidden) {
            const re = new RegExp(`(^|[\\s,{])${f}\\s*:`, "m");
            if (re.test(slice)) offences.push(`${file}:${i + 1} ${f}`);
          }
        }
      }
    }
    expect(offences).toEqual([]);
  });

  // ─── 3. Dashboard RPCs do not expose payloads ──────────────────────────
  it("get_api_client_usage_csv_rows return shape does NOT expose request_body or response_body", () => {
    const csvRpc = MIG.match(
      /CREATE OR REPLACE FUNCTION public\.get_api_client_usage_csv_rows[\s\S]*?\$\$;/,
    );
    expect(csvRpc).not.toBeNull();
    expect(csvRpc![0]).not.toMatch(/\brequest_body\b/);
    expect(csvRpc![0]).not.toMatch(/\bresponse_body\b/);
  });

  it("get_api_client_usage_summary does NOT expose request_body or response_body", () => {
    const sumRpc = MIG.match(
      /CREATE OR REPLACE FUNCTION public\.get_api_client_usage_summary[\s\S]*?\$\$;/,
    );
    expect(sumRpc).not.toBeNull();
    expect(sumRpc![0]).not.toMatch(/\brequest_body\b/);
    expect(sumRpc![0]).not.toMatch(/\bresponse_body\b/);
  });

  it("get_api_monitoring_overview does NOT expose request_body or response_body", () => {
    const monRpc = MIG.match(
      /CREATE OR REPLACE FUNCTION public\.get_api_monitoring_overview[\s\S]*?\$\$;/,
    );
    expect(monRpc).not.toBeNull();
    expect(monRpc![0]).not.toMatch(/\brequest_body\b/);
    expect(monRpc![0]).not.toMatch(/\bresponse_body\b/);
  });

  // ─── 4. RPC argument shapes remain stable ──────────────────────────────
  it("get_api_client_usage_csv_rows signature is pinned", () => {
    expect(MIG).toMatch(
      /FUNCTION public\.get_api_client_usage_csv_rows\(\s*p_api_client_id uuid,\s*p_period_start timestamptz,\s*p_period_end timestamptz,\s*p_environment text DEFAULT NULL,\s*p_endpoint text DEFAULT NULL,\s*p_status text DEFAULT NULL[\s\S]*p_billable text DEFAULT NULL/,
    );
  });

  it("get_api_client_usage_summary signature is pinned", () => {
    expect(MIG).toMatch(
      /FUNCTION public\.get_api_client_usage_summary\(\s*p_api_client_id uuid/,
    );
  });

  // ─── 5. Permission helper signatures stable ────────────────────────────
  it("can_view_api_client_usage helper signature is pinned (user_id, api_client_id) → bool", () => {
    expect(MIG).toMatch(
      /FUNCTION public\.can_view_api_client_usage\(\s*[_\w]+\s+uuid\s*,\s*[_\w]+\s+uuid\s*\)\s*RETURNS\s+boolean/i,
    );
  });

  it("can_access_api_monitoring helper signature is pinned (user_id) → bool", () => {
    expect(MIG).toMatch(
      /FUNCTION public\.can_access_api_monitoring\(\s*[_\w]+\s+uuid\s*\)\s*RETURNS\s+boolean/i,
    );
  });

  // ─── 6. Tenant isolation on api_request_logs remains intact ────────────
  it("api_request_logs has RLS enabled with org-scoped policies", () => {
    expect(MIG).toMatch(/ALTER TABLE\s+(public\.)?api_request_logs\s+ENABLE ROW LEVEL SECURITY/i);
    // At least one policy references org_id scoping.
    expect(MIG).toMatch(/ON\s+(public\.)?api_request_logs[\s\S]{0,400}org_id/i);
  });

  it("client-usage RPCs route through can_view_api_client_usage before returning rows", () => {
    const csvRpc = MIG.match(
      /CREATE OR REPLACE FUNCTION public\.get_api_client_usage_csv_rows[\s\S]*?\$\$;/,
    )![0];
    const sumRpc = MIG.match(
      /CREATE OR REPLACE FUNCTION public\.get_api_client_usage_summary[\s\S]*?\$\$;/,
    )![0];
    expect(csvRpc).toMatch(/can_view_api_client_usage\s*\(/);
    expect(sumRpc).toMatch(/can_view_api_client_usage\s*\(/);
    // And both raise on failure rather than silently returning.
    expect(csvRpc).toMatch(/RAISE EXCEPTION 'forbidden'/);
    expect(sumRpc).toMatch(/RAISE EXCEPTION 'forbidden'/);
  });

  // ─── 7. Scope control: no new tables / no UI in Batch 1 ────────────────
  it("Batch 1 migration does not create new tables", () => {
    // Pin to the Batch 1 migration by its unique signature.
    const dir = path.join(ROOT, "supabase/migrations");
    const files = fs.readdirSync(dir).filter((f) => /\.sql$/.test(f));
    const batch1 = files
      .map((f) => ({ f, body: fs.readFileSync(path.join(dir, f), "utf-8") }))
      .find((x) => x.body.includes("trg_api_request_logs_strip_payloads"));
    expect(batch1, "Batch 1 migration not found by signature").toBeTruthy();
    expect(batch1!.body).not.toMatch(/CREATE TABLE/i);
  });
});
