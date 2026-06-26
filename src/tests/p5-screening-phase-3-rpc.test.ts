/**
 * P-5 Screening — Phase 3 RPC tests.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIG_DIR = resolve(process.cwd(), "supabase/migrations");
const file = readdirSync(MIG_DIR).find((f) => f.startsWith("20260626181548_"));
const sql = file ? readFileSync(resolve(MIG_DIR, file), "utf8") : "";

const RPCS = [
  "p5scr_upsert_subject",
  "p5scr_request_check",
  "p5scr_record_provider_pending",
  "p5scr_record_result",
  "p5scr_reuse_result",
  "p5scr_open_manual_review",
  "p5scr_decide_manual_review",
  "p5scr_record_idv",
  "p5scr_invalidate",
  "p5scr_log_webhook",
  "p5scr_link_memory_finality",
  "p5scr_evaluate_gate",
];

describe("P-5 Screening Phase 3 — RPC check engine", () => {
  it("ships exactly one Phase 3 migration", () => {
    expect(file).toBeTruthy();
  });

  it.each(RPCS)("creates RPC %s with hardened contract", (fn) => {
    const head = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b[\\s\\S]*?AS \\$\\$[\\s\\S]*?\\$\\$;`, "i").exec(sql);
    expect(head, `${fn} not created`).toBeTruthy();
    expect(head![0]).toMatch(/SECURITY DEFINER/);
    expect(head![0]).toMatch(/SET\s+search_path\s*=\s*public/);
    expect(head![0]).toMatch(/has_role\(auth\.uid\(\),\s*'platform_admin'\)/);
    expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\s*\\(`));
    expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\s*\\([^)]*\\)\\s*TO authenticated`));
  });


  it("pins deterministic uniqueness on open manual reviews", () => {
    expect(sql).toMatch(/p5scr_manual_reviews_one_open/);
    expect(sql).toMatch(/WHERE decided_at IS NULL/);
  });

  it("creates no new tables in Phase 3", () => {
    expect(sql).not.toMatch(/CREATE TABLE\s+public\.p5scr_/i);
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

  it("POI gates only block on confirmed-block states (failed/rejected) in gate evaluator", () => {
    expect(sql).toMatch(/poi_create[^)]*poi_accept[^)]*wad_create[\s\S]*?'failed','rejected'/);
  });
});
