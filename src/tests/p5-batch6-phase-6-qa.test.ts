/**
 * P-5 Batch 6 — Phase 6 QA wrapper.
 *
 * Executes the comprehensive Phase 6 drift guard as a vitest case so it
 * runs in CI alongside the other Batch 6 contract tests. The guard
 * itself is the source of truth — this file just asserts exit 0.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const SCRIPT = resolve(__dirname, "..", "..", "scripts/check-p5-batch6-phase-6-qa.mjs");

describe("P-5 Batch 6 — Phase 6 QA guard", () => {
  it("passes the cross-phase consistency / security / wording audit", () => {
    let output = "";
    let failed = false;
    try {
      output = execFileSync("node", [SCRIPT], { encoding: "utf8" });
    } catch (e: any) {
      failed = true;
      output = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
    }
    expect(failed, `Phase 6 QA guard failed:\n${output}`).toBe(false);
    expect(output).toMatch(/all Phase 6 invariants pass/);
  });
});
