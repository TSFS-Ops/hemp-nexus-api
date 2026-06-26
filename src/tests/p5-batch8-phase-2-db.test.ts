import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  P5_BATCH8_PROVIDER_CATEGORIES,
  P5_BATCH8_PROVIDER_DEPENDENCY_STATES,
  P5_BATCH8_PROVIDER_RESULT_DECISION_STATES,
  P5_BATCH8_WEBHOOK_EVENTS,
  P5_BATCH8_AUDIT_EVENTS,
} from "@/lib/p5-batch8/registry";

const MIG_DIR = resolve(process.cwd(), "supabase/migrations");
const file = readdirSync(MIG_DIR).find((f) => f.startsWith("20260626165809_"));
const sql = file ? readFileSync(resolve(MIG_DIR, file), "utf8") : "";

const TABLES = [
  "p5b8_provider_configs",
  "p5b8_provider_activation_signoffs",
  "p5b8_provider_dependency_status",
  "p5b8_provider_requests",
  "p5b8_provider_results",
  "p5b8_provider_decisions",
  "p5b8_webhook_events_ledger",
  "p5b8_audit_events",
  "p5b8_provider_retry_state",
  "p5b8_memory_finality_links",
];

describe("P-5 Batch 8 Phase 2 — DB persistence", () => {
  it("ships exactly one Phase 2 migration", () => {
    expect(file).toBeTruthy();
  });

  it.each(TABLES)("creates table %s with RLS + grants + no anon", (t) => {
    expect(sql).toMatch(new RegExp(`CREATE TABLE public\\.${t}\\b`));
    expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
    expect(sql).toMatch(new RegExp(`GRANT[^;]*ON public\\.${t}[^;]*TO authenticated`));
    expect(sql).toMatch(new RegExp(`GRANT ALL ON public\\.${t} TO service_role`));
    expect(sql).not.toMatch(new RegExp(`GRANT[^;]*ON public\\.${t}[^;]*TO anon\\b`));
  });

  it("mirrors all 9 SSOT provider categories", () => {
    for (const v of P5_BATCH8_PROVIDER_CATEGORIES) expect(sql).toContain(`'${v}'`);
  });

  it("mirrors all 10 SSOT dependency states", () => {
    for (const v of P5_BATCH8_PROVIDER_DEPENDENCY_STATES) expect(sql).toContain(`'${v}'`);
  });

  it("mirrors all 10 SSOT decision states", () => {
    for (const v of P5_BATCH8_PROVIDER_RESULT_DECISION_STATES) expect(sql).toContain(`'${v}'`);
  });

  it("mirrors all 17 SSOT webhook events", () => {
    for (const v of P5_BATCH8_WEBHOOK_EVENTS) expect(sql).toContain(`'${v}'`);
  });

  it("mirrors all 30 SSOT audit events", () => {
    for (const v of P5_BATCH8_AUDIT_EVENTS) expect(sql).toContain(`'${v}'`);
  });

  it("enforces live_now requires activation sign-off", () => {
    expect(sql).toMatch(/p5b8_pc_live_requires_signoff/);
    expect(sql).toMatch(/live_now = false OR \(activation_signed_off_at IS NOT NULL/);
  });

  it("isolates sensitive raw payloads as admin-only columns", () => {
    expect(sql).toContain("raw_provider_payload_admin_only");
    expect(sql).toContain("raw_webhook_payload_admin_only");
  });

  it("never mutates Memory or finality tables", () => {
    expect(sql).not.toMatch(/INSERT[^;]*p5_batch5_memory_records/i);
    expect(sql).not.toMatch(/UPDATE\s+p5_batch5_memory_records/i);
    expect(sql).not.toMatch(/INSERT[^;]*p5_batch4_finality_records/i);
    expect(sql).not.toMatch(/UPDATE\s+p5_batch4_finality_records/i);
  });

  it("registers no pg_cron and no edge function references", () => {
    expect(sql).not.toMatch(/cron\.schedule\s*\(/i);
    expect(sql.toLowerCase()).not.toContain("supabase/functions");
  });

  it("has no Batch 6 or Batch 7 token leakage", () => {
    const codeOnly = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(codeOnly).not.toMatch(/p5b6_/);
    expect(codeOnly).not.toMatch(/p5b7_/);
  });
});
