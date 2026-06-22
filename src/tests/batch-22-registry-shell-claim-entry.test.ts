/**
 * Batch 22 — Registry shell + profile-level claim entry source pins.
 *
 * Source-pins the invariants required for the Trade Desk shell to wrap
 * every registry surface and for the company profile to host the
 * "Is this your company?" claim CTA pointing at the company-specific
 * claim route.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const desk = readFileSync("src/pages/Desk.tsx", "utf8");
const profile = readFileSync("src/pages/registry/CompanyProfile.tsx", "utf8");
const claim = readFileSync("src/pages/registry/Claim.tsx", "utf8");
const landing = readFileSync("src/pages/registry/Landing.tsx", "utf8");
const search = readFileSync("src/pages/registry/Search.tsx", "utf8");
const sidebar = readFileSync("src/components/desk/DeskSidebar.tsx", "utf8");

describe("Batch 22 — registry shell + profile-level claim entry", () => {
  // ── Shell: registry routes are inside the DeskLayout block ──────────
  it("DeskSidebar links Company Register at /desk/registry", () => {
    expect(sidebar).toMatch(/to:\s*"\/desk\/registry"/);
  });

  it("Desk.tsx mounts the registry sub-routes inside the DeskLayout block", () => {
    // The DeskLayout block is the path="*" wrapper. Every registry sub-route
    // must appear AFTER the opening <DeskLayout> tag and BEFORE its close.
    const open = desk.indexOf("<DeskLayout>");
    const close = desk.indexOf("</DeskLayout>");
    expect(open).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(open);

    const inside = desk.slice(open, close);
    const required = [
      'path="registry"',
      'path="registry/search"',
      'path="registry/new-company-request"',
      'path="registry/company/:id"',
      'path="registry/company/:id/claim"',
      'path="registry/my-companies"',
      'path="registry/my-companies/:companyId"',
      'path="registry/my-companies/:companyId/claim"',
      'path="registry/my-companies/:companyId/authority"',
      'path="registry/my-companies/:companyId/bank-details"',
      'path="registry/my-companies/:companyId/verification"',
      'path="registry/my-companies/:companyId/evidence"',
      'path="registry/my-companies/:companyId/corrections"',
      'path="registry/my-companies/:companyId/disputes"',
      'path="registry/my-companies/:companyId/revocations"',
    ];
    for (const r of required) {
      expect(inside).toContain(r);
    }
  });

  it("Desk.tsx does NOT route any registry sub-route through DeskFullBleed", () => {
    // DeskFullBleed strips the padded shell; registry surfaces must keep
    // the standard DeskLayout so the sidebar stays visible.
    const fullBleedRoutes = desk.match(/<DeskFullBleed>[\s\S]*?<\/DeskFullBleed>/g) ?? [];
    for (const block of fullBleedRoutes) {
      expect(block).not.toMatch(/registry/i);
    }
  });

  // ── Shell-aware links ───────────────────────────────────────────────
  it("Landing.tsx uses useRegistryBase for internal links", () => {
    expect(landing).toContain('from "@/lib/use-registry-base"');
    expect(landing).toMatch(/`\$\{base\}\/search`/);
    expect(landing).toMatch(/`\$\{base\}\/my-companies`/);
  });

  it("Search.tsx uses base/rebase for new-company, profile and claim links", () => {
    expect(search).toContain('from "@/lib/use-registry-base"');
    expect(search).toMatch(/`\$\{base\}\/new-company-request`/);
    expect(search).toMatch(/rebaseRegistryPath\(r\.profile_link, base\)/);
    expect(search).toMatch(/`\$\{base\}\/company\/\$\{r\.id\}\/claim`/);
  });

  it("CompanyProfile.tsx uses base for the claim CTA route", () => {
    expect(profile).toContain('from "@/lib/use-registry-base"');
    expect(profile).toMatch(/`\$\{base\}\/company\/\$\{r\.id\}\/claim`/);
  });

  // ── Profile-level "Is this your company?" panel ─────────────────────
  it("CompanyProfile.tsx renders the 'Is this your company?' claim panel", () => {
    expect(profile).toContain('data-testid="profile-claim-panel"');
    expect(profile).toContain("Is this your company?");
    // Required limited wording — must NOT imply verification.
    expect(profile).toContain(
      "Claim approval confirms only\n            that your connection has passed review",
    );
    expect(profile).toContain(
      "It does not verify the company profile,\n            grant authority-to-act or verify bank details",
    );
    // Primary CTA label.
    expect(profile).toContain(">\n                Claim this company\n              </Link>");
  });

  it("CompanyProfile.tsx shows the sample-only warning for imported_unverified records", () => {
    expect(profile).toContain('data-testid="profile-claim-sample-warning"');
    expect(profile).toContain(
      "This is a sample record for workflow testing. It is not independently confirmed by Izenzo.",
    );
  });

  it("CompanyProfile.tsx never references raw bank or personal contact fields", () => {
    expect(profile).not.toMatch(/bank_account_number|raw_bank_details|personal_email|personal_phone|residential_address/i);
  });

  // ── Claim entry page — selected company + evidence explanation ──────
  it("Claim.tsx renders the selected-company card", () => {
    expect(claim).toContain('data-testid="claim-selected-company-card"');
    expect(claim).toContain("Source-backed record. Not independently confirmed by Izenzo.");
  });

  it("Claim.tsx explains the evidence requirement with limited wording", () => {
    expect(claim).toContain('data-testid="claim-evidence-explanation"');
    expect(claim).toContain(
      "To review your claim, Izenzo needs evidence showing your connection to this company.",
    );
    expect(claim).toMatch(/does not verify the\s*\n?\s*company profile, grant authority-to-act or verify bank details/);
  });
});
