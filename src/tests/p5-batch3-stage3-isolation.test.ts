/**
 * P-5 Batch 3 — Stage 3 isolation invariants.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

describe("P5 Batch 3 Stage 3 — isolation guards", () => {
  it("Stage 3 isolation guard passes", () => {
    const out = execSync("node scripts/check-p5-batch3-stage3-isolation.mjs", { encoding: "utf8" });
    expect(out).toMatch(/P5_BATCH_3_STAGE_3_ISOLATION_OK/);
  });

  it("Stage 1 isolation guard still passes", () => {
    const out = execSync("node scripts/check-p5-batch3-isolation.mjs", { encoding: "utf8" });
    expect(out).toMatch(/P5_BATCH_3_STAGE_1_ISOLATION_OK/);
  });

  it("Stage 2 isolation guard still passes", () => {
    const out = execSync("node scripts/check-p5-batch3-stage2-isolation.mjs", { encoding: "utf8" });
    expect(out).toMatch(/P5_BATCH_3_STAGE_2_ISOLATION_OK/);
  });

  it("no notifications / cron / SLA module added in Stage 3", () => {
    expect(existsSync(join(ROOT, "src/lib/p5-batch3/notifications.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "src/lib/p5-batch3/sla-rules.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "src/lib/p5-batch3/finality-bridge.ts"))).toBe(false);
  });

  it("no funder UI dir added in Stage 3", () => {
    expect(existsSync(join(ROOT, "src/pages/funder/p5-batch3"))).toBe(false);
  });

  it("safe summary edge function is present (Stage 3 scope)", () => {
    expect(existsSync(join(ROOT, "supabase/functions/p5-batch3-funder-summary/index.ts"))).toBe(true);
  });

  it("RPC client wrapper file is present (Stage 3 scope)", () => {
    expect(existsSync(join(ROOT, "src/lib/p5-batch3/rpc.ts"))).toBe(true);
  });
});
