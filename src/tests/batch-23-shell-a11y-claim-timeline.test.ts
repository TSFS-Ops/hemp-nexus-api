/**
 * Batch 23 — Trade Desk shell accessibility + claim status timeline pins.
 *
 * Source-pins keyboard/ARIA invariants for the Trade Desk sidebar that wraps
 * every /desk/registry/* page, and confirms the new claim status timeline
 * uses only the limited, safe wording exported from the claim workflow lib.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const sidebar = readFileSync("src/components/desk/DeskSidebar.tsx", "utf8");
const mobileNav = readFileSync("src/components/desk/MobileBottomNav.tsx", "utf8");
const timeline = readFileSync(
  "src/components/registry/ClaimStatusTimeline.tsx",
  "utf8",
);
const claimStatus = readFileSync(
  "src/pages/registry/ClaimStatus.tsx",
  "utf8",
);
const workflow = readFileSync(
  "src/lib/registry-claim-workflow.ts",
  "utf8",
);

describe("Batch 23 — Trade Desk sidebar a11y", () => {
  it("sidebar <aside> exposes an accessible label", () => {
    expect(sidebar).toMatch(/aria-label="Trade Desk sidebar"/);
  });

  it("sidebar <nav> exposes an accessible label", () => {
    expect(sidebar).toMatch(/aria-label="Trade Desk primary navigation"/);
  });

  it("sidebar NavLink has visible keyboard focus ring", () => {
    expect(sidebar).toMatch(/focus-visible:ring-2/);
    expect(sidebar).toMatch(/focus-visible:ring-ring/);
  });

  it("sidebar uses react-router NavLink so aria-current=page is set on active route", () => {
    // NavLink from react-router-dom emits aria-current="page" automatically.
    expect(sidebar).toMatch(/import\s*\{[^}]*NavLink[^}]*\}\s*from\s*"react-router-dom"/);
  });

  it("mobile bottom nav has aria-label and aria-current on items", () => {
    expect(mobileNav).toMatch(/aria-label="Desk primary"/);
    expect(mobileNav).toMatch(/aria-current=\{active \? "page" : undefined\}/);
  });

  it("icon-only mobile menu button has an aria-label", () => {
    expect(mobileNav).toMatch(/aria-label="More menu"/);
  });
});

describe("Batch 23 — claim status timeline", () => {
  it("ClaimStatus page renders the timeline component", () => {
    expect(claimStatus).toMatch(/ClaimStatusTimeline/);
    expect(claimStatus).toMatch(/status=\{c\.workflow_status\}/);
  });

  it("timeline is an ordered list with an accessible label", () => {
    expect(timeline).toMatch(/<ol[\s\S]*aria-label="Claim review timeline"/);
  });

  it("timeline marks the active stage with aria-current=step", () => {
    expect(timeline).toMatch(/aria-current=\{state === "current" \? "step" : undefined\}/);
  });

  it("timeline uses the canonical non-verification disclosure wording", () => {
    expect(timeline).toMatch(/REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_DISCLOSURE/);
    // The disclosure must exist in the workflow module.
    expect(workflow).toMatch(/REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_DISCLOSURE\s*=/);
  });

  it("timeline never uses unsafe verification wording", () => {
    // Strings that would over-promise to a claimant.
    const forbidden = [
      /\bverified company\b/i,
      /\bidentity verified\b/i,
      /\bownership confirmed\b/i,
      /\bguaranteed\b/i,
    ];
    for (const re of forbidden) {
      expect(timeline).not.toMatch(re);
    }
  });

  it("timeline folds admin-only statuses into the public 'Under review' stage", () => {
    // These admin-only statuses must not appear as their own user-facing
    // stage labels — they must be matched into 'under_review'.
    expect(timeline).toMatch(/"more_evidence_requested"/);
    expect(timeline).toMatch(/"claim_conflict_detected"/);
    expect(timeline).toMatch(/"escalated"/);
    // And there must be exactly three public stages.
    const stageMatches = timeline.match(/key:\s*"(submitted|under_review|decision)"/g) ?? [];
    expect(stageMatches.length).toBe(3);
  });
});
