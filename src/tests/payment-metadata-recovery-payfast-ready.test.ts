/**
 * PayFast-ready hardening for the Paystack webhook missing-metadata path
 * and reconciliation parity — static guards.
 *
 * Scope: ensure that
 *   1. Recovery is provider-agnostic (paystack_reference + provider_reference).
 *   2. Edge-level metadata validation runs before atomic_paid_credit_purchase
 *      (UUID-shaped org_id, positive-integer credits, non-empty reference).
 *   3. The unrecoverable-metadata risk item carries
 *      kind='payment_metadata_unrecoverable' with a stable dedup_key.
 *   4. Reconciliation's confirmed-paid-purchase path uses
 *      atomic_paid_credit_purchase (canonical credit_purchase), NOT
 *      atomic_token_credit.
 *
 * Does NOT exercise ledger semantics, balances, refunds, provider APIs,
 * webhook signature verification, RLS, grants, or UI.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TP = readFileSync(
  resolve(process.cwd(), "supabase/functions/token-purchase/index.ts"),
  "utf8",
);
const RECON = readFileSync(
  resolve(process.cwd(), "supabase/functions/transaction-reconciliation/index.ts"),
  "utf8",
);

// Narrow to the charge.success handler so we don't match refund/verify code.
const handlerStart = TP.indexOf("async function handleChargeSuccess");
expect(handlerStart, "handleChargeSuccess must exist").toBeGreaterThan(-1);
const handlerEnd = TP.indexOf("\nasync function ", handlerStart + 1);
const HANDLER = TP.slice(handlerStart, handlerEnd > 0 ? handlerEnd : TP.length);

describe("PayFast-ready missing-metadata recovery", () => {
  it("keeps the Paystack-shaped recovery lookup working", () => {
    expect(HANDLER).toMatch(/\.eq\(\s*["']paystack_reference["']\s*,\s*reference\s*\)/);
  });

  it("adds a provider-agnostic token_purchases recovery lookup", () => {
    expect(HANDLER).toMatch(
      /\.eq\(\s*["']metadata->>provider_reference["']\s*,\s*reference\s*\)/,
    );
  });

  it("extends the credits.purchase_initiated audit OR clause with provider_reference", () => {
    expect(HANDLER).toMatch(/metadata->>provider_reference\.eq\.\$\{reference\}/);
  });

  it("preserves the legacy payment_reference / reference keys in the OR clause", () => {
    expect(HANDLER).toMatch(
      /metadata->>payment_reference\.eq\.\$\{reference\}[\s\S]{0,200}metadata->>reference\.eq\.\$\{reference\}/,
    );
  });
});

describe("Edge-level metadata validation before atomic_paid_credit_purchase", () => {
  it("validates UUID-shaped org_id", () => {
    expect(HANDLER).toMatch(/UUID_RE\s*=\s*\/\^\[0-9a-f\]\{8\}/);
    expect(HANDLER).toMatch(/org_id_not_uuid/);
  });

  it("validates credits is a positive integer", () => {
    expect(HANDLER).toMatch(/Number\.isInteger\(creditsNum\)/);
    expect(HANDLER).toMatch(/credits_not_positive_integer/);
  });

  it("validates reference is non-empty", () => {
    expect(HANDLER).toMatch(/reference_empty/);
  });

  it("writes credits.purchase_rejected with reason metadata_validation_failed", () => {
    expect(HANDLER).toMatch(/reason:\s*["']metadata_validation_failed["']/);
  });

  it("does NOT call atomic_paid_credit_purchase when validation fails (return precedes the RPC)", () => {
    const validationIdx = HANDLER.indexOf("metadata_validation_failed");
    const rpcIdx = HANDLER.indexOf("atomic_paid_credit_purchase");
    expect(validationIdx).toBeGreaterThan(-1);
    expect(rpcIdx).toBeGreaterThan(validationIdx);
    // The validation block must end with `return;` before the RPC call.
    const between = HANDLER.slice(validationIdx, rpcIdx);
    expect(between).toMatch(/\n\s*return;\s*\n/);
  });
});

describe("Unrecoverable / validation-failed risk-item kind + dedup", () => {
  it("uses kind='payment_metadata_unrecoverable'", () => {
    expect(HANDLER).toMatch(/kind:\s*["']payment_metadata_unrecoverable["']/);
  });

  it("uses a stable dedup_key namespaced by provider reference", () => {
    expect(HANDLER).toMatch(/payment_metadata_unrecoverable:\$\{reference\}/);
  });

  it("checks for an existing dedup row before inserting (no duplicate risk items)", () => {
    expect(HANDLER).toMatch(
      /admin_risk_items[\s\S]{0,400}\.eq\(\s*["']dedup_key["']\s*,\s*unrecoverableDedup\s*\)/,
    );
  });
});

describe("Reconciliation parity — canonical credit_purchase", () => {
  it("calls atomic_paid_credit_purchase, not atomic_token_credit, for confirmed paid purchases", () => {
    // Narrow to the stale-payments block so we don't pick up other helpers.
    const block = RECON.slice(
      RECON.indexOf("--- 1. Stale Paystack payments ---"),
      RECON.indexOf("--- 2. Stale email queue entries ---"),
    );
    expect(block).toMatch(/rpc\(\s*["']atomic_paid_credit_purchase["']/);
    expect(block).not.toMatch(/rpc\(\s*["']atomic_token_credit["']/);
  });

  it("uses the provider reference as p_reference_id (idempotent against the webhook path)", () => {
    expect(RECON).toMatch(
      /atomic_paid_credit_purchase[\s\S]{0,300}p_reference_id:\s*purchase\.paystack_reference/,
    );
  });

  it("uses a reconciliation-scoped endpoint label", () => {
    expect(RECON).toMatch(/p_endpoint:\s*["']payment:paystack:reconciliation["']/);
  });
});
