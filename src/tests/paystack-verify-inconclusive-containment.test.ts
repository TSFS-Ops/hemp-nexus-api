/**
 * Paystack verify containment (P0) — static guards.
 *
 * Ensures a temporary Paystack verify failure (5xx, non-OK, timeout,
 * invalid JSON, or non-definitive provider status) is NOT rendered to
 * the user as a definitive failed transaction.
 *
 * Scope: containment only. No ledger, webhook, refund, schema, RLS,
 * wallet, or idempotency logic is exercised here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const EDGE = read("supabase/functions/token-purchase/index.ts");
const STATUS_UI = read("src/components/desk/billing/PaymentReferenceStatus.tsx");
const BILLING = read("src/pages/Billing.tsx");
const CHECKOUT = read("src/lib/credit-checkout.ts");

describe("Paystack verify containment", () => {
  it("edge function wraps the Paystack fetch in try/catch and returns verifyInconclusive on network error", () => {
    expect(EDGE).toMatch(
      /catch\s*\(\s*netErr\s*\)\s*\{[\s\S]{0,1000}verifyInconclusive:\s*true/
    );
  });

  it("edge function returns verifyInconclusive on non-OK provider response", () => {
    expect(EDGE).toMatch(
      /!verifyRes\.ok[\s\S]{0,400}verifyInconclusive:\s*true/
    );
  });

  it("edge function returns verifyInconclusive on invalid JSON from provider", () => {
    expect(EDGE).toMatch(
      /catch\s*\(\s*parseErr\s*\)\s*\{[\s\S]{0,400}verifyInconclusive:\s*true/
    );
  });

  it("edge function only emits 'Transaction not successful' for definitive provider failures", () => {
    // The literal must appear exactly once in the verify path and must be
    // gated by the DEFINITIVE_FAILURES set (failed/abandoned/reversed).
    expect(EDGE).toMatch(/DEFINITIVE_FAILURES\s*=\s*new Set\(\[\s*"failed",\s*"abandoned",\s*"reversed"\s*\]\)/);
    const occurrences = EDGE.match(/Transaction not successful/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it("edge function treats non-definitive provider statuses as verifyInconclusive", () => {
    // The else-branch under providerStatus !== "success" must return
    // verifyInconclusive when the status is not in DEFINITIVE_FAILURES.
    expect(EDGE).toMatch(
      /providerStatus !== "success"[\s\S]{0,1200}verifyInconclusive:\s*true/
    );
  });

  it("VerifyCheckoutResult exposes verifyInconclusive and paystackStatus", () => {
    expect(CHECKOUT).toMatch(/verifyInconclusive\?:\s*boolean/);
    expect(CHECKOUT).toMatch(/paystackStatus\?:/);
  });

  it("PaymentReferenceStatus has an 'inconclusive' attempt status that is NOT 'failed'", () => {
    expect(STATUS_UI).toMatch(/\|\s*"inconclusive"/);
    // The pill label for inconclusive must not say 'Failed'.
    expect(STATUS_UI).toMatch(/inconclusive:\s*\{[\s\S]{0,200}label:\s*"Pending Provider"/);
  });

  it("PaymentReferenceStatus catch-block maps thrown verify errors to 'inconclusive', not 'failed'", () => {
    // Both the auto-poll and manual-verify catch blocks must set
    // status: "inconclusive" — never status: "failed".
    const catchBlocks = STATUS_UI.match(/catch\s*\(\s*e\s*\)\s*\{[\s\S]*?\}\s*\}/g) ?? [];
    expect(catchBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of catchBlocks) {
      expect(block).toMatch(/status:\s*"inconclusive"/);
      expect(block).not.toMatch(/status:\s*"failed"/);
    }
  });

  it("PaymentReferenceStatus only renders 'failed' when provider definitively returned failed/abandoned/reversed", () => {
    expect(STATUS_UI).toMatch(
      /\["failed",\s*"abandoned",\s*"reversed"\]\.includes\(result\.paystackStatus\)/
    );
  });

  it("Billing page routes verifyInconclusive to the settling banner, not the failure banner", () => {
    // Both verify blocks should branch on verifyInconclusive before the
    // generic fallback and BEFORE any setPaymentFailure call.
    const inconclusiveBranches = BILLING.match(/verifyInconclusive/g) ?? [];
    expect(inconclusiveBranches.length).toBeGreaterThanOrEqual(2);
    // setPaymentFailure must still be gated on the definitive failure
    // statuses only.
    expect(BILLING).toMatch(
      /paystackStatus === "failed"\s*\|\|\s*paystackStatus === "reversed"[\s\S]{0,200}setPaymentFailure/
    );
  });
});
