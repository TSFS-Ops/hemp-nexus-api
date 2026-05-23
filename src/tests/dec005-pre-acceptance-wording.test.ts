/**
 * DEC-005 — Pre-acceptance wording helper and signed-constant tests.
 */
import { describe, it, expect } from "vitest";
import {
  PENDING_ENGAGEMENT_LABEL,
  INITIATOR_PENDING_COPY,
  OUTREACH_INVITATION_COPY,
  UNSAFE_PRE_ACCEPTANCE_WARNING,
  assertPreAcceptanceSafe,
} from "@/lib/legal/pre-acceptance-wording";
import { findForbiddenTerms, FORBIDDEN_PRE_ACCEPTANCE_TERMS } from "@/lib/legal/forbidden-terms";
import { readFileSync } from "node:fs";

describe("DEC-005 — signed wording constants", () => {
  it("exposes the signed Pending Engagement label verbatim", () => {
    expect(PENDING_ENGAGEMENT_LABEL).toBe(
      "Pending Engagement — counterparty invited, awaiting confirmation.",
    );
  });
  it("exposes the signed initiator copy verbatim", () => {
    expect(INITIATOR_PENDING_COPY).toBe(
      "Counterparty invitation sent. This trade remains pending until the counterparty confirms participation.",
    );
  });
  it("exposes the signed outreach invitation copy verbatim", () => {
    expect(OUTREACH_INVITATION_COPY).toContain("You have been invited to review a proposed trade on Izenzo.");
    expect(OUTREACH_INVITATION_COPY).toContain("This invitation does not confirm your acceptance.");
  });
});

describe("DEC-005 — assertPreAcceptanceSafe", () => {
  it("passes safe wording", () => {
    expect(assertPreAcceptanceSafe("This trade is pending counterparty confirmation.").ok).toBe(true);
  });
  it.each(FORBIDDEN_PRE_ACCEPTANCE_TERMS)("blocks forbidden term %s", (term) => {
    const result = assertPreAcceptanceSafe(`The deal is ${term} now.`);
    expect(result.ok).toBe(false);
    expect(result.warning).toBe(UNSAFE_PRE_ACCEPTANCE_WARNING);
    expect(result.blockedTerms.map((t) => t.toLowerCase())).toContain(term.toLowerCase());
  });
  it("does NOT flag substring-of-larger-word matches (e.g. 'completely' contains 'complete')", () => {
    expect(findForbiddenTerms("processed completely correctly")).toEqual([]);
  });
});

describe("DEC-005 — Pending Engagement banner uses signed copy", () => {
  it("DealWizard renders the signed Pending Engagement title", () => {
    const src = readFileSync("src/components/match/wizard/DealWizard.tsx", "utf8");
    expect(src).toContain("Pending Engagement — counterparty invited, awaiting confirmation.");
    expect(src).not.toContain("Pending Engagement — outreach in progress");
  });
  it("StateProgressionCard renders the signed Pending Engagement CTA label", () => {
    const src = readFileSync("src/components/match/StateProgressionCard.tsx", "utf8");
    expect(src).toContain("Pending Engagement — counterparty invited, awaiting confirmation.");
  });
});

describe("DEC-005 — outreach email does not say verified counterparty / verified intent", () => {
  const src = readFileSync(
    "supabase/functions/_shared/transactional-email-templates/outreach-intent-to-trade.tsx",
    "utf8",
  );
  it("does not use 'verified counterparty'", () => {
    expect(src.toLowerCase()).not.toContain("verified counterparty");
  });
  it("does not use 'verified intent'", () => {
    expect(src.toLowerCase()).not.toContain("verified intent");
  });
  it("contains the signed invitation sentence", () => {
    expect(src).toContain("This invitation does not confirm your acceptance.");
  });
});
