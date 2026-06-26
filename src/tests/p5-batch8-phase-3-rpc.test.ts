import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIG_DIR = resolve(process.cwd(), "supabase/migrations");
const file = readdirSync(MIG_DIR).find((f) => f.startsWith("20260626170432_"));
const sql = file ? readFileSync(resolve(MIG_DIR, file), "utf8") : "";

const RPCS = [
  "p5b8_rpc_upsert_provider_config",
  "p5b8_rpc_record_activation_signoff",
  "p5b8_rpc_set_dependency_status",
  "p5b8_rpc_create_provider_request",
  "p5b8_rpc_record_provider_result",
  "p5b8_rpc_record_provider_decision",
  "p5b8_rpc_record_webhook_event",
  "p5b8_rpc_append_audit_event",
  "p5b8_rpc_record_retry_state",
  "p5b8_rpc_create_memory_finality_link",
];

describe("P-5 Batch 8 Phase 3 — RPC write path", () => {
  it("ships exactly one Phase 3 migration", () => {
    expect(file).toBeTruthy();
  });

  it("declares the shared writer-role assertion helper", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.p5b8_assert_writer_role\b/);
    expect(sql).toMatch(/has_role\(auth\.uid\(\),\s*'platform_admin'::app_role\)/);
    expect(sql).toMatch(/has_role\(auth\.uid\(\),\s*'compliance_analyst'::app_role\)/);
  });

  it.each(RPCS)("declares %s as SECURITY DEFINER with hardening", (fn) => {
    expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`));
    expect(sql).toMatch(new RegExp(`REVOKE (ALL|EXECUTE)[^;]*ON FUNCTION public\\.${fn}\\s*\\([^)]*\\)[^;]*FROM PUBLIC`, "i"));
    expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\s*\\([^)]*\\) TO authenticated`, "i"));
  });

  it("each rpc body calls the writer-role assertion", () => {
    const blocks = sql.split(/CREATE OR REPLACE FUNCTION public\./).slice(1);
    for (const fn of RPCS) {
      const block = blocks.find((b) => b.startsWith(fn));
      expect(block, `missing function block ${fn}`).toBeTruthy();
      expect(block!).toMatch(/PERFORM\s+public\.p5b8_assert_writer_role\(\)/i);
    }
  });

  it("upsert_provider_config never sets live_now = true", () => {
    const block = sql.split(/CREATE OR REPLACE FUNCTION public\./)
      .find((b) => b.startsWith("p5b8_rpc_upsert_provider_config"))!;
    expect(block).toMatch(/live_now,?\s*(\)|,)/); // declares column
    expect(block).not.toMatch(/live_now\s*=\s*true/i);
  });

  it("activation sign-off requires evidence_reference and gates go-live", () => {
    const block = sql.split(/CREATE OR REPLACE FUNCTION public\./)
      .find((b) => b.startsWith("p5b8_rpc_record_activation_signoff"))!;
    expect(block).toMatch(/activation sign-off requires evidence_reference/);
    expect(block).toMatch(/IF _go_live THEN[\s\S]*live_now = true/);
  });

  it("create_provider_request blocks live before activation sign-off", () => {
    const block = sql.split(/CREATE OR REPLACE FUNCTION public\./)
      .find((b) => b.startsWith("p5b8_rpc_create_provider_request"))!;
    expect(block).toMatch(/live request blocked — provider not live-activated/);
    expect(block).toMatch(/p5b8\.live_check\.blocked_attempt/);
  });

  it("record_provider_decision enforces reason/evidence based on decision_state", () => {
    const block = sql.split(/CREATE OR REPLACE FUNCTION public\./)
      .find((b) => b.startsWith("p5b8_rpc_record_provider_decision"))!;
    expect(block).toMatch(/requires a reason/);
    expect(block).toMatch(/requires evidence_reference/);
  });

  it("memory_finality_link gates Memory references to memory-eligible decisions", () => {
    const block = sql.split(/CREATE OR REPLACE FUNCTION public\./)
      .find((b) => b.startsWith("p5b8_rpc_create_memory_finality_link"))!;
    expect(block).toMatch(/'clear','confirmed_match','false_positive','waived','blocked'/);
    expect(block).toMatch(/p5b8\.memory\.provider_write_blocked/);
    expect(block).not.toMatch(/INSERT[^;]*memory_records/i);
    expect(block).not.toMatch(/INSERT[^;]*finality_records/i);
  });

  it("never mutates Batch 5 memory_records or finality_records", () => {
    expect(sql).not.toMatch(/INSERT[^;]*p5_batch5_memory_records/i);
    expect(sql).not.toMatch(/UPDATE\s+p5_batch5_memory_records/i);
    expect(sql).not.toMatch(/INSERT[^;]*p5_batch4_finality_records/i);
    expect(sql).not.toMatch(/UPDATE\s+p5_batch4_finality_records/i);
  });

  it("adds no client-side write policies, no cron, no Batch 6/7 leakage", () => {
    const codeOnly = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(codeOnly).not.toMatch(/CREATE\s+POLICY[\s\S]*?FOR\s+(INSERT|UPDATE|DELETE|ALL)/i);
    expect(codeOnly).not.toMatch(/cron\.schedule\s*\(/i);
    expect(codeOnly).not.toContain("p5b6_");
    expect(codeOnly).not.toContain("p5b7_");
  });
});
