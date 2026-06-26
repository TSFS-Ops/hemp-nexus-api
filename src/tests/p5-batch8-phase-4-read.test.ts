import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * P-5 Batch 8 — Phase 4 read/projection contract tests.
 * These are static tests over the migration source. They lock the
 * API-safe projection contract defined by Phase 1 SSOT.
 */

const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const PHASE4_PREFIX = "20260626171017_";
const file = readdirSync(MIG_DIR).find((f) => f.startsWith(PHASE4_PREFIX))!;
const SQL = readFileSync(resolve(MIG_DIR, file), "utf8");
const SQL_LOWER = SQL.toLowerCase();

const READ_FNS = [
  "p5b8_read_provider_config_summary",
  "p5b8_read_provider_dependency_status_summary",
  "p5b8_read_provider_request_summary",
  "p5b8_read_provider_result_summary",
  "p5b8_read_provider_decision_summary",
  "p5b8_read_webhook_ledger_summary",
  "p5b8_read_audit_timeline_summary",
  "p5b8_read_retry_state_summary",
  "p5b8_read_memory_finality_link_summary",
  "p5b8_read_dashboard_queue_summary",
];

describe("P-5 Batch 8 Phase 4 — API-safe read projections", () => {
  it("declares both reader-role helpers", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.p5b8_has_reader_role\b/);
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.p5b8_has_admin_reader_role\b/);
  });

  for (const fn of READ_FNS) {
    it(`declares ${fn}`, () => {
      expect(SQL).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`));
    });
  }

  it("every p5b8_ function is SECURITY DEFINER with pinned search_path", () => {
    const blocks = SQL.split(/CREATE OR REPLACE FUNCTION public\./).slice(1);
    let checked = 0;
    for (const block of blocks) {
      const nm = block.match(/^(p5b8_\w+)/);
      if (!nm) continue;
      const head = block.slice(0, block.toLowerCase().search(/\bas\s+\$\$/));
      expect(head, `${nm[1]} SECURITY DEFINER`).toMatch(/SECURITY DEFINER/i);
      expect(head, `${nm[1]} search_path`).toMatch(/SET\s+search_path\s*=\s*public/i);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(READ_FNS.length + 2);
  });

  it("every p5b8_ function REVOKEs PUBLIC and GRANTs authenticated", () => {
    for (const fn of [...READ_FNS, "p5b8_has_reader_role", "p5b8_has_admin_reader_role"]) {
      expect(SQL, `${fn} REVOKE`).toMatch(
        new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\s*\\([^)]*\\)[^;]*FROM PUBLIC`, "i"),
      );
      expect(SQL, `${fn} GRANT`).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\s*\\([^)]*\\) TO authenticated`, "i"),
      );
    }
  });

  it("every read projection gates on a reader-role helper", () => {
    const blocks = SQL.split(/CREATE OR REPLACE FUNCTION public\./).slice(1);
    for (const block of blocks) {
      const nm = block.match(/^(p5b8_read_\w+)/);
      if (!nm) continue;
      expect(block, `${nm[1]} body gating`).toMatch(/p5b8_has_(admin_)?reader_role\s*\(\s*\)/i);
    }
  });

  it("never selects forbidden external columns", () => {
    const FORBIDDEN = [
      "raw_provider_payload_admin_only",
      "raw_webhook_payload_admin_only",
      "provider_api_key",
      "provider_api_secret",
      "webhook_signature_secret",
      "internal_risk_note",
      "internal_reviewer_note",
    ];
    for (const col of FORBIDDEN) {
      expect(SQL, `forbidden column ${col}`).not.toContain(col);
    }
  });

  it("never synthesises banned wording", () => {
    const BANNED = [
      "guaranteed clean",
      "regulator approved",
      "bank verified",
      "sanctions cleared",
      "kyc passed",
      "kyc complete",
      "provider certified",
      "provider verified",
      "verified by provider",
      "verified by bank",
    ];
    for (const w of BANNED) {
      expect(SQL_LOWER, `banned wording "${w}"`).not.toContain(w);
    }
  });

  it("contains no DDL mutating Batch 5 memory or Batch 4 finality", () => {
    for (const bad of ["p5_batch5_memory_records", "p5_batch4_finality_records"]) {
      expect(SQL).not.toMatch(new RegExp(`(INSERT|UPDATE|DELETE)[^;]*${bad}`, "i"));
    }
  });

  it("creates no new tables, no RLS policies, no cron schedules", () => {
    expect(SQL).not.toMatch(/CREATE\s+TABLE\s+/i);
    expect(SQL).not.toMatch(/CREATE\s+POLICY/i);
    expect(SQL).not.toMatch(/cron\.schedule\s*\(/i);
  });

  it("does not reference Batch 6 or Batch 7 surfaces", () => {
    for (const tok of ["p5b6_", "p5b7_"]) {
      expect(SQL).not.toContain(tok);
    }
  });

  it("preserves provider-ready vs provider-verified distinction (state names returned verbatim)", () => {
    // The dependency status projection must alias to provider_dependency_status,
    // and the decision projection must alias to provider_decision_state — no synthesised "verified" flag.
    expect(SQL).toMatch(/s\.state\s+AS\s+provider_dependency_status/i);
    expect(SQL).toMatch(/d\.decision_state\s+AS\s+provider_decision_state/i);
  });
});
