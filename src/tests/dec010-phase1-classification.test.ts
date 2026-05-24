/**
 * DEC-010 Phase 1 — classification model + audit constants + no-fake-
 * approval-workflow contract test.
 *
 * Source of truth: signed Client-Only Decision Form, DEC-010.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  CLAIM_CLASSIFICATIONS,
  APPROVED_NOW_CLAIMS,
  APPROVED_AFTER_HARDENING_CLAIMS,
  MANUAL_REVIEW_REQUIRED_CLAIMS,
  PROHIBITED_CLAIMS,
  ALL_CLAIM_ENTRIES,
  classifyClaimText,
  isApprovedNowId,
  isApprovedAfterHardeningId,
  CLAIMS_CLAIM_EVALUATED,
  CLAIMS_UNAPPROVED_CLAIM_BLOCKED,
  CLAIMS_CLAIM_APPROVED_BY_ADMIN,
  DEC010_AUDIT_ACTIONS,
  DEC010_PHASE,
  DEC010_ADMIN_APPROVAL_WORKFLOW_IMPLEMENTED,
  APPROVED_CLAIMS,
  IN_DEVELOPMENT_CLAIMS,
} from "@/lib/legal/claims-register";
import {
  FORBIDDEN_PUBLIC_CLAIM_PHRASES,
  findForbiddenPhrases,
} from "@/lib/legal/forbidden-terms";

const ROOT = process.cwd();

// ─── Classification model ────────────────────────────────────────────
describe("DEC-010 Phase 1 — four-tier classification model", () => {
  it("exposes exactly four classifications", () => {
    expect(CLAIM_CLASSIFICATIONS).toEqual([
      "approved_now",
      "approved_after_hardening",
      "prohibited",
      "manual_review_required",
    ]);
  });

  it("manual_review_required tier exists and is non-empty", () => {
    expect(MANUAL_REVIEW_REQUIRED_CLAIMS.length).toBeGreaterThan(0);
    for (const c of MANUAL_REVIEW_REQUIRED_CLAIMS) {
      expect(c.classification).toBe("manual_review_required");
    }
  });

  it("manual_review_required covers the DEC-010 mandated phrases", () => {
    const ids = MANUAL_REVIEW_REQUIRED_CLAIMS.map((c) => c.id);
    for (const required of [
      "review.enterprise-ready",
      "review.production-ready",
      "review.regulator-ready",
      "review.bank-ready",
      "review.institution-ready",
      "review.audit-ready",
      "review.compliance-ready",
      "review.settlement-ready",
      "review.execution-ready",
      "review.fully-verified",
      "review.trusted-counterparty-network",
      "review.verified-trade-network",
    ]) {
      expect(ids, `missing manual_review_required entry ${required}`).toContain(
        required,
      );
    }
  });

  it("approved_now mirrors legacy APPROVED_CLAIMS (backward compat)", () => {
    expect(APPROVED_CLAIMS.map((c) => c.id).sort()).toEqual(
      APPROVED_NOW_CLAIMS.map((c) => c.id).sort(),
    );
  });

  it("approved_after_hardening mirrors legacy IN_DEVELOPMENT_CLAIMS", () => {
    expect(IN_DEVELOPMENT_CLAIMS.map((c) => c.id).sort()).toEqual(
      APPROVED_AFTER_HARDENING_CLAIMS.map((c) => c.id).sort(),
    );
  });

  it("after-hardening claims cannot be re-used as approved-now", () => {
    for (const c of APPROVED_AFTER_HARDENING_CLAIMS) {
      expect(isApprovedNowId(c.id)).toBe(false);
      expect(isApprovedAfterHardeningId(c.id)).toBe(true);
    }
  });

  it("classifyClaimText routes representative phrases correctly", () => {
    expect(classifyClaimText("Izenzo replaces legal review")).toBe(
      "prohibited",
    );
    expect(classifyClaimText("Our platform is enterprise-ready")).toBe(
      "manual_review_required",
    );
    expect(
      classifyClaimText("Governed trade workflow."),
    ).toBe("approved_now");
    expect(
      classifyClaimText("Public status feed is in development."),
    ).toBe("approved_after_hardening");
  });

  it("ALL_CLAIM_ENTRIES is the union of the four tiers", () => {
    expect(ALL_CLAIM_ENTRIES.length).toBe(
      APPROVED_NOW_CLAIMS.length +
        APPROVED_AFTER_HARDENING_CLAIMS.length +
        MANUAL_REVIEW_REQUIRED_CLAIMS.length +
        PROHIBITED_CLAIMS.length,
    );
  });
});

// ─── Prohibited prose blocking ───────────────────────────────────────
describe("DEC-010 Phase 1 — prohibited prose is blocked by the static guard", () => {
  const REQUIRED_PROHIBITED = [
    "Izenzo replaces legal review",
    "Izenzo replaces financial review",
    "Izenzo replaces regulatory review",
    "Izenzo replaces human review",
    "replaces legal review",
    "replaces financial review",
    "replaces regulatory review",
    "replaces human review",
    "production-grade audit",
    "regulator-ready audit",
    "demo data is live traction",
    "test data is live traction",
    "controlled demo records are live commercial traction",
    "live production traction from demo records",
  ];

  it("FORBIDDEN_PUBLIC_CLAIM_PHRASES includes every Phase 1 prohibited prose phrase", () => {
    for (const p of REQUIRED_PROHIBITED) {
      expect(
        FORBIDDEN_PUBLIC_CLAIM_PHRASES.includes(p),
        `missing forbidden phrase: ${p}`,
      ).toBe(true);
    }
  });

  it("findForbiddenPhrases flags demo-as-live-traction wording", () => {
    expect(
      findForbiddenPhrases(
        "Our demo data is live traction across the platform.",
      ),
    ).toContain("demo data is live traction");
  });

  it("findForbiddenPhrases flags replaces-review wording", () => {
    expect(
      findForbiddenPhrases("Izenzo replaces legal review for all parties."),
    ).toContain("Izenzo replaces legal review");
  });
});

// ─── Audit action constants ──────────────────────────────────────────
describe("DEC-010 Phase 1 — canonical audit action constants", () => {
  it("exports the three canonical action names with exact strings", () => {
    expect(CLAIMS_CLAIM_EVALUATED).toBe("claims.claim_evaluated");
    expect(CLAIMS_UNAPPROVED_CLAIM_BLOCKED).toBe(
      "claims.unapproved_claim_blocked",
    );
    expect(CLAIMS_CLAIM_APPROVED_BY_ADMIN).toBe(
      "claims.claim_approved_by_admin",
    );
  });

  it("collects exactly three audit action names", () => {
    expect(DEC010_AUDIT_ACTIONS).toHaveLength(3);
    expect(new Set(DEC010_AUDIT_ACTIONS).size).toBe(3);
  });

  it("Phase marker is 1 and admin approval workflow is NOT implemented", () => {
    expect(DEC010_PHASE).toBe(1);
    expect(DEC010_ADMIN_APPROVAL_WORKFLOW_IMPLEMENTED).toBe(false);
  });
});

// ─── No fake approval workflow ───────────────────────────────────────
describe("DEC-010 Phase 1 — no admin claim-approval workflow exists yet", () => {
  // Walk src/ and supabase/functions/ and assert by absence:
  //   - no edge function directory named approve/dec010/claim-approval
  //   - no route or component named ClaimsApproval / ClaimApprovalWorkflow
  //   - `claims.claim_approved_by_admin` does NOT appear outside the
  //     SSOT module and this test file (mirrors DATA-009 pattern).
  const ALLOWED_PATHS = new Set<string>([
    "src/lib/legal/claims-register.ts",
    "src/tests/dec010-phase1-classification.test.ts",
    "scripts/check-dec010-generated-doc-claims.mjs",
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

  it("no edge function / module looks like a claims approval workflow", () => {
    const offenders = files
      .map((f) => f.replace(ROOT + "/", ""))
      .filter((rel) =>
        /(?:claim|claims)[-_]?(approval|approver|approve-workflow)/i.test(rel),
      );
    expect(offenders, offenders.join(", ")).toEqual([]);
  });

  it('"claims.claim_approved_by_admin" has no runtime emission (Phase 2 only)', () => {
    const literal = `"claims.claim_approved_by_admin"`;
    const offenders: string[] = [];
    for (const f of files) {
      const rel = f.replace(ROOT + "/", "");
      if (ALLOWED_PATHS.has(rel)) continue;
      const src = readFileSync(f, "utf8");
      if (src.includes(literal)) offenders.push(rel);
    }
    expect(offenders, offenders.join(", ")).toEqual([]);
  });
});

// ─── Generated-document lint coverage ────────────────────────────────
describe("DEC-010 Phase 1 — generated-document lint coverage", () => {
  const TEMPLATES = [
    "supabase/functions/deal-certificate/index.ts",
    "src/components/developer/IntegrationGuidePdf.ts",
  ];

  for (const rel of TEMPLATES) {
    const abs = resolve(ROOT, rel);
    if (!existsSync(abs)) continue;
    it(`${rel} contains no DEC-010 forbidden phrases`, () => {
      const src = readFileSync(abs, "utf8");
      const lines = src.split("\n").filter((l) => !l.includes("LEGAL_ALLOW"));
      const joined = lines.join("\n");
      const hits = findForbiddenPhrases(joined);
      expect(hits, hits.join(", ")).toEqual([]);
    });
  }
});
