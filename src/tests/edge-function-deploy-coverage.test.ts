/**
 * Deploy-coverage guard — behavioural tests for
 *   scripts/check-edge-function-deploy-coverage.mjs
 *
 * Pins:
 *   1. The shipped manifest passes (current source state is consistent).
 *   2. A simulated manifest naming a non-existent function fails.
 *   3. A simulated manifest with a function NOT mentioned in
 *      RELEASE_GATE.md fails.
 *   4. The shipped manifest includes the three MT-009 deploy-critical
 *      names so the original MT-009 Test 1 incident (deployed-source
 *      drift) is now caught at prebuild.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";

const SCRIPT = resolve("scripts/check-edge-function-deploy-coverage.mjs");
const MANIFEST = resolve("scripts/edge-function-deploy-manifest.json");
const MANIFEST_BAK = MANIFEST + ".bak";

function run() {
  try {
    const out = execFileSync("node", [SCRIPT], { encoding: "utf8" });
    return { code: 0, out, err: "" };
  } catch (e) {
    return {
      code: e.status ?? 1,
      out: e.stdout?.toString() ?? "",
      err: e.stderr?.toString() ?? "",
    };
  }
}

function withManifest(next, fn) {
  copyFileSync(MANIFEST, MANIFEST_BAK);
  try {
    writeFileSync(MANIFEST, JSON.stringify(next, null, 2));
    return fn();
  } finally {
    copyFileSync(MANIFEST_BAK, MANIFEST);
    if (existsSync(MANIFEST_BAK)) {
      try {
        execFileSync("rm", [MANIFEST_BAK]);
      } catch {/* ignore */}
    }
  }
}

describe("check-edge-function-deploy-coverage.mjs", () => {
  it("passes against the shipped manifest", () => {
    const r = run();
    expect(r.code, r.err || r.out).toBe(0);
    expect(r.out).toMatch(/check:edge-deploy-coverage/);
  });

  it("fails when a required function has no source directory", () => {
    const r = withManifest(
      {
        required: ["this-function-does-not-exist-xyz"],
        exempt_invokes: [],
      },
      run,
    );
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/has no supabase\/functions\//);
  });

  it("fails when a required function is not mentioned in RELEASE_GATE.md", () => {
    // `attestation` is a real source dir but is not named in the
    // "Edge functions requiring deploy" block of RELEASE_GATE.md.
    const gate = readFileSync(resolve("RELEASE_GATE.md"), "utf8");
    expect(gate.includes("attestation")).toBe(false);
    const r = withManifest(
      { required: ["attestation"], exempt_invokes: [] },
      run,
    );
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/not mentioned in RELEASE_GATE\.md/);
  });

  it("manifest names the three MT-009 deploy-critical functions", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
    expect(manifest.required).toContain("match-named-contacts-assign");
    expect(manifest.required).toContain("seed-mt009-controlled-prod");
    expect(manifest.required).toContain("unseed-mt009-controlled-prod");
  });

  it("RELEASE_GATE.md names the three MT-009 deploy-critical functions", () => {
    const gate = readFileSync(resolve("RELEASE_GATE.md"), "utf8");
    expect(gate).toContain("match-named-contacts-assign");
    expect(gate).toContain("seed-mt009-controlled-prod");
    expect(gate).toContain("unseed-mt009-controlled-prod");
  });
});
