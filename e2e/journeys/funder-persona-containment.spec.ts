/**
 * Funder Persona Containment — end-to-end.
 *
 * Client policy: an authenticated funder-only user MUST remain inside
 * /funder/* (plus a small allow-list). Every other route — including
 * marketing, Trade Desk, admin, docs, legal, and unknown paths — must
 * redirect to /funder/workspace with no protected shell flash.
 *
 * Mirrors the pure decision rule in
 * src/lib/funder-workspace/persona-containment.ts.
 *
 * Requires a funder-only credential pair:
 *   FUNDER_ONLY_EMAIL, FUNDER_ONLY_PASSWORD
 * Test is skipped when either is absent so CI stays green in envs that
 * have not yet provisioned the pilot funder account.
 */
import { test, expect, type Page } from "@playwright/test";
import { signIn } from "../helpers/auth";

const EMAIL = process.env.FUNDER_ONLY_EMAIL;
const PASSWORD = process.env.FUNDER_ONLY_PASSWORD;

const DISALLOWED_ROUTES: string[] = [
  // Root marketing
  "/",
  // Trade desk shells
  "/desk",
  "/desk/matches",
  "/dashboard",
  // Admin / HQ / governance
  "/admin",
  "/hq/compliance/queue",
  "/governance",
  "/compliance",
  // Registry / marketplace / discovery
  "/registry",
  "/marketplace",
  "/discovery",
  "/matches",
  // Developer / docs / support / billing
  "/developer",
  "/developers",
  "/docs",
  "/support",
  "/billing",
  "/welcome",
  "/trade",
  // Unknown paths (default-deny should catch these too)
  "/does-not-exist",
  "/random/nested/unknown/path",
  "/hq/unknown",
  "/admin/nope",
];

const ALLOWED_ROUTES: string[] = [
  "/funder/workspace",
  "/status",
];

async function assertContained(page: Page, from: string): Promise<void> {
  await page.goto(from, { waitUntil: "domcontentloaded" });
  // Final URL must land on /funder/workspace (or remain inside /funder/*).
  await expect
    .poll(() => new URL(page.url()).pathname, {
      timeout: 10_000,
      message: `funder-only user should be redirected to /funder/workspace from ${from}`,
    })
    .toMatch(/^\/funder(\/|$)/);

  // Protected-shell content must not be visible.
  const html = (await page.content()).toLowerCase();
  expect(html, `Trade Desk chrome must not render for funder-only user (from ${from})`)
    .not.toMatch(/trade desk|admin console|governance hq|hq compliance/);
}

test.describe("funder persona containment", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, "FUNDER_ONLY_EMAIL / FUNDER_ONLY_PASSWORD not provided");
    await signIn(page, EMAIL!, PASSWORD!);
  });

  for (const route of DISALLOWED_ROUTES) {
    test(`redirects ${route} → /funder/workspace`, async ({ page }) => {
      await assertContained(page, route);
    });
  }

  for (const route of ALLOWED_ROUTES) {
    test(`allows ${route}`, async ({ page }) => {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      const pathname = new URL(page.url()).pathname;
      if (route.startsWith("/funder")) {
        expect(pathname).toMatch(/^\/funder(\/|$)/);
      } else {
        // /status is public and does not force a redirect.
        expect(pathname).toBe(route);
      }
    });
  }

  test("hard refresh on disallowed route stays contained", async ({ page }) => {
    await page.goto("/desk", { waitUntil: "domcontentloaded" });
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
      .toMatch(/^\/funder(\/|$)/);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
      .toMatch(/^\/funder(\/|$)/);
  });

  test("no protected-shell flash before redirect", async ({ page }) => {
    // Navigate and immediately snapshot the first paint. The containment
    // component renders a neutral placeholder (data-testid) while signals
    // resolve — never the Trade Desk shell.
    const nav = page.goto("/desk", { waitUntil: "commit" });
    await nav;
    const early = (await page.content()).toLowerCase();
    expect(early).not.toMatch(/trade desk|start a new match|create match/);
  });
});
