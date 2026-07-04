/**
 * Batch V-UI-Fix — Source-scan test proving the shared IDV UI components
 * are actually mounted on the real user-facing controlled-action and
 * funder pages, not just imported inside tests.
 *
 * A prior audit found `IdvBlockerNotice` and `FunderIdvSummary` were
 * imported ONLY from tests, so the smoke test was not runnable end-to-
 * end. This test locks that in.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const CONTROLLED_ACTION_PAGES: Array<{ path: string; label: string }> = [
  { path: "src/components/wad/WadStepper.tsx", label: "WaD seal" },
  { path: "src/components/match/AcceptBindCard.tsx", label: "binding POI (accept & bind)" },
];

const FUNDER_PAGES: Array<{ path: string; label: string }> = [
  { path: "src/pages/funder/p5-batch7/FunderDashboard.tsx", label: "funder dashboard" },
  { path: "src/pages/funder/p5-batch3/Readiness.tsx", label: "funder readiness" },
];

describe("Batch V-UI-Fix — IDV surface mount check", () => {
  for (const p of CONTROLLED_ACTION_PAGES) {
    it(`${p.label} page imports and renders <IdvBlockerNotice />`, () => {
      const src = readFileSync(p.path, "utf8");
      expect(src).toMatch(/from ["']@\/components\/idv\/IdvBlockerNotice["']/);
      expect(src).toMatch(/<IdvBlockerNotice\b/);
    });
  }

  for (const p of FUNDER_PAGES) {
    it(`${p.label} page imports and renders <FunderIdvSummary />`, () => {
      const src = readFileSync(p.path, "utf8");
      expect(src).toMatch(/from ["']@\/components\/idv\/FunderIdvSummary["']/);
      expect(src).toMatch(/<FunderIdvSummary\b/);
    });
  }

  it("blocker extractor helper exists and only returns IDV_ codes on 409", async () => {
    const { extractIdvBlockerFromError } = await import(
      "@/lib/idv/blocker-from-error"
    );
    const { ApiError } = await import("@/lib/api-client");
    // 409 with IDV_ code in details → blocker returned.
    const idvErr = new ApiError(
      409,
      "blocked",
      undefined,
      undefined,
      { blocker_code: "IDV_REQUIRED_WAD_SEAL", user_message: "Please verify" },
    );
    expect(extractIdvBlockerFromError(idvErr)).toEqual({
      blocker_code: "IDV_REQUIRED_WAD_SEAL",
      user_message: "Please verify",
    });
    // 409 without IDV_ code → null (do not misclassify).
    const otherErr = new ApiError(409, "conflict", undefined, undefined, {
      blocker_code: "OTHER_CONFLICT",
    });
    expect(extractIdvBlockerFromError(otherErr)).toBeNull();
    // 500 with IDV_ code → null (only 409 is a blocker).
    const wrongStatus = new ApiError(500, "boom", undefined, undefined, {
      blocker_code: "IDV_REQUIRED_WAD_SEAL",
    });
    expect(extractIdvBlockerFromError(wrongStatus)).toBeNull();
    // Non-Error input → null.
    expect(extractIdvBlockerFromError(null)).toBeNull();
    expect(extractIdvBlockerFromError("nope")).toBeNull();
  });

  it("sealWad plumbs idvBlocker onto ConsequenceResult", () => {
    const src = readFileSync("src/lib/modules/consequence/index.ts", "utf8");
    expect(src).toMatch(/extractIdvBlockerFromError/);
    expect(src).toMatch(/idvBlocker/);
  });

  it("VerifyNow secret names are not present in frontend source", () => {
    // Scan the surfaces we just wired to guarantee we did not leak the
    // VerifyNow API key or any provider secret while adding IDV UI.
    for (const p of [...CONTROLLED_ACTION_PAGES, ...FUNDER_PAGES]) {
      const src = readFileSync(p.path, "utf8");
      expect(src).not.toMatch(/VERIFYNOW_API_KEY/);
      expect(src).not.toMatch(/VERIFYNOW_SECRET/);
    }
  });
});
