/**
 * P-5 Batch 8 — Phase 6 QA wrapper.
 *
 * Runs the cross-phase QA guard as a vitest case so it ships with CI.
 * The guard script is the source of truth — this test only asserts exit 0
 * and the "all Phase 6 invariants pass" marker.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const SCRIPT = resolve(__dirname, "..", "..", "scripts/check-p5-batch8-phase-6-qa.mjs");

describe("P-5 Batch 8 — Phase 6 cross-phase QA guard", () => {
  it("passes the cross-phase consistency / security / wording audit", () => {
    let output = "";
    let failed = false;
    try {
      output = execFileSync("node", [SCRIPT], { encoding: "utf8" });
    } catch (e: unknown) {
      failed = true;
      const err = e as { stdout?: string; stderr?: string };
      output = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
    }
    expect(failed, `Phase 6 QA guard failed:\n${output}`).toBe(false);
    expect(output).toMatch(/all Phase 6 cross-phase invariants pass/);
  });
});
