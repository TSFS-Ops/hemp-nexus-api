/**
 * Paystack provider façade — Phase 1 (PayFast-readiness scaffolding).
 *
 * This module is a THIN, BEHAVIOUR-PRESERVING wrapper around the
 * existing Paystack logic that lives inline in
 * `supabase/functions/token-purchase/index.ts`.
 *
 * Why a façade and not a refactor?
 * ────────────────────────────────
 * The Phase 1 contract is: do not change Paystack runtime behaviour.
 * `token-purchase/index.ts` is the source of truth today (initiation,
 * verify, webhook signature verification, ledger writes via
 * `atomic_paid_credit_purchase`, idempotency, reconciliation hooks).
 * Lifting that 2.7k-line file into a shared module in one go would
 * be a behaviour-change risk, not a behaviour-preservation. So in
 * Phase 1 we:
 *
 *   1. Capture the Paystack provider IDENTITY (id, currency, label,
 *      reference-column) in a single shared place.
 *   2. Expose a pure HMAC-SHA512 signature verifier that mirrors the
 *      one used inline in `token-purchase/index.ts` and
 *      `paystack-webhook/index.ts`, so future tests / providers can
 *      assert on it without re-implementing it.
 *   3. Leave initiation / verify / webhook dispatch untouched in
 *      `token-purchase/index.ts`.
 *
 * Phase 2 (PayFast sandbox) is allowed to lift more inline Paystack
 * code into this file IF AND ONLY IF the lift is byte-for-byte
 * behaviour-preserving and covered by a regression test.
 */
import type { PaymentProvider } from "./provider.ts";

/**
 * Paystack provider descriptor. `liveEnabled: true` — Paystack remains
 * the only customer-facing provider in Phase 1.
 */
export const PAYSTACK_PROVIDER: PaymentProvider = {
  id: "paystack",
  label: "Paystack",
  currency: "USD",
  liveEnabled: true,
  // Historical column. MUST NOT be dropped — every paid customer
  // since 2024 has a row keyed by this column.
  referenceColumn: "paystack_reference",
};

/**
 * Reads the Paystack secret key from the runtime. Mirrors the inline
 * `Deno.env.get("PAYSTACK_SECRET_KEY")?.trim()` used in
 * `token-purchase/index.ts` and `paystack-webhook/index.ts`.
 *
 * Phase 1: this helper is exported for tests and Phase 2 wiring but
 * is NOT yet called from the live request path — the inline lookups
 * remain authoritative until they are migrated under regression test.
 */
export function readPaystackSecret(): string | undefined {
  // Deno env access guarded so this module is import-safe under
  // Vitest (Node) where `Deno` is not defined.
  const env = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  return env?.get("PAYSTACK_SECRET_KEY")?.trim();
}

/**
 * Pure HMAC-SHA512 verifier for Paystack webhook bodies. Same algorithm
 * as the inline verifiers in `token-purchase/index.ts` (handleWebhook)
 * and `paystack-webhook/index.ts`. Provided here so future tests and
 * the PayFast provider's analogous helper have a known shape to follow.
 *
 * Phase 1: NOT called from the live webhook path. The inline verifiers
 * remain authoritative — this helper is purely additive.
 *
 * @param body Raw request body bytes as Paystack signed them.
 * @param signature Hex-encoded signature from `x-paystack-signature`.
 * @param secret Paystack secret key (sk_test_* or sk_live_*).
 * @returns true iff the computed HMAC matches `signature`.
 */
export async function verifyPaystackSignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!body || !signature || !secret) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Constant-time-ish compare. Length check first guards against
  // short-circuit timing leaks on obviously-wrong lengths.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
