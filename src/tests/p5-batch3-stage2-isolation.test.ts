/**
 * P-5 Batch 3 — Stage 2 isolation invariant (runs the static guard).
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("Stage 2 isolation guard", () => {
  it("scripts/check-p5-batch3-stage2-isolation.mjs passes", () => {
    const out = execSync("node scripts/check-p5-batch3-stage2-isolation.mjs", {
      encoding: "utf8",
    });
    expect(out).toMatch(/P5_BATCH_3_STAGE_2_ISOLATION_OK/);
  });
  it("Stage 1 isolation guard still passes", () => {
    const out = execSync("node scripts/check-p5-batch3-isolation.mjs", {
      encoding: "utf8",
    });
    expect(out).toMatch(/P5_BATCH_3_STAGE_1_ISOLATION_OK/);
  });
});
