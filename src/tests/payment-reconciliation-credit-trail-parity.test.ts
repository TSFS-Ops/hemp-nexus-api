/**
 * Reconciliation credit-trail parity with webhook/verify — static guards.
 *
 * After PAYMENT_METADATA_RECOVERY_PAYFAST_READY_HARDENING_COMPLETE, the
 * reconciliation cron must also produce the same canonical audit +
 * revenue trail and the same mismatch protection as the webhook path,
 * so a payment recovered ONLY by the cron is indistinguishable from a
 * webhook-credited payment in reporting and risk surfaces.
 *
 * Scope: ensure that the `transaction-reconciliation` handler
 *   1. Runs init-vs-settled mismatch validation BEFORE atomic_paid_credit_purchase.
 *   2. On mismatch: writes credits.purchase_rejected (initiation_mismatch),
 *      opens a deduped payment_settlement_mismatch risk item, never calls
 *      the paid-credit RPC, never mutates balance.
 *   3. On success: writes a canonical credits.purchased audit with
 *      payment_reference and treats 23505 as a no-op (webhook won the race).
 *   4. On success: calls emitRevenueNotification with the same
 *      `revenue-credits-purchased-${reference}` idempotency key.
 *   5. Mismatch and audit-failure both use deduped admin_risk_items so
 *      repeated reconciliation ticks don't spam the queue.
 *
 * Does NOT exercise ledger semantics, balances, refunds, RLS, grants,
 * the wider revenue helper, or live Paystack/PayFast calls.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RECON = readFileSync(
  resolve(process.cwd(), "supabase/functions/transaction-reconciliation/index.ts"),
  "utf8",
);

// Narrow to the stale-payments block so unrelated reconciliation work
// (emails, refunds, skeletal repair) is not matched.
const blockStart = RECON.indexOf("--- 1. Stale Paystack payments ---");
const blockEnd = RECON.indexOf("--- 2. Stale email queue entries ---");
expect(blockStart, "stale-payments block must exist").toBeGreaterThan(-1);
expect(blockEnd, "next block must exist").toBeGreaterThan(blockStart);
const BLOCK = RECON.slice(blockStart, blockEnd);

describe("Reconciliation imports revenue-notify helper (parity with webhook)", () => {
  it("imports emitRevenueNotification from _shared/revenue-notify", () => {
    expect(RECON).toMatch(
      /import\s*\{\s*emitRevenueNotification\s*\}\s*from\s*["']\.\.\/_shared\/revenue-notify\.ts["']/,
    );
  });
});

describe("Mismatch guard parity (init vs settled, before RPC)", () => {
  it("looks up the credits.purchase_initiated audit row by provider-agnostic OR clause", () => {
    expect(BLOCK).toMatch(/credits\.purchase_initiated/);
    expect(BLOCK).toMatch(
      /metadata->>payment_reference\.eq\.\$\{purchase\.paystack_reference\}[\s\S]{0,400}metadata->>provider_reference\.eq\.\$\{purchase\.paystack_reference\}/,
    );
  });

  it("compares amount with the same 1-cent tolerance as the webhook path", () => {
    expect(BLOCK).toMatch(/Math\.abs\(expectedUsd - settledAmountUsd\)\s*>\s*0\.01/);
  });

  it("compares currency case-insensitively", () => {
    expect(BLOCK).toMatch(/expectedCurrency\s*!==\s*settledCurrency/);
    expect(BLOCK).toMatch(/\.toUpperCase\(\)/);
  });

  it("compares package_id when both sides have it", () => {
    expect(BLOCK).toMatch(/expectedPackage\s*&&\s*settledPackage\s*&&\s*expectedPackage\s*!==\s*settledPackage/);
  });

  it("on mismatch writes credits.purchase_rejected with reason initiation_mismatch", () => {
    expect(BLOCK).toMatch(/action:\s*["']credits\.purchase_rejected["']/);
    expect(BLOCK).toMatch(/reason:\s*["']initiation_mismatch["']/);
  });

  it("on mismatch opens a deduped payment_settlement_mismatch admin risk item", () => {
    expect(BLOCK).toMatch(/kind:\s*["']payment_settlement_mismatch["']/);
    expect(BLOCK).toMatch(/payment_settlement_mismatch:\$\{purchase\.paystack_reference\}/);
    expect(BLOCK).toMatch(
      /admin_risk_items[\s\S]{0,400}\.eq\(\s*["']dedup_key["']\s*,\s*mismatchDedup\s*\)/,
    );
  });

  it("on mismatch does NOT call atomic_paid_credit_purchase (continue precedes the RPC)", () => {
    const mismatchIdx = BLOCK.indexOf("initiation_mismatch");
    const rpcCallRe = /adminClient\.rpc\(\s*["']atomic_paid_credit_purchase["']/;
    const rpcMatch = rpcCallRe.exec(BLOCK);
    expect(mismatchIdx).toBeGreaterThan(-1);
    expect(rpcMatch, "RPC call must exist").not.toBeNull();
    expect(rpcMatch!.index).toBeGreaterThan(mismatchIdx);
    // The mismatch block must end with `continue;` before the RPC.
    const between = BLOCK.slice(mismatchIdx, rpcMatch!.index);
    expect(between).toMatch(/\n\s*continue;\s*\n/);
  });
});

describe("Audit parity (canonical credits.purchased after RPC)", () => {
  it("writes credits.purchased audit with payment_reference matching the provider reference", () => {
    expect(BLOCK).toMatch(/action:\s*["']credits\.purchased["']/);
    expect(BLOCK).toMatch(/payment_reference:\s*purchase\.paystack_reference/);
  });

  it("treats 23505 (partial UNIQUE collision) as a no-op", () => {
    expect(BLOCK).toMatch(/auditErr\?\.code\s*!==\s*["']23505["']|auditErr\.code\s*!==\s*["']23505["']/);
  });

  it("opens a deduped reconciliation-audit-failed risk item on non-23505 audit errors", () => {
    expect(BLOCK).toMatch(/kind:\s*["']payment_reconciliation_audit_failed["']/);
    expect(BLOCK).toMatch(/reconciliation_audit_failed:\$\{purchase\.paystack_reference\}/);
  });

  it("stamps source='transaction-reconciliation' so reporting can attribute origin", () => {
    expect(BLOCK).toMatch(/source:\s*["']transaction-reconciliation["']/);
  });
});

describe("Revenue notification parity", () => {
  it("calls emitRevenueNotification after a successful credit", () => {
    expect(BLOCK).toMatch(/emitRevenueNotification\(\s*adminClient/);
  });

  it("uses the same eventType as the webhook path", () => {
    expect(BLOCK).toMatch(/eventType:\s*["']credits_purchased["']/);
  });

  it("uses the same idempotency key pattern as the webhook path", () => {
    expect(BLOCK).toMatch(
      /idempotencyKey:\s*`revenue-credits-purchased-\$\{purchase\.paystack_reference\}`/,
    );
  });
});

describe("Idempotency / safety invariants", () => {
  it("uses provider reference as p_reference_id (idempotent against webhook + verify)", () => {
    expect(BLOCK).toMatch(
      /atomic_paid_credit_purchase[\s\S]{0,300}p_reference_id:\s*purchase\.paystack_reference/,
    );
  });

  it("does not call atomic_token_credit (canonical credit_purchase only)", () => {
    expect(BLOCK).not.toMatch(/rpc\(\s*["']atomic_token_credit["']/);
  });

  it("transport uncertainty paths (timeout/network/non-OK/invalid JSON) never mark failed", () => {
    // The four inconclusive branches push 'left_pending_inconclusive', not 'failed'.
    const inconclusiveOccurrences = BLOCK.match(/action:\s*["']left_pending_inconclusive["']/g) ?? [];
    expect(inconclusiveOccurrences.length).toBeGreaterThanOrEqual(3);
    // Confirm none of them are followed by a status='failed' update in the same branch:
    expect(BLOCK).not.toMatch(
      /left_pending_inconclusive[\s\S]{0,200}status:\s*["']failed["']/,
    );
  });

  it("no raw balance or ledger mutation outside the approved RPC path", () => {
    // The only ledger mutation in the success branch must be via atomic_paid_credit_purchase.
    expect(BLOCK).not.toMatch(/\.from\(\s*["']token_ledger["']\s*\)\s*\.(insert|update|delete)/);
    expect(BLOCK).not.toMatch(/\.from\(\s*["']token_balances["']\s*\)\s*\.(insert|update|delete)/);
  });
});
