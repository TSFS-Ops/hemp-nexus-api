/**
 * P-5 Screening — Phase 4 API-safe projection tests.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  P5_SCR_ALLOWED_EXTERNAL_WORDING,
  P5_SCR_BANNED_EXTERNAL_WORDING,
  P5_SCR_API_FORBIDDEN_FIELDS,
  P5_SCR_API_SAFE_FIELDS,
} from "@/lib/p5-screening/registry";

const MIG_DIR = resolve(process.cwd(), "supabase/migrations");
const file = readdirSync(MIG_DIR).find((f) => f.startsWith("20260626181931_"));
const sql = file ? readFileSync(resolve(MIG_DIR, file), "utf8") : "";
const codeOnly = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

const RPCS = ["p5scr_api_subject_status", "p5scr_api_gate_readiness"];

describe("P-5 Screening Phase 4 — API-safe projections", () => {
  it("ships exactly one Phase 4 migration", () => {
    expect(file).toBeTruthy();
  });

  it.each(RPCS)("creates read RPC %s with hardened contract", (fn) => {
    const m = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b[\\s\\S]*?AS \\$\\$[\\s\\S]*?\\$\\$;`, "i").exec(sql);
    expect(m, `${fn} not created`).toBeTruthy();
    expect(m![0]).toMatch(/SECURITY DEFINER/);
    expect(m![0]).toMatch(/\bSTABLE\b/i);
    expect(m![0]).toMatch(/SET\s+search_path\s*=\s*public/);
    expect(m![0]).toMatch(/has_role\(auth\.uid\(\),\s*'platform_admin'\)/);
    expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\s*\\(`));
    expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\s*\\([^)]*\\)\\s*TO authenticated`));
  });

  it("emits SSOT-allowed wording only", () => {
    const usedAllowed = P5_SCR_ALLOWED_EXTERNAL_WORDING.filter((p) => sql.includes(`'${p}'`));
    expect(usedAllowed.length).toBeGreaterThanOrEqual(6);
  });

  it("never emits SSOT banned wording", () => {
    for (const phrase of P5_SCR_BANNED_EXTERNAL_WORDING) {
      expect(codeOnly.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });

  it("never references SSOT forbidden fields", () => {
    for (const f of P5_SCR_API_FORBIDDEN_FIELDS) {
      expect(codeOnly).not.toContain(f);
    }
  });

  it("returns only SSOT API-safe fields in the projection envelope", () => {
    // Each safe field name is at least mentioned in the projection.
    const surfaced = P5_SCR_API_SAFE_FIELDS.filter((f) => sql.includes(`'${f}'`));
    expect(surfaced.length).toBeGreaterThanOrEqual(8);
  });

  it("is strictly read-only", () => {
    expect(codeOnly).not.toMatch(/INSERT\s+INTO/i);
    expect(codeOnly).not.toMatch(/UPDATE\s+public\./i);
    expect(codeOnly).not.toMatch(/DELETE\s+FROM/i);
  });

  it("creates no new tables, no cron, no Memory/finality access", () => {
    expect(sql).not.toMatch(/CREATE TABLE\s+public\.p5scr_/i);
    expect(sql).not.toMatch(/cron\.schedule\s*\(/i);
    expect(codeOnly).not.toContain("p5_batch5_memory_records");
    expect(codeOnly).not.toContain("p5_batch4_finality_records");
  });

  it("has no Batch 6/7/8 token leakage", () => {
    expect(codeOnly).not.toMatch(/p5b6_/);
    expect(codeOnly).not.toMatch(/p5b7_/);
    expect(codeOnly).not.toMatch(/p5b8_/);
  });

  it("POI gates only block on confirmed-block states in the gate projection", () => {
    expect(sql).toMatch(/poi_create[^)]*poi_accept[^)]*wad_create[\s\S]*?'failed','rejected'/);
  });
});
