/**
 * C10 sealed/legal-hold UI wording containment — safe subset guard.
 *
 * Asserts L-1 (HoldDialog) and D-1 (ProofDocumentsList) wording fixes
 * remain in place and the prior overclaiming strings do not regress.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";
import { BANNED_TRUST_PHRASES } from "@/lib/policy/audit-ledger-capability";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8");

describe("C10 UI wording containment — safe subset", () => {
  it("L-1: HoldDialog uses tamper-evident, not immutable, audit timeline wording", () => {
    const src = read("src/pages/admin/p5-governance/components/dialogs/HoldDialog.tsx");
    expect(src).toContain("tamper-evident audit timeline");
    expect(src).not.toContain("immutable audit timeline");
  });

  it("D-1: ProofDocumentsList describes hashes as captured-and-sealed, not part of a chain", () => {
    const src = read("src/components/match/ProofDocumentsList.tsx");
    expect(src).toContain(
      "Document hashes are captured at upload and included in the sealed evidence bundle."
    );
    expect(src).not.toContain("Document hashes are part of the tamper-evident evidence chain.");
  });

  it("neither file introduces banned trust phrases in rendered copy", () => {
    const files = [
      "src/pages/admin/p5-governance/components/dialogs/HoldDialog.tsx",
      "src/components/match/ProofDocumentsList.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      for (const phrase of BANNED_TRUST_PHRASES) {
        // "immutable" appears in BANNED_TRUST_PHRASES; confirm neither file uses it.
        expect(src.toLowerCase()).not.toContain(phrase.toLowerCase());
      }
    }
  });
});
