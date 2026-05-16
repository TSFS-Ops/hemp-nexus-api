/**
 * Batch C — Payment Idempotency and Settlement Consistency.
 *
 * Source-pinned regression guards covering:
 *
 *   Fix 1 — Partial UNIQUE INDEX on `audit_logs((metadata->>'payment_reference'))`
 *           WHERE action = 'credits.purchased' AND metadata->>'payment_reference' IS NOT NULL.
 *           Both webhook and verify paths must tolerate the 23505 raised on race.
 *
 *   Fix 2 — Paystack webhook replay returns HTTP 200 with idempotent body,
 *           not 409 (which would trigger needless Paystack retries).
 *
 *   Fix 3 — Pending `token_purchases` row inserted on checkout initiation;
 *           webhook + verify mark it `completed`; failed charges mark it `failed`.
 *           Gives `transaction-reconciliation` real rows to sweep.
 *
 *   Fix 5/6 — Money-integrity invariants pinned in code:
 *           - both paths use the same Paystack reference as request_id
 *           - verify rejects refs belonging to a different org
 *           - initiation mismatch writes risk item and skips credit
 *           - UI only declares "credited" after server proof
 *
 *   Fix 4 — Two-tab pending notice helper window is 15 minutes, filters
 *           on credited references, and lives in PaymentReferenceStatus.
 *
 * These tests are source-pin / fixture-level by design: they catch
 * regressions where someone removes the guard, not edge-function
 * runtime races (those are covered by the existing Deno regression
 * test in supabase/functions/paystack-webhook/d01_regression_test.ts).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const repo = process.cwd();
const read = (p: string) => readFileSync(path.join(repo, p), "utf8");

const TOKEN_PURCHASE = read("supabase/functions/token-purchase/index.ts");
const REPLAY_GUARD = read("supabase/functions/_shared/replay-guard.ts");
const PAYSTACK_WEBHOOK = read("supabase/functions/paystack-webhook/index.ts");
const RECONCILIATION = read("supabase/functions/transaction-reconciliation/index.ts");
const CREDIT_CHECKOUT = read("src/lib/credit-checkout.ts");
const PAYMENT_REF_STATUS = read("src/components/desk/billing/PaymentReferenceStatus.tsx");
const PENDING_NOTICE = read("src/components/desk/billing/PendingPurchaseNotice.tsx");
const BILLING_OVERVIEW = read("src/components/desk/billing/BillingOverview.tsx");
const TOKEN_BALANCE_TAB = read("src/components/desk/settings/TokenBalanceTab.tsx");

function migrations(): string {
  const dir = path.join(repo, "supabase/migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
}
const ALL_MIGRATIONS = migrations();

describe("Batch C — Fix 1: audit-row dedupe for credits.purchased", () => {
  it("creates a partial UNIQUE INDEX on audit_logs((metadata->>'payment_reference'))", () => {
    expect(ALL_MIGRATIONS).toMatch(/idx_audit_logs_credits_purchased_ref/);
    expect(ALL_MIGRATIONS).toMatch(
      /CREATE UNIQUE INDEX[^;]*audit_logs[\s\S]*metadata->>'payment_reference'[\s\S]*action = 'credits\.purchased'/i,
    );
  });

  it("verify path tolerates 23505 on duplicate audit insert", () => {
    // The verify-handler audit insert must check error.code !== '23505' and
    // log+continue on conflict (webhook won the race).
    expect(TOKEN_PURCHASE).toMatch(
      /\[Verify\] credits\.purchased audit row already exists/,
    );
    expect(TOKEN_PURCHASE).toMatch(/auditErr && auditErr\.code !== "23505"/);
  });

  it("webhook path tolerates 23505 on duplicate audit insert", () => {
    expect(TOKEN_PURCHASE).toMatch(
      /\[Webhook\] credits\.purchased audit row already exists/,
    );
  });
});

describe("Batch C — Fix 2: Paystack replay returns 200 idempotent", () => {
  it("replay-guard exposes replayResponseStatus override", () => {
    expect(REPLAY_GUARD).toMatch(/replayResponseStatus\?\s*:\s*number/);
    expect(REPLAY_GUARD).toMatch(
      /opts\.replayResponseStatus\s*\?\?\s*409/,
    );
  });

  it("replay-guard body carries idempotent/replayed markers", () => {
    expect(REPLAY_GUARD).toMatch(/replayed:\s*true/);
    expect(REPLAY_GUARD).toMatch(/idempotent:\s*true/);
  });

  it("token-purchase webhook passes replayResponseStatus: 200 for Paystack", () => {
    // The Paystack webhook handler must opt into 200 so Paystack does not
    // retry known-safe duplicate deliveries.
    expect(TOKEN_PURCHASE).toMatch(/replayResponseStatus:\s*200/);
  });

  it("paystack-webhook entrypoint passes through canonical handler status verbatim", () => {
    // The dedicated entry point forwards bodies + status without rewriting.
    expect(PAYSTACK_WEBHOOK).toMatch(/status:\s*forwarded\.status/);
  });
});

describe("Batch C — Fix 3: token_purchases pending row + lifecycle", () => {
  it("migration creates token_purchases with required columns + UNIQUE reference", () => {
    expect(ALL_MIGRATIONS).toMatch(/CREATE TABLE IF NOT EXISTS public\.token_purchases/);
    expect(ALL_MIGRATIONS).toMatch(/paystack_reference\s+text\s+NOT NULL\s+UNIQUE/);
    expect(ALL_MIGRATIONS).toMatch(/status\s+text\s+NOT NULL\s+DEFAULT\s+'pending'/);
    // status enum bounds
    expect(ALL_MIGRATIONS).toMatch(
      /CHECK \(status IN \('pending','completed','failed','abandoned'\)\)/,
    );
  });

  it("token_purchases has strict RLS (no client policies)", () => {
    expect(ALL_MIGRATIONS).toMatch(
      /ALTER TABLE public\.token_purchases ENABLE ROW LEVEL SECURITY/,
    );
    expect(ALL_MIGRATIONS).toMatch(/REVOKE ALL ON public\.token_purchases FROM anon, authenticated/);
    expect(ALL_MIGRATIONS).toMatch(/GRANT[^;]*ON public\.token_purchases TO service_role/);
  });

  it("checkout initiation inserts pending token_purchases row", () => {
    // Look for the insert keyed on paystack_reference with status pending,
    // in the same function that writes credits.purchase_initiated audit row.
    expect(TOKEN_PURCHASE).toMatch(
      /\.from\("token_purchases"\)[\s\S]{0,200}\.insert\(\{[\s\S]{0,400}status:\s*"pending"/,
    );
    // Must be tolerant of duplicate-key (Idempotency retry).
    expect(TOKEN_PURCHASE).toMatch(
      /token_purchases pending insert failed \(non-fatal\)/,
    );
  });

  it("webhook charge.success marks token_purchases completed", () => {
    expect(TOKEN_PURCHASE).toMatch(
      /\.from\("token_purchases"\)[\s\S]{0,200}\.update\(\{[\s\S]{0,200}status:\s*"completed"[\s\S]{0,400}\.eq\("paystack_reference",\s*reference\)/,
    );
  });

  it("verify path marks token_purchases completed", () => {
    // Both paths must transition the pending row — proof by counting the
    // number of completed-update sites (verify + webhook = 2).
    const completedUpdates = (
      TOKEN_PURCHASE.match(/status:\s*"completed"/g) ?? []
    ).length;
    expect(completedUpdates).toBeGreaterThanOrEqual(2);
  });

  it("charge.failed transitions pending → failed", () => {
    expect(TOKEN_PURCHASE).toMatch(
      /\.from\("token_purchases"\)[\s\S]{0,200}\.update\(\{[\s\S]{0,200}status:\s*"failed"/,
    );
  });

  it("transaction-reconciliation sweeps the same status='pending' rows", () => {
    expect(RECONCILIATION).toMatch(/\.from\("token_purchases"\)/);
    expect(RECONCILIATION).toMatch(/\.eq\("status",\s*"pending"\)/);
  });
});

describe("Batch C — Fix 5: money-integrity invariants pinned in code", () => {
  it("token_ledger UNIQUE(request_id) guard is asserted in handler docs", () => {
    // Stops a future refactor from deleting the comment that anchors the
    // hard idempotency contract.
    expect(TOKEN_PURCHASE).toMatch(/UNIQUE INDEX on token_ledger\(request_id\)/);
  });

  it("both webhook and verify use the Paystack reference as the request_id", () => {
    // verify path
    expect(TOKEN_PURCHASE).toMatch(/p_reference_id:\s*reference[\s\S]*?credit_purchase/);
    // webhook path forwards the same Paystack `reference` field.
    expect(TOKEN_PURCHASE).toMatch(/const \{ reference, metadata, customer, paid_at \} = data;/);
  });

  it("verify rejects references whose org does not match the caller", () => {
    expect(TOKEN_PURCHASE).toMatch(
      /Transaction does not belong to your organisation/,
    );
  });

  it("initiation/settlement mismatch opens a risk item and skips credit", () => {
    expect(TOKEN_PURCHASE).toMatch(/credits\.purchase_rejected/);
    expect(TOKEN_PURCHASE).toMatch(/Paystack settlement mismatch/);
  });

  it("UI only claims credited from server proof (ledger row), not localStorage alone", () => {
    // PaymentReferenceStatus derives 'credited' from the ledger row OR a
    // verify-success result; pending stays pending until proven otherwise.
    expect(PAYMENT_REF_STATUS).toMatch(
      /token_ledger row exists with action_type='credit'\s*→\s*credited/,
    );
  });
});

describe("Batch C — Fix 4: two-tab pending notice", () => {
  it("PaymentReferenceStatus exports readRecentPendingAttempts with a bounded window", () => {
    expect(PAYMENT_REF_STATUS).toMatch(/export function readRecentPendingAttempts/);
    // 15-minute window — pinned to prevent silently widening to "forever".
    expect(PAYMENT_REF_STATUS).toMatch(/PENDING_WARN_WINDOW_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/);
    // Filter must drop already-credited refs.
    expect(PAYMENT_REF_STATUS).toMatch(/creditedRefs\.has\(a\.reference\)/);
  });

  it("PendingPurchaseNotice renders a non-blocking advisory, not an error", () => {
    // Must not call any disabling/blocking helper.
    expect(PENDING_NOTICE).toMatch(/role="status"/);
    expect(PENDING_NOTICE).not.toMatch(/disabled\s*=/);
    // Must NOT claim the previous purchase failed.
    expect(PENDING_NOTICE).not.toMatch(/failed/i);
  });

  it("PendingPurchaseNotice is mounted near Purchase CTAs in both surfaces", () => {
    expect(BILLING_OVERVIEW).toMatch(/<PendingPurchaseNotice/);
    expect(TOKEN_BALANCE_TAB).toMatch(/<PendingPurchaseNotice/);
  });
});

describe("Batch C — Fix 6: UI truthfulness preserved", () => {
  it("credit-checkout helper records the attempt only after Paystack returns a reference", () => {
    expect(CREDIT_CHECKOUT).toMatch(/recordPaystackAttempt\(\{[\s\S]*?reference,/);
    // Cannot record before we have data.reference (proof: recordPaystackAttempt
    // call is below the `const reference = data.reference as string;` line).
    const refIdx = CREDIT_CHECKOUT.indexOf(
      'const reference = data.reference as string;',
    );
    const recordIdx = CREDIT_CHECKOUT.indexOf("recordPaystackAttempt(");
    expect(refIdx).toBeGreaterThan(-1);
    expect(recordIdx).toBeGreaterThan(refIdx);
  });
});
