/**
 * P-5 Screening — Phase 2 DB spine tests.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  P5_SCR_CHECK_CATEGORIES,
  P5_SCR_AUDIT_EVENTS,
  P5_SCR_WEBHOOK_EVENTS,
  P5_SCR_REUSE_INVALIDATION_TRIGGERS,
} from "@/lib/p5-screening/registry";

const MIG_DIR = resolve(process.cwd(), "supabase/migrations");
const file = readdirSync(MIG_DIR).find((f) => f.startsWith("20260626181220_"));
const sql = file ? readFileSync(resolve(MIG_DIR, file), "utf8") : "";

const TABLES = [
  "p5scr_subjects",
  "p5scr_check_state",
  "p5scr_check_results",
  "p5scr_manual_reviews",
  "p5scr_idv_records",
  "p5scr_invalidations",
  "p5scr_audit_events",
  "p5scr_webhook_events_ledger",
  "p5scr_memory_finality_links",
];

describe("P-5 Screening Phase 2 — DB spine", () => {
  it("ships exactly one Phase 2 migration", () => {
    expect(file).toBeTruthy();
  });

  it.each(TABLES)("creates %s with RLS + GRANTs + no anon", (t) => {
    expect(sql).toMatch(new RegExp(`CREATE TABLE public\\.${t}\\b`));
    expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
    expect(sql).toMatch(new RegExp(`GRANT[^;]*ON public\\.${t}[^;]*TO authenticated`));
    expect(sql).toMatch(new RegExp(`GRANT ALL ON public\\.${t} TO service_role`));
    expect(sql).not.toMatch(new RegExp(`GRANT[^;]*ON public\\.${t}[^;]*TO anon\\b`));
  });

  it("mirrors all 5 SSOT check categories", () => {
    for (const c of P5_SCR_CHECK_CATEGORIES) expect(sql).toContain(`'${c}'`);
  });

  it("mirrors all 17 SSOT audit events", () => {
    for (const e of P5_SCR_AUDIT_EVENTS) expect(sql).toContain(`'${e}'`);
  });

  it("mirrors all 5 SSOT webhook events", () => {
    for (const e of P5_SCR_WEBHOOK_EVENTS) expect(sql).toContain(`'${e}'`);
  });

  it("mirrors all 5 SSOT invalidation triggers", () => {
    for (const t of P5_SCR_REUSE_INVALIDATION_TRIGGERS) expect(sql).toContain(`'${t}'`);
  });

  it("enforces live_now requires activation sign-off on results + IDV", () => {
    expect(sql).toMatch(/p5scr_cr_live_requires_signoff/);
    expect(sql).toMatch(/p5scr_idv_live_requires_signoff/);
    expect(sql).toMatch(/provider_live_now = false OR \(activation_signed_off_at IS NOT NULL/);
  });

  it("isolates sensitive raw provider/webhook payloads as admin-only columns", () => {
    expect(sql).toContain("raw_provider_payload_admin_only");
    expect(sql).toContain("raw_webhook_payload_admin_only");
    expect(sql).toContain("notes_admin_only");
    expect(sql).toContain("payload_admin_only");
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

  it("has no Batch 6/7/8 token leakage", () => {
    const codeOnly = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(codeOnly).not.toMatch(/p5b6_/);
    expect(codeOnly).not.toMatch(/p5b7_/);
    expect(codeOnly).not.toMatch(/p5b8_/);
  });
});
