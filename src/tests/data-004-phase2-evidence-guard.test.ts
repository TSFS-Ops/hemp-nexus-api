/**
 * DATA-004 Phase 2 — read/evidence layer guards.
 *
 * Static contract tests. They do not hit the running backend; they
 * assert the shape of the source code so the next AI loop cannot
 * silently:
 *   - rename the canonical audit names,
 *   - require AAL2 on the read-only `list` / `health` paths,
 *   - drop AAL2 from `set` / `clear`,
 *   - wire a sweeper to consume `org_retention_policies` without
 *     explicit Phase 3 sign-off.
 *
 * The corresponding prebuild guards are:
 *   - scripts/check-data-org-retention-audit-names.mjs
 *   - scripts/check-data-004-phase2-no-enforcement.mjs
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const FN_SRC = readFileSync(
  resolve(ROOT, "supabase/functions/admin-org-retention/index.ts"),
  "utf8",
);

function run(script: string) {
  execFileSync("node", [`scripts/${script}`], { cwd: ROOT, stdio: "pipe" });
}

describe("DATA-004 Phase 2 — audit-name parity (vitest mirror of prebuild guard)", () => {
  it("canonical names remain pinned", () => {
    expect(FN_SRC).toMatch(/data\.org_retention_policy\.set/);
    expect(FN_SRC).toMatch(/data\.org_retention_policy\.cleared/);
  });
  it("check-data-org-retention-audit-names.mjs passes", () => {
    expect(() => run("check-data-org-retention-audit-names.mjs")).not.toThrow();
  });
});

describe("DATA-004 Phase 2 — AAL2 gating", () => {
  // set / clear MUST gate on AAL2 (mutating).
  // list / health MUST NOT gate on AAL2 (read-only evidence surfaces).
  it("only mutating actions gate on assertAal2", () => {
    expect(FN_SRC).toMatch(
      /parsed\.data\.action === "set" \|\| parsed\.data\.action === "clear"/,
    );
    // The aal2 guard appears inside that conditional only — there must
    // be exactly one assertAal2 callsite in the file.
    const callsites = FN_SRC.match(/assertAal2\(/g) ?? [];
    expect(callsites.length).toBe(1);
  });

  it("health action exists and is read-only", () => {
    expect(FN_SRC).toMatch(/action === "health"/);
    expect(FN_SRC).toMatch(/enforcement_status:\s*"shell_only_no_sweeper_enforcement"/);
    // The health response must explicitly stamp record_classes_enforced: 0.
    expect(FN_SRC).toMatch(/record_classes_enforced:\s*0/);
  });
});

describe("DATA-004 Phase 2 — no sweeper enforcement yet", () => {
  it("check-data-004-phase2-no-enforcement.mjs passes (no sweeper consumes the table)", () => {
    expect(() => run("check-data-004-phase2-no-enforcement.mjs")).not.toThrow();
  });

  it("Phase 2 evidence panel exists and labels itself as not-wired", () => {
    const panel = readFileSync(
      resolve(ROOT, "src/components/admin/OrgRetentionHealthPanel.tsx"),
      "utf8",
    );
    expect(panel).toMatch(/SHELL ONLY — no sweeper reads this yet/);
    expect(panel).toMatch(/enforcement_wired/);
  });
});

describe("DATA-004 Phase 2 — missing policy semantics", () => {
  it("missing policies are surfaced as 'missing → platform floor', not as deletion-approved", () => {
    expect(FN_SRC).toMatch(/source = "missing"/);
    // Effective value when missing must come from the platform floor map,
    // never from a zero / null / undefined default.
    expect(FN_SRC).toMatch(/retention_days = floor/);
  });

  it("active org-scoped legal holds are surfaced per-org in the health payload", () => {
    expect(FN_SRC).toMatch(/active_org_legal_holds/);
    expect(FN_SRC).toMatch(/scope_type.*org/);
  });
});
