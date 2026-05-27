/**
 * Playwright config for Daniel retest pack — Smoke A–D.
 *
 * Targets either a local `npm run dev` or the deployed preview URL.
 * Browsers are NOT installed by default; run once:
 *
 *   npx playwright install chromium
 *
 * Then provide credentials via env (see e2e/smoke-a-d.spec.ts) and:
 *
 *   npx playwright test
 *
 * Required env:
 *   SMOKE_BASE_URL                — e.g. https://id-preview--<id>.lovable.app
 *   SMOKE_ADMIN_EMAIL             — platform_admin without TOTP (A)
 *   SMOKE_ADMIN_PASSWORD
 *   SMOKE_ADMIN_AAL2_EMAIL        — platform_admin with TOTP enrolled (B)
 *   SMOKE_ADMIN_AAL2_PASSWORD
 *   SMOKE_ADMIN_AAL2_TOTP_SECRET  — base32 TOTP secret (B); run requires `otpauth` pkg
 *   SMOKE_ORG_EMAIL               — org account with completed purchase (C, D)
 *   SMOKE_ORG_PASSWORD
 *   SMOKE_LEGAL_HOLD_SCOPE_ID     — UUID to apply hold to (B)
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
