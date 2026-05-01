/**
 * token-purchase-billing-availability-source.test.ts
 *
 * Source-level contract test for the server-side billing availability
 * guard inside `supabase/functions/token-purchase/index.ts`.
 *
 * We deliberately don't spin up the Deno runtime here — the goal is a
 * fast, deterministic guarantee that:
 *
 *   1. The POST /token-purchase handler calls
 *      `supabase.rpc("get_billing_availability")` BEFORE it ever
 *      reserves an idempotency key, calls Paystack, or writes a
 *      `credits.purchase_initiated` audit row.
 *   2. When the flag is disabled, the function short-circuits with
 *      HTTP 503 and the canonical `BILLING_UNAVAILABLE` error code.
 *   3. The verify and webhook code paths are NOT gated by this flag
 *      (so historical reconciliation keeps working).
 *   4. No legacy ZAR/FX logic has crept back into the file.
 *
 * If any future refactor moves the Paystack call above the guard, or
 * silently downgrades the 503/BILLING_UNAVAILABLE contract, this test
 * fails before the change can ship.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(__dirname, "../../supabase/functions/token-purchase/index.ts"),
  "utf8",
);

describe("token-purchase server-side billing availability guard", () => {
  it("calls get_billing_availability inside the POST handler", () => {
    expect(SOURCE).toContain('supabase.rpc("get_billing_availability")');
  });

  it("returns 503 + BILLING_UNAVAILABLE when the flag is disabled", () => {
    // Both literals must appear inside the same guard block.
    expect(SOURCE).toMatch(/BILLING_UNAVAILABLE/);
    // The canonical block returns status: 503.
    const guardBlock = SOURCE.split('supabase.rpc("get_billing_availability")')[1] ?? "";
    expect(guardBlock).toMatch(/status:\s*503/);
    expect(guardBlock).toMatch(/BILLING_UNAVAILABLE/);
  });

  it("runs the guard BEFORE reserving any idempotency key or calling Paystack", () => {
    const guardIdx = SOURCE.indexOf('supabase.rpc("get_billing_availability")');
    const idempotencyIdx = SOURCE.indexOf('.from("idempotency_keys")');
    const paystackIdx = SOURCE.indexOf("https://api.paystack.co/transaction/initialize");
    const auditInitIdx = SOURCE.indexOf('"credits.purchase_initiated"');

    expect(guardIdx).toBeGreaterThan(0);
    expect(idempotencyIdx).toBeGreaterThan(0);
    expect(paystackIdx).toBeGreaterThan(0);
    expect(auditInitIdx).toBeGreaterThan(0);

    expect(guardIdx).toBeLessThan(idempotencyIdx);
    expect(guardIdx).toBeLessThan(paystackIdx);
    expect(guardIdx).toBeLessThan(auditInitIdx);
  });

  it("does not gate the verify or webhook paths on the availability flag", () => {
    // Find the `if (isWebhook)` and `path === "verify"` blocks and
    // confirm they don't reference the availability RPC. The guard must
    // live strictly inside the checkout-init branch so historical
    // reconciliation continues to work while billing is paused.
    const webhookFnIdx = SOURCE.indexOf("async function handleWebhook");
    expect(webhookFnIdx).toBeGreaterThan(0);
    const webhookSlice = SOURCE.slice(webhookFnIdx);
    expect(webhookSlice).not.toContain("get_billing_availability");

    const verifyIdx = SOURCE.indexOf('path === "verify"');
    const verifyEndMarker = "// All other endpoints require authentication";
    const verifyEndIdx = SOURCE.indexOf(verifyEndMarker, verifyIdx);
    expect(verifyIdx).toBeGreaterThan(0);
    expect(verifyEndIdx).toBeGreaterThan(verifyIdx);
    const verifySlice = SOURCE.slice(verifyIdx, verifyEndIdx);
    expect(verifySlice).not.toContain("get_billing_availability");
  });

  it("retains USD-native settlement and has no ZAR/FX regressions", () => {
    expect(SOURCE).toContain('currency: "USD"');
    expect(SOURCE).toContain('fx_basis: "native_usd"');
    // Legacy ZAR amount field and FX helper must remain absent.
    expect(SOURCE).not.toMatch(/amount_zar/);
    expect(SOURCE).not.toMatch(/from\s+["']\.\.\/_shared\/fx\.ts["']/);
  });
});
