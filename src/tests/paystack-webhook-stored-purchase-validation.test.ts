/**
 * Paystack webhook stored-purchase cross-check (hardening phase) --
 * static guards.
 *
 * Closes a gap identified in the admin-only readiness audit: a
 * charge.success webhook carrying complete-looking metadata
 * (org_id + credits) but NO backing token_purchases record would
 * previously still be credited, because the existing D-01
 * initiation-row check only ran against the credits.purchase_initiated
 * AUDIT LOG row, and only during missing-metadata recovery did the
 * handler ever read token_purchases directly.
 *
 * This guard looks the paid reference up in token_purchases (by
 * provider_reference, then legacy paystack_reference) and, if a row
 * is found, requires its provider/status/token_amount/org_id/user_id/
 * currency/amount_usd to be consistent with what is about to be
 * credited. Absence of a row is NOT itself rejected (preserves
 * legacy/pre-Batch-C behaviour and the existing missing-metadata
 * containment).
 *
 * Scope: this validation branch only. No ledger semantics, signature
 * verification, replay/idempotency protection, refund/dispute
 * handling, ordinary/pending happy-path crediting, purchase-history,
 * or admin-revenue-reporting logic is changed or exercised here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EDGE = readFileSync(
  resolve(process.cwd(), "supabase/functions/token-purchase/index.ts"),
  "utf8",
);

const handlerStart = EDGE.indexOf("async function handleChargeSuccess");
expect(handlerStart, "handleChargeSuccess must exist").toBeGreaterThan(-1);
const handlerEnd = EDGE.indexOf("\nasync function ", handlerStart + 1);
const HANDLER = EDGE.slice(handlerStart, handlerEnd > 0 ? handlerEnd : EDGE.length);

describe("Paystack webhook stored-purchase cross-check", () => {
  it("looks up token_purchases by provider_reference, then falls back to legacy paystack_reference", () => {
    expect(HANDLER).toMatch(/Stored-purchase validation/);
    expect(HANDLER).toMatch(/\.eq\(\s*["']provider_reference["']\s*,\s*reference\s*\)/);
    expect(HANDLER).toMatch(/\.eq\(\s*["']paystack_reference["']\s*,\s*reference\s*\)/);
  });

  it("treats absence of a stored purchase row as non-fatal (legacy/pre-Batch-C settlements preserved)", () => {
    const validationIdx = HANDLER.indexOf("Stored-purchase validation");
    const ifStoredIdx = HANDLER.indexOf("if (storedPurchase)", validationIdx);
    expect(ifStoredIdx).toBeGreaterThan(validationIdx);
    // No unconditional `return` or `throw` between the lookup and the
    // `if (storedPurchase)` gate -- absence alone must fall through.
    const between = HANDLER.slice(validationIdx, ifStoredIdx);
    expect(between).not.toMatch(/\n\s*return;/);
    expect(between).not.toMatch(/\n\s*throw /);
  });

  it("rejects on provider mismatch, ineligible status, token_amount, org_id, user_id, currency, or amount_usd mismatch", () => {
    expect(HANDLER).toMatch(/provider expected=paystack stored=/);
    expect(HANDLER).toMatch(/ELIGIBLE_STATUSES\s*=\s*new Set\(\s*\[\s*["']pending["']\s*,\s*["']completed["']\s*\]\s*\)/);
    expect(HANDLER).toMatch(/status_not_eligible stored=/);
    expect(HANDLER).toMatch(/token_amount expected=.*settled=/);
    expect(HANDLER).toMatch(/org_id expected=.*settled=/);
    expect(HANDLER).toMatch(/user_id expected=.*settled=/);
    expect(HANDLER).toMatch(/currency expected=.*settled=/);
    expect(HANDLER).toMatch(/amount_usd expected=.*settled=/);
  });

  it("on mismatch writes credits.purchase_rejected + a deduped high-severity admin_risk_items row, then returns (no throw, no double-credit)", () => {
    const validationIdx = HANDLER.indexOf("Stored-purchase validation");
    const mismatchIdx = HANDLER.indexOf("stored-purchase mismatch:", validationIdx);
    expect(mismatchIdx).toBeGreaterThan(validationIdx);
    const branch = HANDLER.slice(mismatchIdx, mismatchIdx + 1800);
    expect(branch).toMatch(/action:\s*["']credits\.purchase_rejected["']/);
    expect(branch).toMatch(/payment_stored_purchase_mismatch/);
    expect(branch).toMatch(/severity:\s*["']high["']/);
    expect(branch).toMatch(/dedup_key/);
    expect(branch).toMatch(/\n\s*return;/);
    expect(branch).not.toMatch(/\n\s*throw /);
  });

  it("runs before the atomic_paid_credit_purchase call (no credit issued on a mismatch)", () => {
    const validationIdx = HANDLER.indexOf("Stored-purchase validation");
    const rpcIdx = HANDLER.indexOf('supabase.rpc("atomic_paid_credit_purchase"');
    expect(validationIdx).toBeGreaterThan(-1);
    expect(rpcIdx).toBeGreaterThan(validationIdx);
  });

  it("does not weaken HMAC signature verification, replay protection, or the finalised-state idempotency guard", () => {
    expect(EDGE).toMatch(/x-paystack-signature/);
    expect(EDGE).toMatch(/assertNotReplayed/);
    expect(HANDLER).toMatch(
      /\.eq\(\s*["']action_type["']\s*,\s*["']credit_purchase["']\s*\)[\s\S]{0,200}Already finalised/,
    );
  });

  it("preserves the existing missing-metadata recovery and initiation-audit-row mismatch checks unchanged", () => {
    expect(HANDLER).toMatch(/missing_metadata_no_recovery/);
    expect(HANDLER).toMatch(/initiation_mismatch/);
  });

  it("does not introduce FX conversion or an external FX API", () => {
    expect(HANDLER).not.toMatch(/_shared\/fx\.ts/);
    expect(HANDLER).not.toMatch(/exchangerate|fixer\.io|open-exchange/i);
  });
});
