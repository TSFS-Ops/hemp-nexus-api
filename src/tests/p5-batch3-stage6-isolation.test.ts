/**
 * P-5 Batch 3 — Stage 6 isolation test.
 *
 * Asserts the Stage 6 isolation guard script passes and that the Stage 6
 * source files satisfy the cross-cutting invariants statically.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

describe("Stage 6 isolation", () => {
  it("Stage 6 isolation guard exits 0", () => {
    const out = execSync("node scripts/check-p5-batch3-stage6-isolation.mjs", {
      encoding: "utf8",
    });
    expect(out).toMatch(/P5_BATCH_3_STAGE_6_ISOLATION_OK/);
  });

  it("FINAL consistency guard exits 0", () => {
    const out = execSync("node scripts/check-p5-batch3-final-consistency.mjs", {
      encoding: "utf8",
    });
    expect(out).toMatch(/P5_BATCH_3_FINAL_CONSISTENCY_OK/);
  });

  it("All five prior stage guards still pass", () => {
    for (const g of [1, 2, 3, 4, 5]) {
      const name = g === 1
        ? "scripts/check-p5-batch3-isolation.mjs"
        : `scripts/check-p5-batch3-stage${g}-isolation.mjs`;
      const out = execSync(`node ${name}`, { encoding: "utf8" });
      expect(out, `${name} should print STAGE_${g}_ISOLATION_OK`).toMatch(
        new RegExp(`P5_BATCH_3_STAGE_${g}_ISOLATION_OK`),
      );
    }
  });

  it("Stage 6 monitor edge function exists with internal-key auth", () => {
    const f = "supabase/functions/p5-batch3-stage6-monitor/index.ts";
    expect(existsSync(f)).toBe(true);
    const text = readFileSync(f, "utf8");
    expect(text).toMatch(/INTERNAL_CRON_KEY/);
    expect(text).toMatch(/x-internal-cron-key/i);
    expect(text).not.toMatch(/\/api\/v1\/funder/);
  });

  it("Stage 6 lib modules remain pure TS", () => {
    for (const m of [
      "src/lib/p5-batch3/notifications.ts",
      "src/lib/p5-batch3/sla-rules.ts",
      "src/lib/p5-batch3/finality-bridge.ts",
      "src/lib/p5-batch3/readiness-bridge.ts",
    ]) {
      const t = readFileSync(m, "utf8");
      expect(t).not.toMatch(/from\s+['"]@\/integrations\/supabase\/client['"]/);
      expect(t).not.toMatch(/supabase\s*\.\s*(rpc|from|functions)/);
    }
  });
});
