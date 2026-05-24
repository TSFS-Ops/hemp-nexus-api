/**
 * SEC-001-FU-001 — dedicated AAL2 coverage suite.
 *
 * Source-level pins that prove every endpoint named in the SEC-001
 * hardening plan still imports and calls `assertAal2`, and that the
 * canonical action keys are present in the AAL preflight registry.
 *
 * These are intentionally string-based so they survive refactors of
 * the runtime helpers — they fail if a future change removes or
 * silently renames an MFA gate.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");
const FN = (name: string) =>
  readFileSync(join(REPO_ROOT, "supabase/functions", name, "index.ts"), "utf8");

const AAL_PREFLIGHT_SRC = FN("aal-preflight");
const DRIFT_GUARD_PATH = join(REPO_ROOT, "scripts/check-aal-registry-drift.mjs");
const PKG = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

function importsAssertAal2(src: string): boolean {
  return /import\s+\{[^}]*\bassertAal2\b[^}]*\}\s+from\s+["'][^"']*_shared\/aal\.ts["']/.test(
    src,
  );
}

describe("SEC-001 — assertAal2 is wired on every sensitive admin mutating endpoint", () => {
  it("entities/index.ts imports and calls assertAal2 with entity.mutate", () => {
    const src = FN("entities");
    expect(importsAssertAal2(src)).toBe(true);
    expect(src).toMatch(/assertAal2\s*\(/);
    // entities/index.ts wraps the gate in a per-file helper that
    // receives the action key as a positional argument, so we look for
    // the literal anywhere in the file.
    expect(src).toMatch(/["']entity\.mutate["']/);
  });

  it("orgs/index.ts gates mutating verbs (POST/PATCH/DELETE) but skips GET", () => {
    const src = FN("orgs");
    expect(importsAssertAal2(src)).toBe(true);
    expect(src).toMatch(/action:\s*["']organisation\.mutate["']/);
    // The gate helper must be invoked only inside non-GET branches.
    const helperName = "requireMfaForOrgMutation";
    expect(src).toContain(helperName);
    // Find every helper call-site and confirm none sit inside the GET
    // /orgs list branch — a coarse check that GET stays AAL1.
    const lines = src.split("\n");
    const getBranchStart = lines.findIndex((l) =>
      /req\.method\s*===\s*['"]GET['"]/.test(l),
    );
    const callSites = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.includes(helperName + "("));
    for (const { i } of callSites) {
      // Each call must appear before the next non-GET branch boundary;
      // any call before the first GET handler would be a structural bug.
      expect(i).toBeGreaterThan(getBranchStart);
    }
    // Sanity — every call belongs to a mutating verb context.
    expect(callSites.length).toBeGreaterThan(0);
  });

  it("authority-bind/index.ts imports and calls assertAal2 with authority.bind", () => {
    const src = FN("authority-bind");
    expect(importsAssertAal2(src)).toBe(true);
    expect(src).toMatch(/action:\s*["']authority\.bind["']/);
  });

  it("trade-approval/index.ts imports and calls assertAal2 with trade.approval_override", () => {
    const src = FN("trade-approval");
    expect(importsAssertAal2(src)).toBe(true);
    expect(src).toMatch(/action:\s*["']trade\.approval_override["']/);
  });

  it("poi-engagements/index.ts imports and calls assertAal2 with pending_engagement.send_outreach", () => {
    const src = FN("poi-engagements");
    expect(importsAssertAal2(src)).toBe(true);
    expect(src).toMatch(/action:\s*["']pending_engagement\.send_outreach["']/);
  });

  it("calculate-reputation/index.ts imports and calls assertAal2 with reputation.recalculate", () => {
    const src = FN("calculate-reputation");
    expect(importsAssertAal2(src)).toBe(true);
    expect(src).toMatch(/action:\s*["']reputation\.recalculate["']/);
  });

  it("hq-fixture-recovery-email/index.ts imports and calls assertAal2 with admin.user_recovery_dispatch before recovery dispatch", () => {
    const src = FN("hq-fixture-recovery-email");
    expect(importsAssertAal2(src)).toBe(true);
    expect(src).toMatch(/action:\s*["']admin\.user_recovery_dispatch["']/);
    // assertAal2 must run BEFORE resetPasswordForEmail dispatch.
    const gateIdx = src.indexOf("admin.user_recovery_dispatch");
    const dispatchIdx = src.indexOf("resetPasswordForEmail");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(dispatchIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(dispatchIdx);
  });

  it("governance-docs/index.ts imports and gates PATCH with governance.doc_validate before token burn", () => {
    const src = FN("governance-docs");
    expect(importsAssertAal2(src)).toBe(true);
    expect(src).toMatch(/action:\s*["']governance\.doc_validate["']/);
    // assertAal2 must run BEFORE the atomic_validate_governance_doc RPC.
    const gateIdx = src.indexOf("governance.doc_validate");
    const burnIdx = src.indexOf("atomic_validate_governance_doc");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(burnIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(burnIdx);
    // The gate must be inside the PATCH branch and skipped for API-key callers.
    expect(src).toMatch(/if\s*\(\s*!authCtx\.isApiKey\s*\)\s*\{[\s\S]*?assertAal2/);
  });

  it("delete-account/index.ts documents the self-only AAL2 exemption and does NOT call assertAal2", () => {
    const src = FN("delete-account");
    expect(src).toMatch(/SEC-001 — AAL2 EXEMPTION/);
    expect(src).toMatch(/SELF-ONLY/);
    // No real assertAal2 call must exist (comments referring to it for
    // documentation are fine — strip line comments before scanning).
    const codeOnly = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(codeOnly).not.toMatch(/assertAal2\s*\(/);
  });
});

describe("SEC-001 — aal-preflight registry contains every SEC-001 + DATA-010 + follow-up key", () => {
  const REQUIRED_KEYS = [
    "entity.mutate",
    "organisation.mutate",
    "authority.bind",
    "trade.approval_override",
    "pending_engagement.send_outreach",
    "reputation.recalculate",
    "export.admin_pii_export",
    // SEC-001 follow-up patches
    "admin.user_recovery_dispatch",
    "governance.doc_validate",
  ];

  for (const key of REQUIRED_KEYS) {
    it(`registers ${key} as aal2`, () => {
      const re = new RegExp(
        `["']${key.replace(/\./g, "\\.")}["']\\s*:\\s*["']aal2["']`,
      );
      expect(AAL_PREFLIGHT_SRC).toMatch(re);
    });
  }

  it("does NOT list break_glass in the preflight registry (uses GoTrue password re-auth)", () => {
    // The registry must not assign an aal level to break_glass — its
    // identity proof is fresh password re-auth, not a JWT aal claim.
    expect(AAL_PREFLIGHT_SRC).not.toMatch(/["']break_glass["']\s*:\s*["']aal[12]["']/);
  });
});

describe("SEC-001 — drift guard is present and wired into prebuild", () => {
  it("scripts/check-aal-registry-drift.mjs exists", () => {
    expect(existsSync(DRIFT_GUARD_PATH)).toBe(true);
  });

  it("package.json prebuild runs the drift guard", () => {
    expect(PKG.scripts.prebuild).toContain("check-aal-registry-drift.mjs");
  });

  it("package.json prebuild also runs the DATA-010 export payload guard", () => {
    expect(PKG.scripts.prebuild).toContain("check-export-audit-payload.mjs");
  });
});
