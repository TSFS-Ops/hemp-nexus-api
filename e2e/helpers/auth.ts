/**
 * Shared auth helpers for Smoke A–D. Drives the real /auth UI so the
 * Supabase session lands in localStorage exactly as a user's browser
 * would, which is required for the hard-refresh persistence assertions
 * in rows B and C.
 */
import { Page, expect } from "@playwright/test";

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth");
  // Field selectors are intentionally loose — the auth page may iterate
  // copy. We anchor on input type instead of brittle text.
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30_000 }),
    page.getByRole("button", { name: /sign in|log in/i }).first().click(),
  ]);
}

export async function signOut(page: Page) {
  // Best-effort: clear storage and reload to /auth.
  await page.context().clearCookies();
  await page.evaluate(() => {
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* noop */ }
  });
}

/**
 * Completes a TOTP challenge if the AAL2 prompt is shown after sign-in.
 *
 * The secret is read from an env var *name* (never passed as a literal
 * through call sites) and routed through e2e/helpers/totp.ts, which
 * enforces:
 *   - SMOKE_ENV ∈ {staging, test} (refuses otherwise)
 *   - no logging of the secret or generated code
 *
 * The generated code is filled directly into the DOM input and never
 * surfaced to stdout, traces, or error messages.
 */
export async function completeTotpIfPrompted(page: Page, secretEnvVar: string) {
  const challenge = page.locator('input[name="code"], input[autocomplete="one-time-code"]').first();
  if (!(await challenge.isVisible({ timeout: 5_000 }).catch(() => false))) return;
  const { generateTotp } = await import("./totp");
  const code = await generateTotp(secretEnvVar);
  await challenge.fill(code);
  await page.getByRole("button", { name: /verify|continue|submit/i }).first().click();
  await expect(challenge).not.toBeVisible({ timeout: 15_000 });
}


export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}. See playwright.config.ts header.`);
  return v;
}
