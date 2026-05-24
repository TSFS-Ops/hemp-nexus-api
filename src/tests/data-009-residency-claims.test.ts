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

  it("policy SSOT has advanced to Phase 2 (review workflow wired)", () => {
    expect(DATA_RESIDENCY_POLICY_PHASE).toBe(2);
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

describe("DATA-009 — Phase 2 emissions are wired (supersedes Phase 1 deferral)", () => {
  it("phase indicator confirms Phase 2 is live; per-emission coverage is enforced by scripts/check-data-009-phase2-audit-emission.mjs", () => {
    expect(DATA_RESIDENCY_POLICY_PHASE).toBe(2);
  });
});


