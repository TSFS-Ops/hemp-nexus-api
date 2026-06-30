/**
 * Billing navigation usability — guard that the in-app Billing entry points
 * route directly to /desk/billing (the canonical Trade Desk billing surface)
 * and that the primary navigation surfaces (Trade Desk sidebar, dashboard
 * sidebar, mobile profile sheet, token-balance widget) each expose a
 * user-friendly Billing link.
 *
 * Scope is navigation/usability only. The test does NOT touch PayFast /
 * Paystack / wallet / ledger logic.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const constants = readFileSync("src/lib/constants.ts", "utf8");
const appSidebar = readFileSync("src/components/AppSidebar.tsx", "utf8");
const deskSidebar = readFileSync("src/components/desk/DeskSidebar.tsx", "utf8");
const mobileNav = readFileSync("src/components/MobileBottomNav.tsx", "utf8");
const tokenBadge = readFileSync("src/components/TokenBalanceDisplay.tsx", "utf8");
const publicHeader = readFileSync("src/components/PublicHeader.tsx", "utf8");

describe("Billing navigation usability", () => {
  it("ROUTES.BILLING and ROUTES.DASHBOARD_BILLING resolve directly to /desk/billing", () => {
    expect(constants).toMatch(/BILLING:\s*['"]\/desk\/billing['"]/);
    expect(constants).toMatch(/DASHBOARD_BILLING:\s*['"]\/desk\/billing['"]/);
  });

  it("Trade Desk sidebar exposes a Billing item linking to /desk/billing", () => {
    expect(deskSidebar).toMatch(/to:\s*"\/desk\/billing"/);
    expect(deskSidebar).toMatch(/label:\s*"Billing"/);
  });

  it("Legacy AppSidebar exposes a Billing & Credits item via ROUTES.BILLING", () => {
    expect(appSidebar).toMatch(/ROUTES\.BILLING/);
    expect(appSidebar).toMatch(/Billing & Credits/);
  });

  it("Mobile profile sheet exposes a Billing & Credits link via ROUTES.DASHBOARD_BILLING", () => {
    expect(mobileNav).toMatch(/ROUTES\.DASHBOARD_BILLING/);
    expect(mobileNav).toMatch(/Billing & Credits/);
  });

  it("Token balance widget links to /desk/billing and offers Buy Credits", () => {
    expect(tokenBadge).toMatch(/to="\/desk\/billing"/);
    expect(tokenBadge).toMatch(/Buy Credits/);
    // Blocked-state CTA must also link to /desk/billing
    expect(tokenBadge).toMatch(/href="\/desk\/billing"/);
  });

  it("Public header does NOT expose Billing to logged-out visitors", () => {
    // Billing links must never appear for unauthenticated traffic in the
    // public top nav. The header only renders Dashboard/HQ for authed users.
    expect(publicHeader).not.toMatch(/Billing/);
    expect(publicHeader).not.toMatch(/\/desk\/billing/);
  });
});
