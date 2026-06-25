/**
 * P-5 Batch 4 — Stage 2 isolation guard test.
 *
 * Asserts the Stage 2 static guard exits 0 and that prior-stage guards
 * (Stage 1) still pass after Stage 2 lands.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("P-5 Batch 4 Stage 2 — isolation guards", () => {
  it("Stage 2 isolation guard passes", () => {
    const out = execSync("node scripts/check-p5-batch4-stage2-isolation.mjs", {
      encoding: "utf8",
    });
    expect(out).toMatch(/P5_BATCH_4_STAGE_2_ISOLATION_OK/);
  });

  it("Stage 1 isolation guard still passes", () => {
    const out = execSync("node scripts/check-p5-batch4-stage1-isolation.mjs", {
      encoding: "utf8",
    });
    expect(out).toMatch(/P5_BATCH_4_STAGE_1_ISOLATION_OK/);
  });
});
