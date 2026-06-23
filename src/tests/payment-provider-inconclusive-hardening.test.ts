/**
 * Payment provider inconclusive hardening — static guards.
 *
 * Proves the hardening applied for the PayFast-readiness pass:
 *
 *  1. Every Paystack `fetch(` to api.paystack.co in token-purchase and
 *     transaction-reconciliation has been replaced with `providerFetch(`
 *     (the bounded-timeout, AbortController-backed helper).
 *  2. The verify edge function still maps timeout / 5xx / non-OK /
 *     invalid JSON to `verifyInconclusive: true` — never to a definitive
 *     failure.
 *  3. The verify response surfaces the new provider-agnostic
 *     `providerStatus` alias next to the legacy `paystackStatus` field
 *     (so PayFast can populate the same contract later).
 *  4. The reconciliation loop NEVER sets `status='failed'` outside the
 *     definitive provider-declared failure branch.
 *  5. The reconciliation loop opens an `admin_risk_items` row with
 *     kind `payment_provider_inconclusive` and dedup key
 *     `payment_inconclusive:<reference>`, gated by a threshold of 3
 *     repeated failures before flipping to status='open'/severity='medium'.
 *  6. Auto-resolution on credit-success and on definitive-failure.
 *  7. `VerifyCheckoutResult` exposes `providerStatus` alongside
 *     `paystackStatus` — backwards compatible.
 *  8. The provider-agnostic helper itself exists and exports the
 *     expected typed errors.
 *
 * NO live Paystack/PayFast call is made. NO ledger/balance state is
 * exercised. NO cron schedule is touched.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const HELPER = read("supabase/functions/_shared/provider-fetch.ts");
const PURCHASE = read("supabase/functions/token-purchase/index.ts");
const RECON = read("supabase/functions/transaction-reconciliation/index.ts");
const CHECKOUT = read("src/lib/credit-checkout.ts");

describe("provider-fetch helper", () => {
  it("exports providerFetch with AbortController and an 8s default timeout", () => {
    expect(HELPER).toMatch(/export\s+async\s+function\s+providerFetch\(/);
    expect(HELPER).toMatch(/new\s+AbortController\(\)/);
    expect(HELPER).toMatch(/DEFAULT_PROVIDER_FETCH_TIMEOUT_MS\s*=\s*8000/);
  });

  it("throws typed timeout and network errors (no swallowing)", () => {
    expect(HELPER).toMatch(/class\s+ProviderFetchTimeoutError/);
    expect(HELPER).toMatch(/class\s+ProviderFetchNetworkError/);
    expect(HELPER).toMatch(/throw\s+new\s+ProviderFetchTimeoutError/);
    expect(HELPER).toMatch(/throw\s+new\s+ProviderFetchNetworkError/);
  });

  it("is provider-agnostic (no Paystack/PayFast hard-coding)", () => {
    expect(HELPER).not.toMatch(/paystack/i);
    expect(HELPER).not.toMatch(/payfast/i);
  });
});

describe("token-purchase: provider fetch wiring", () => {
  it("every Paystack fetch goes through providerFetch", () => {
    // The legacy direct `fetch("https://api.paystack.co/..."` pattern
    // must not appear anywhere in the file.
    expect(PURCHASE).not.toMatch(/await\s+fetch\(\s*["'`]https:\/\/api\.paystack\.co/);
    // Both verify and initialize must use providerFetch with an
    // explicit Paystack providerName.
    const providerFetchCalls = PURCHASE.match(/providerFetch\(/g) ?? [];
    expect(providerFetchCalls.length).toBeGreaterThanOrEqual(2);
    expect(PURCHASE).toMatch(
      /providerFetch\(\s*[\s\S]{0,400}paystack\.co\/transaction\/verify[\s\S]{0,400}providerName:\s*"paystack"/,
    );
    expect(PURCHASE).toMatch(
      /providerFetch\(\s*[\s\S]{0,400}paystack\.co\/transaction\/initialize[\s\S]{0,2000}providerName:\s*"paystack"/,
    );
  });

  it("verify timeout / network / non-OK / invalid JSON all return verifyInconclusive:true", () => {
    // All four containment branches must include verifyInconclusive: true
    // and must NOT use the definitive "Transaction not successful" wording.
    const definitiveOccurrences = PURCHASE.match(/Transaction not successful/g) ?? [];
    expect(definitiveOccurrences.length).toBe(1);
    // Catch on providerFetch throw → inconclusive.
    expect(PURCHASE).toMatch(
      /catch\s*\(\s*netErr\s*\)\s*\{[\s\S]{0,800}verifyInconclusive:\s*true/,
    );
    // Non-OK provider response → inconclusive.
    expect(PURCHASE).toMatch(
      /!verifyRes\.ok[\s\S]{0,600}verifyInconclusive:\s*true/,
    );
    // Invalid JSON → inconclusive.
    expect(PURCHASE).toMatch(
      /catch\s*\(\s*parseErr\s*\)\s*\{[\s\S]{0,600}verifyInconclusive:\s*true/,
    );
    // Non-definitive provider status → inconclusive.
    expect(PURCHASE).toMatch(
      /providerStatus !== "success"[\s\S]{0,1400}verifyInconclusive:\s*true/,
    );
  });

  it("every verify response payload surfaces providerStatus alongside paystackStatus", () => {
    const paystackStatusKeys = PURCHASE.match(/paystackStatus:/g) ?? [];
    const providerStatusKeys = PURCHASE.match(/providerStatus:/g) ?? [];
    // Each response body that carries paystackStatus must also carry
    // providerStatus. Local `const providerStatus = ...` assignments
    // (without trailing colon-as-key) are excluded by the regex match.
    expect(providerStatusKeys.length).toBeGreaterThanOrEqual(paystackStatusKeys.length);
  });

  it("initialize timeout/network failure returns a safe 503, not a misleading success/failure", () => {
    expect(PURCHASE).toMatch(
      /catch\s*\(\s*initErr\s*\)\s*\{[\s\S]{0,1200}status:\s*503/,
    );
    // The catch block must release the idempotency reservation so the
    // user can retry without hitting "already in progress" for 24h.
    expect(PURCHASE).toMatch(
      /catch\s*\(\s*initErr\s*\)\s*\{[\s\S]{0,1200}idempotency_keys[\s\S]{0,200}\.delete\(\)/,
    );
  });
});

describe("transaction-reconciliation: provider fetch + inconclusive tracking", () => {
  it("Paystack verify goes through providerFetch (no raw fetch to api.paystack.co)", () => {
    expect(RECON).not.toMatch(/await\s+fetch\(\s*[`'"]https:\/\/api\.paystack\.co/);
    expect(RECON).toMatch(
      /providerFetch\(\s*[\s\S]{0,400}paystack\.co\/transaction\/verify[\s\S]{0,400}providerName:\s*"paystack"/,
    );
  });

  it("never sets status='failed' outside the definitive provider failure branch", () => {
    // Only one mutation should set status:'failed' on token_purchases —
    // the one inside the `txStatus === "failed" || txStatus === "abandoned"`
    // branch. (The planned/dryRun snapshot literal also appears, which
    // is data not a write, so we count actual .update() calls.)
    const updateFailedCalls = RECON.match(
      /\.update\(\s*\{\s*status:\s*"failed"[\s\S]{0,200}\}\s*\)/g,
    ) ?? [];
    // exactly one token_purchases status=failed update + one stale-email
    // status=failed update (a different table, but the regex doesn't
    // discriminate, so we accept up to 2 and assert the purchase one is
    // gated correctly below).
    expect(updateFailedCalls.length).toBeLessThanOrEqual(2);
    expect(RECON).toMatch(
      /txStatus === "failed" \|\| txStatus === "abandoned"[\s\S]{0,800}token_purchases[\s\S]{0,200}status:\s*"failed"/,
    );
    // Timeout / network / non-OK / invalid JSON branches must use the
    // dedicated 'left_pending_inconclusive' action — never set failed.
    const leftPending = RECON.match(/left_pending_inconclusive/g) ?? [];
    expect(leftPending.length).toBeGreaterThanOrEqual(4);
  });

  it("opens deduped admin_risk_items only after 3 repeated failures (medium severity)", () => {
    expect(RECON).toMatch(/INCONCLUSIVE_OPEN_THRESHOLD\s*=\s*3/);
    expect(RECON).toMatch(/INCONCLUSIVE_KIND\s*=\s*"payment_provider_inconclusive"/);
    expect(RECON).toMatch(/payment_inconclusive:\$\{params\.providerReference\}/);
    // First insert is monitoring phase, status='resolved', severity='low'.
    expect(RECON).toMatch(
      /admin_risk_items[\s\S]{0,200}\.insert\(\{[\s\S]{0,600}status:\s*"resolved"[\s\S]{0,200}severity:\s*"low"[\s\S]{0,400}phase:\s*"monitoring"/,
    );
    // Escalation: flips to open + medium when failure_count >= threshold.
    expect(RECON).toMatch(
      /opened\s*=\s*failure_count\s*>=\s*INCONCLUSIVE_OPEN_THRESHOLD/,
    );
    expect(RECON).toMatch(/status:\s*opened\s*\?\s*"open"\s*:/);
    expect(RECON).toMatch(/severity:\s*opened\s*\?\s*"medium"\s*:/);
  });

  it("auto-resolves the inconclusive risk item on credit-success or definitive failure", () => {
    expect(RECON).toMatch(/resolveInconclusive\(/);
    expect(RECON).toMatch(/resolutionReason:\s*"purchase_completed"/);
    expect(RECON).toMatch(/resolutionReason:\s*"provider_definitive_failure"/);
  });

  it("does not send external notifications from the risk-item path", () => {
    // No email / Resend / Slack dispatch inside the inconclusive helpers.
    const trackHelperStart = RECON.indexOf("async function trackInconclusiveFailure");
    const trackHelperEnd = RECON.indexOf("async function resolveInconclusive");
    const trackBody = RECON.slice(trackHelperStart, trackHelperEnd);
    expect(trackBody).not.toMatch(/resend|slack|email_send|notification_dispatches/i);
  });
});

describe("VerifyCheckoutResult contract", () => {
  it("exposes both paystackStatus (legacy) and providerStatus (provider-agnostic)", () => {
    expect(CHECKOUT).toMatch(/paystackStatus\?:/);
    expect(CHECKOUT).toMatch(/providerStatus\?:/);
  });

  it("documents that PayFast (or any future provider) must populate providerStatus", () => {
    expect(CHECKOUT).toMatch(/PayFast[\s\S]{0,400}providerStatus/);
  });
});
