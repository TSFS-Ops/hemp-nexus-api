/**
 * Batch D1 + D2 — static guards executed as vitest.
 *
 * Confirms both node guards exit 0 in the current tree, so a regression is
 * caught by `bunx vitest run` as well as by the CI script step.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, it, expect } from "vitest";

const root = path.resolve(__dirname, "..", "..");

function run(script: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [script], { cwd: root, encoding: "utf8" });
    return { code: 0, stdout, stderr: "" };
  } catch (e: any) {
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

describe("Batch D1 — no UAT password reset backdoor", () => {
  it("scripts/check-no-uat-password-reset.mjs passes", () => {
    const r = run("scripts/check-no-uat-password-reset.mjs");
    expect(r.stderr + r.stdout).toMatch(/Batch D1 no-UAT-password-reset check passed/);
    expect(r.code).toBe(0);
  });
});

describe("Batch D2 — immutability triggers/functions may not be dropped", () => {
  it("scripts/check-immutability-triggers-not-dropped.mjs passes", () => {
    const r = run("scripts/check-immutability-triggers-not-dropped.mjs");
    expect(r.stderr + r.stdout).toMatch(/Batch D2 immutability-triggers-not-dropped check passed/);
    expect(r.code).toBe(0);
  });
});
