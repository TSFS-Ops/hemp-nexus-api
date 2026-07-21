import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Regression test for PR #26 Phase 3: the compliance-cases Edge Function
// previously had an outer "governance principal" gate (applied to every
// method) that only allowed platform_admin / auditor / org_admin through,
// while the PATCH handler's own inner gate separately allowed a wider set
// of roles (admin, compliance_analyst, legal_reviewer, director). Because
// the outer gate ran first and rejected with 403 before the inner check
// ever executed, those legitimate compliance roles could never reach the
// PATCH decision logic the inner check was written to permit. This test
// statically asserts the outer gate's role list is always a superset of
// the inner PATCH gate's role list, so this class of defect cannot
// silently reappear.

const SRC_PATH = join(
  process.cwd(),
  "supabase/functions/compliance-cases/index.ts"
  );
const SRC = readFileSync(SRC_PATH, "utf8");

function extractRoleArray(source: string, marker: string): string[] {
  const idx = source.indexOf(marker);
  if (idx === -1) throw new Error(`marker not found: ${marker}`);
  const arrayMatch = source.slice(idx).match(/\[([^\]]*)\]/);
  if (!arrayMatch) throw new Error(`role array not found after marker: ${marker}`);
  return arrayMatch[1]
  .split(",")
  .map((s) => s.trim().replace(/^"|"$/g, ""))
  .filter(Boolean);
}

describe("compliance-cases outer/inner role gate consistency", () => {
  it("outer GOVERNANCE_ROLES gate is a superset of the inner PATCH decide-case role check", () => {
    const outerRoles = extractRoleArray(SRC, "const GOVERNANCE_ROLES = ");
    const innerRoles = extractRoleArray(SRC, "const isComplianceOrAdmin = authCtx.roles.some((r) =>");

     expect(outerRoles.length).toBeGreaterThan(0);
    expect(innerRoles.length).toBeGreaterThan(0);

     const missing = innerRoles.filter((role) => !outerRoles.includes(role));
    expect(missing).toEqual([]);
  });

         it("still requires a governance/compliance role — does not degrade to an open gate", () => {
           const outerRoles = extractRoleArray(SRC, "const GOVERNANCE_ROLES = ");
           expect(outerRoles).not.toContain("org_member");
           expect(outerRoles).not.toContain("buyer");
           expect(outerRoles).not.toContain("seller");
           expect(outerRoles.length).toBeLessThan(10);
         });

         it("the outer gate is evaluated before any method-specific handler runs", () => {
           const outerIdx = SRC.indexOf("const GOVERNANCE_ROLES = ");
           const firstMethodHandlerIdx = SRC.indexOf('req.method === "POST"');
           expect(outerIdx).toBeGreaterThan(-1);
           expect(firstMethodHandlerIdx).toBeGreaterThan(-1);
           expect(outerIdx).toBeLessThan(firstMethodHandlerIdx);
         });
});
