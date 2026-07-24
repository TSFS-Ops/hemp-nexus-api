/**
 * P-5 Screening & IDV Phase 6 — Memory/audit hardening + final QA aggregate.
 *
 * Pure static checks against the Phase 6 migration and the cumulative
 * evidence README. No DB calls, no UI render.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  P5_SCR_MEMORY_BANNED_PAYLOAD_KINDS,
  P5_SCR_API_FORBIDDEN_FIELDS,
} from "@/lib/p5-screening/registry";

const root = resolve(process.cwd());
const migDir = resolve(root, "supabase/migrations");
const phase6File = readdirSync(migDir)
  .filter((f) => f.startsWith("20260626182605_"))
  .sort()
  .pop()!;
const sql = readFileSync(resolve(migDir, phase6File), "utf8");
const readme = readFileSync(
  resolve(root, "evidence/p5-screening-idv-provider-ready-flow/README.md"),
  "utf8",
);

describe("P-5 Screening Phase 6 — Memory & audit hardening", () => {
  it("installs the memory-link kind guard trigger", () => {
    expect(sql).toContain("FUNCTION public.p5scr_block_banned_memory_link_kind()");
    expect(sql).toContain("TRIGGER p5scr_memory_link_kind_guard");
    expect(sql).toContain("ON public.p5scr_memory_finality_links");
  });

  it("installs the audit-payload key guard trigger", () => {
    expect(sql).toContain("FUNCTION public.p5scr_block_banned_audit_payload_keys()");
    expect(sql).toContain("TRIGGER p5scr_audit_payload_key_guard");
    expect(sql).toContain("ON public.p5scr_audit_events");
  });

  it("both guard functions are SECURITY DEFINER with pinned search_path", () => {
    const matches = sql.match(/SECURITY DEFINER SET search_path = public/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("REVOKEs EXECUTE on both guard functions from PUBLIC", () => {
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.p5scr_block_banned_memory_link_kind() FROM PUBLIC",
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.p5scr_block_banned_audit_payload_keys() FROM PUBLIC",
    );
  });

  it("memory-link guard covers every SSOT Memory-banned payload kind", () => {
    for (const kind of P5_SCR_MEMORY_BANNED_PAYLOAD_KINDS) {
      expect(sql).toContain(`'${kind}'`);
    }
  });

  it("audit-payload guard covers every SSOT API-forbidden field", () => {
    for (const key of P5_SCR_API_FORBIDDEN_FIELDS) {
      expect(sql).toContain(`'${key}'`);
    }
  });

  it("Phase 6 migration is additive only — no new tables/policies/cron/edge", () => {
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
    expect(sql).not.toMatch(/cron\./i);
    expect(sql).not.toMatch(/supabase_functions\./i);
  });

  it("Phase 6 migration touches no Batch 6/7/8 surfaces", () => {
    expect(sql).not.toMatch(/\bp5b6_/);
    expect(sql).not.toMatch(/\bp5b7_/);
    expect(sql).not.toMatch(/\bp5b8_/);
  });

  it("Phase 6 migration never mutates Memory or finality tables", () => {
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.p5_batch4_finality_records/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.p5_batch5_memory_records/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.p5_batch4_finality_records/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.p5_batch5_memory_records/i);
  });
});

describe("P-5 Screening final QA aggregate", () => {
  const requiredArtifacts = [
    "src/lib/p5-screening/registry.ts",
    "src/lib/p5-screening/api.ts",
    "src/pages/admin/p5-screening/Workbench.tsx",
    "scripts/check-p5-screening-phase-1-registry.mjs",
    "scripts/check-p5-screening-phase-2-db.mjs",
    "scripts/check-p5-screening-phase-3-rpc.mjs",
    "scripts/check-p5-screening-phase-4-projection.mjs",
    "scripts/check-p5-screening-phase-5-ui.mjs",
    "scripts/check-p5-screening-phase-6-memory-audit.mjs",
    "src/tests/p5-screening-phase-1-registry.test.ts",
    "src/tests/p5-screening-phase-2-db.test.ts",
    "src/tests/p5-screening-phase-3-rpc.test.ts",
    "src/tests/p5-screening-phase-4-projection.test.ts",
    "src/tests/p5-screening-phase-5-ui.test.ts",
  ];

  for (const p of requiredArtifacts) {
    it(`artifact present: ${p}`, () => {
      expect(existsSync(resolve(root, p))).toBe(true);
    });
  }

  const requiredMarkers = [
    "P5_SCREENING_PHASE_1_DEPLOYED",
    "P5_SCREENING_PHASE_2_DEPLOYED",
    "P5_SCREENING_PHASE_3_DEPLOYED",
    "P5_SCREENING_PHASE_4_DEPLOYED",
    "P5_SCREENING_PHASE_5_DEPLOYED",
    "P5_SCREENING_PHASE_6_DEPLOYED",
    "P5_SCREENING_IDV_FINAL_QA_COMPLETE",
  ];
  for (const m of requiredMarkers) {
    it(`README carries marker: ${m}`, () => {
      expect(readme).toContain(m);
    });
  }
});
