/**
 * Shared auth helpers for Smoke A–D. Drives the real /auth UI so the
 * Supabase session lands in localStorage exactly as a user's browser
 * would, which is required for the hard-refresh persistence assertions
 * in rows B and C.
 */
import { Page, expect } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function envValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).replace(/^['"]|['"]$/g, "");
  } catch {
    return undefined;
  }
}

function smokeClient() {
  const url = envValue("SUPABASE_URL") ?? envValue("VITE_SUPABASE_URL");
  const key = envValue("SUPABASE_ANON_KEY") ?? envValue("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) throw new Error("Missing backend URL or publishable key for smoke auth.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function storageKey(): string {
  const url = envValue("SUPABASE_URL") ?? envValue("VITE_SUPABASE_URL");
  if (!url) throw new Error("Missing backend URL for smoke auth storage.");
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

async function installSession(page: Page, session: Session) {
  await page.goto("/");
  await page.evaluate(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [storageKey(), JSON.stringify(session)],
  );
}

export async function signIn(page: Page, email: string, password: string) {
  const { data, error } = await smokeClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Smoke sign-in failed for ${email}: ${error?.message ?? "no session"}`);
  await installSession(page, data.session);
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
  const { generateTotp } = await import("./totp");
  const raw = await page.evaluate((key) => localStorage.getItem(key), storageKey());
  if (!raw) throw new Error("Missing smoke session for TOTP step-up.");
  const session = JSON.parse(raw) as Session;
  const client = smokeClient();
  await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  const { data: factors, error: factorsError } = await client.auth.mfa.listFactors();
  if (factorsError) throw new Error(`Smoke TOTP factor lookup failed: ${factorsError.message}`);
  const factorId = factors.totp[0]?.id;
  if (!factorId) return;
  const code = await generateTotp(secretEnvVar);
  const { data, error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
  if (error || !data) throw new Error(`Smoke TOTP step-up failed: ${error?.message ?? "no session"}`);
  await installSession(page, data as Session);
  await expect.poll(async () => {
    const { data: aal } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    return aal?.currentLevel;
  }).toBe("aal2");
}


export function requireEnv(name: string): string {
  const v = process.env[name] ?? envValue(name);
  if (!v) throw new Error(`Missing env ${name}. See playwright.config.ts header.`);
  return v;
}

