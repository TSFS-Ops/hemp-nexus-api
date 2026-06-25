/**
 * E2E: live public-domain homepage default landing.
 *
 * Locks the client-directed fix (David Davies, 2026-06-25):
 *   1. Visiting the public domain shows the homepage (NOT the workspace).
 *   2. Signing in from the public domain lands the user on `/` first.
 *   3. The signed-in homepage exposes a clear Dashboard / Trading Desk CTA
 *      that the user can click intentionally to enter the workspace.
 *
 * Skipped automatically unless SMOKE_BASE_URL plus a non-admin org login pair
 * are provided — matches the existing e2e gating convention.
 */
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.SMOKE_BASE_URL;
const EMAIL = process.env.SMOKE_ORG_EMAIL;
const PASSWORD = process.env.SMOKE_ORG_PASSWORD;

test.describe("public-domain default landing", () => {
  test.skip(
    !BASE_URL || !EMAIL || !PASSWORD,
    "Requires SMOKE_BASE_URL, SMOKE_ORG_EMAIL, SMOKE_ORG_PASSWORD",
  );

  test("homepage is the default, sign-in returns to /, and Dashboard CTA enters /desk", async ({ page }) => {
    // 1) Visiting the root serves the public homepage, not the workspace.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/(\?|$)/);
    // Negative assertion: we must NOT have been bounced to /desk or /dashboard.
    expect(page.url()).not.toMatch(/\/desk(\/|$|\?)/);
    expect(page.url()).not.toMatch(/\/dashboard(\/|$|\?)/);

    // 2) Trigger the public sign-in entry point.
    //    Landing's Log In CTA links to /auth?returnTo=/ — explicitly generic,
    //    must be ignored by the strict allow-list.
    await page.goto("/auth?returnTo=/", { waitUntil: "domcontentloaded" });
    await page.getByLabel(/email/i).fill(EMAIL!);
    await page.getByLabel(/password/i, { exact: false }).fill(PASSWORD!);
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    // 3) Wait for the post-auth navigation and assert we land on `/`.
    await page.waitForURL((url) => {
      const p = new URL(url).pathname;
      // Allow /welcome only for brand-new accounts; in all other cases the
      // trade-persona default is /.
      return p === "/" || p === "/welcome";
    }, { timeout: 20_000 });
    expect(page.url()).not.toMatch(/\/desk(\/|$|\?)/);

    // 4) Skip the dashboard-CTA assertion if we landed on the persona picker.
    if (new URL(page.url()).pathname === "/welcome") return;

    // 5) Authenticated homepage must surface a Dashboard / Trading Desk CTA.
    const cta = page.getByRole("link", { name: /dashboard|trading desk/i }).first();
    await expect(cta).toBeVisible();
    await cta.click();
    await page.waitForURL(/\/desk(\/|$|\?)/, { timeout: 20_000 });
  });
});
