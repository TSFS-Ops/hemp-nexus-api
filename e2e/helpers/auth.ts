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
 * Pass a base32 secret; we generate the current 6-digit code with
 * `otpauth` (peer-installed alongside @playwright/test). If `otpauth`
 * is not installed, this throws with a clear remediation message.
 */
export async function completeTotpIfPrompted(page: Page, secretBase32: string) {
  const challenge = page.locator('input[name="code"], input[autocomplete="one-time-code"]').first();
  if (!(await challenge.isVisible({ timeout: 5_000 }).catch(() => false))) return;
  let totp: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TOTP, Secret } = await import("otpauth");
    const code = new TOTP({ secret: Secret.fromBase32(secretBase32), digits: 6, period: 30 }).generate();
    totp = code;
  } catch {
    throw new Error("Install `otpauth` (npm i -D otpauth) to drive AAL2 row B.");
  }
  await challenge.fill(totp);
  await page.getByRole("button", { name: /verify|continue|submit/i }).first().click();
  await expect(challenge).not.toBeVisible({ timeout: 15_000 });
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}. See playwright.config.ts header.`);
  return v;
}
