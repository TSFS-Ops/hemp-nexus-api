/**
 * Reusable assertions for role-negative + journey suites.
 *
 * Each helper is intentionally narrow so failure messages identify the
 * exact rule violated. All denial assertions REFUSE to pass if any
 * needle from `protected-data` leaks into rendered HTML or network
 * response bodies — guarding §8/§11 of the build brief.
 */
import { expect, type Page, type Response } from "@playwright/test";

/** Assert the current page renders without a 401/403 banner. */
export async function expectAllowed(page: Page, route: string): Promise<void> {
  const url = page.url();
  expect(url, `route ${route} should remain on protected URL after load`).not.toMatch(/\/auth(\?|$|#)/);
  const html = await page.content();
  expect(html, "page renders without 'Not authorised'").not.toMatch(/not\s+authorised|forbidden|access denied/i);
}

/** Assert the page rendered a safe 403/denied state — never protected content. */
export async function expectForbidden(page: Page, route: string): Promise<void> {
  const html = await page.content();
  const denied = /not\s+authorised|forbidden|access denied|403/i.test(html);
  const redirected = /\/auth(\?|$|#)|\/dashboard\?denied=1|\/desk\?denied=1/.test(page.url());
  expect(
    denied || redirected,
    `route ${route} should show denied state or redirect, got url=${page.url()}`,
  ).toBe(true);
}

/** Assert the URL ended up on /auth?returnTo=... (logged_out flow). */
export async function expectRedirectToLogin(page: Page, route: string): Promise<void> {
  await expect.poll(() => page.url(), { timeout: 10_000 }).toMatch(/\/auth(\?|$|#)/);
  const url = page.url();
  expect(url, `expected returnTo for ${route}`).toMatch(/returnTo=/);
}

/** Fail if any needle (record IDs, names, amounts, doc titles) appears in the rendered DOM. */
export async function expectNoProtectedDataVisible(page: Page, needles: string[]): Promise<void> {
  if (!needles.length) return;
  const html = (await page.content()).toLowerCase();
  for (const n of needles) {
    if (!n) continue;
    expect(html.includes(n.toLowerCase()), `protected datum "${n}" must not appear in DOM`).toBe(false);
  }
}

/** Same scan against the response-body buffer captured by the evidence fixture. */
export function expectNoProtectedDataInNetwork(buf: string[], needles: string[]): void {
  if (!needles.length) return;
  const haystack = buf.join("\n").toLowerCase();
  for (const n of needles) {
    if (!n) continue;
    expect(haystack.includes(n.toLowerCase()), `protected datum "${n}" must not appear in any network body`).toBe(false);
  }
}

/** Deep-equality before/after state check. */
export function expectNoMutation(before: unknown, after: unknown): void {
  expect(after, "record must be byte-identical before and after a denied action").toEqual(before);
}

/** Validate that an HTTP response is a safe denied response — no payload leakage. */
export async function expectSafeDeniedResponse(res: Response): Promise<void> {
  expect([401, 403, 404]).toContain(res.status());
  const text = await res.text().catch(() => "");
  // forbid keys, JWTs, sk_-prefixed secrets, stack traces in error bodies
  expect(text).not.toMatch(/sk_[A-Za-z0-9_-]{6,}/);
  expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./);
  expect(text).not.toMatch(/at\s+\w+\s+\(.+:\d+:\d+\)/);
}
