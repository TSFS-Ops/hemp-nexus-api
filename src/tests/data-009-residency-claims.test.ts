/**
 * DATA-009 Phase 1 — data-residency truthfulness & claim-control test.
 *
 * Source of truth: signed Client-Only Decision Form, DATA-009.
 *
 * This test asserts the Phase 1 contract:
 *   - Policy SSOT at `src/lib/policy/data-residency-policy.ts` exists,
 *     names the single approved production-region storage policy, and
 *     declares the four canonical DATA-009 audit action constants.
 *   - No unapproved residency phrase appears in the listed public /
 *     admin / docs surfaces (unless qualified by cautious approved
 *     wording).
 *   - No runtime emission of the four DATA-009 audit names is wired
 *     yet — Phase 2 is explicitly out of scope.
 *   - No automatic storage / migration / region-split / backup / export
 *     / deletion / re-hosting wiring exists triggered by a residency
 *     request.
 *
 * The forbidden-phrase list is intentionally mirrored from
 * `scripts/check-data-009-residency-claims.mjs` so the two surfaces
 * stay in lockstep. This file carries the `DATA_009_ALLOW` marker on
 * the forbidden-string list so the prebuild guard does not flag it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  DATA_RESIDENCY_POLICY,
  DATA_RESIDENCY_APPROVED_WORDING,
  DATA_RESIDENCY_REQUIREMENT_DETECTED,
  DATA_UNAPPROVED_RESIDENCY_CLAIM_BLOCKED,
  DATA_RESIDENCY_EXCEPTION_APPROVED,
  DATA_RESIDENCY_EXCEPTION_DECLINED,
  DATA_RESIDENCY_AUDIT_ACTIONS,
  DATA_RESIDENCY_POLICY_PHASE,
} from "@/lib/policy/data-residency-policy";

const ROOT = process.cwd();

// DATA_009_ALLOW — sanctioned test-side mirror of forbidden strings.
const FORBIDDEN_PHRASES = [
  "EU-only",
  "SA-only",
  "South Africa-only",
  "local-only",
  "sovereign data",
  "sovereign residency",
  "per-organisation residency",
  "per-organization residency",
  "jurisdiction-locked data residency",
  "jurisdiction residency lock",
  "region selectable at onboarding",
  "residency is enforced",
  "no cross-border movement",
  "permanent regional data-residency lock",
  "regional data-residency lock",
];

const SCAN_FILES = [
  "src/components/landing/HeroStripeGlow.tsx",
  "src/pages/solutions/Sovereigns.tsx",
  "src/pages/products/TradeDesk.tsx",
  "src/components/admin/BrdConstraintsPanel.tsx",
  "src/pages/Auth.tsx",
  "src/pages/Pricing.tsx",
  "src/pages/Developers.tsx",
  "src/pages/Welcome.tsx",
  "src/pages/Docs.tsx",
  "src/pages/Status.tsx",
  "src/pages/solutions/Traders.tsx",
  "src/pages/solutions/Finance.tsx",
  "src/components/PublicHeader.tsx",
  "docs/getting-started.md",
  "docs/infrastructure-requirements.md",
];

function lineIsApprovedQualified(line: string) {
  const lower = line.toLowerCase();
  return lower.includes("separate") && lower.includes("approval");
}

describe("DATA-009 Phase 1 — policy SSOT", () => {
  it("declares a single approved production-region storage policy", () => {
    expect(DATA_RESIDENCY_POLICY.default).toMatch(
      /single approved production-region/i,
    );
  });

  it("states that per-organisation residency is not automatically applied", () => {
    expect(DATA_RESIDENCY_POLICY.perOrgUnsupported.toLowerCase()).toMatch(
      /not automatically applied/,
    );
  });

  it("states that residency requirements require separate Izenzo approval", () => {
    expect(
      DATA_RESIDENCY_POLICY.requiresSeparateApproval.toLowerCase(),
    ).toMatch(/separate/);
    expect(
      DATA_RESIDENCY_POLICY.requiresSeparateApproval.toLowerCase(),
    ).toMatch(/approval/);
  });

  it("states that no automatic storage side-effects occur from a residency request", () => {
    const s = DATA_RESIDENCY_POLICY.noAutomaticSideEffects.toLowerCase();
    expect(s).toMatch(/no automatic/);
    expect(s).toMatch(/migration/);
    expect(s).toMatch(/re-hosting/);
  });

  it("exposes pre-approved cautious wording strings", () => {
    expect(DATA_RESIDENCY_APPROVED_WORDING.shortPolicy).toBeTruthy();
    expect(
      DATA_RESIDENCY_APPROVED_WORDING.perOrgRequiresApproval,
    ).toBeTruthy();
    expect(DATA_RESIDENCY_APPROVED_WORDING.reviewNotAutomatic).toBeTruthy();
    expect(
      DATA_RESIDENCY_APPROVED_WORDING.noCommitmentUnlessApproved,
    ).toBeTruthy();
  });

  it("is currently Phase 1 — exception workflow is Phase 2 / not implemented", () => {
    expect(DATA_RESIDENCY_POLICY_PHASE).toBe(1);
  });
});

describe("DATA-009 Phase 1 — canonical audit action constants", () => {
  it("exports all four canonical audit action names with exact strings", () => {
    expect(DATA_RESIDENCY_REQUIREMENT_DETECTED).toBe(
      "data.residency_requirement_detected",
    );
    expect(DATA_UNAPPROVED_RESIDENCY_CLAIM_BLOCKED).toBe(
      "data.unapproved_residency_claim_blocked",
    );
    expect(DATA_RESIDENCY_EXCEPTION_APPROVED).toBe(
      "data.residency_exception_approved",
    );
    expect(DATA_RESIDENCY_EXCEPTION_DECLINED).toBe(
      "data.residency_exception_declined",
    );
  });

  it("collects exactly four audit action names in the SSOT array", () => {
    expect(DATA_RESIDENCY_AUDIT_ACTIONS).toHaveLength(4);
    expect(new Set(DATA_RESIDENCY_AUDIT_ACTIONS).size).toBe(4);
  });
});

describe("DATA-009 Phase 1 — forbidden-claim scan over public/admin/docs surfaces", () => {
  for (const rel of SCAN_FILES) {
    const abs = resolve(ROOT, rel);
    if (!existsSync(abs)) continue;
    it(`${rel} contains no unapproved residency claims`, () => {
      const src = readFileSync(abs, "utf8");
      const offenders: string[] = [];
      src.split("\n").forEach((line, idx) => {
        if (line.includes("DATA_009_ALLOW")) return;
        const lower = line.toLowerCase();
        for (const phrase of FORBIDDEN_PHRASES) {
          if (lower.includes(phrase.toLowerCase())) {
            if (lineIsApprovedQualified(line)) continue;
            offenders.push(`${rel}:${idx + 1}  "${phrase}"`);
          }
        }
      });
      expect(offenders, offenders.join("\n")).toEqual([]);
    });
  }
});

describe("DATA-009 Phase 1 — no runtime emission of audit names is wired (Phase 2 deferred)", () => {
  // Walk supabase/functions and src (excluding the policy SSOT, this
  // test, and the prebuild guard) and assert that no code emits any of
  // the four canonical action names. Phase 2 will wire them; faking
  // emissions now is explicitly forbidden by DATA-009 Phase 1.
  const ALLOWED_PATHS = new Set<string>([
    "src/lib/policy/data-residency-policy.ts",
    "src/tests/data-009-residency-claims.test.ts",
    "scripts/check-data-009-residency-claims.mjs",
  ]);
  const ROOTS = ["src", "supabase/functions"];

  function walk(dir: string, acc: string[] = []): string[] {
    if (!existsSync(dir)) return acc;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (entry === "node_modules" || entry === "dist") continue;
        walk(full, acc);
      } else if (/\.(ts|tsx|mjs|js)$/.test(entry)) {
        acc.push(full);
      }
    }
    return acc;
  }

  const files = ROOTS.flatMap((r) => walk(resolve(ROOT, r)));

  for (const action of [
    "data.residency_requirement_detected",
    "data.unapproved_residency_claim_blocked",
    "data.residency_exception_approved",
    "data.residency_exception_declined",
  ]) {
    it(`"${action}" appears only in DATA-009 SSOT/test (no Phase 2 emissions wired)`, () => {
      const offenders: string[] = [];
      const literal = `"${action}"`;
      for (const f of files) {
        const rel = f.replace(ROOT + "/", "");
        if (ALLOWED_PATHS.has(rel)) continue;
        const src = readFileSync(f, "utf8");
        if (src.includes(literal)) offenders.push(rel);
      }
      expect(offenders, offenders.join(", ")).toEqual([]);
    });
  }
});

describe("DATA-009 Phase 1 — no automatic storage/migration/region-split wiring exists", () => {
  // Assert by absence: nothing under supabase/migrations or
  // supabase/functions references a residency-driven migration / split /
  // backup-change / export-restriction / re-hosting workflow.
  const SENTINELS = [
    "residency_review_required",
    "onboarding_hold_residency_review",
    "residency_exception_workflow",
    "residency_region_split",
    "residency_migrate",
    "residency_rehost",
  ];

  function walk(dir: string, acc: string[] = []): string[] {
    if (!existsSync(dir)) return acc;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (entry === "node_modules" || entry === "dist") continue;
        walk(full, acc);
      } else {
        acc.push(full);
      }
    }
    return acc;
  }

  const files = [
    ...walk(resolve(ROOT, "supabase/migrations")),
    ...walk(resolve(ROOT, "supabase/functions")),
  ];

  it("no migration or edge function references a residency exception workflow yet", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const s of SENTINELS) {
        if (src.includes(s)) {
          offenders.push(`${f.replace(ROOT + "/", "")}  contains  "${s}"`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
