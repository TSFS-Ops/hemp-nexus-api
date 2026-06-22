/**
 * Paystack webhook missing-metadata containment (P0) — static guards.
 *
 * Ensures a Paystack `charge.success` webhook arriving without
 * metadata.org_id / metadata.credits is NOT silently dropped with only
 * a console.error. Recovery is attempted against server-trusted records
 * (token_purchases, credits.purchase_initiated). If recovery fails, a
 * visible audit_logs + admin_risk_items pair is written and the handler
 * still returns normally so Paystack does not retry-storm.
 *
 * Scope: containment only. No ledger semantics, atomic_token_credit,
 * webhook signature verification, replay/idempotency protections,
 * purchase init, /verify path, refund, schema, RLS, grants, or UI are
 * exercised here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EDGE = readFileSync(
  resolve(process.cwd(), "supabase/functions/token-purchase/index.ts"),
  "utf8",
);

// Narrow the assertions to the charge.success handler so we don't match
// unrelated occurrences elsewhere in the file (refunds, verify, init).
const handlerStart = EDGE.indexOf("async function handleChargeSuccess");
expect(handlerStart, "handleChargeSuccess must exist").toBeGreaterThan(-1);
const handlerEnd = EDGE.indexOf("\nasync function ", handlerStart + 1);
const HANDLER = EDGE.slice(handlerStart, handlerEnd > 0 ? handlerEnd : EDGE.length);

describe("Paystack webhook missing-metadata containment", () => {
  it("does NOT early-return on missing org_id/credits before attempting recovery", () => {
    // The old shape was a bare `console.error(...); return;` immediately
    // after the org_id/credits guard. Forbid that exact pattern.
    expect(HANDLER).not.toMatch(
      /missing org_id\/credits in metadata[\s\S]{0,80}\n\s*return;/,
    );
  });

  it("attempts recovery from token_purchases by paystack_reference", () => {
    expect(HANDLER).toMatch(/\.from\(\s*["']token_purchases["']\s*\)/);
    expect(HANDLER).toMatch(/paystack_reference/);
  });

  it("attempts recovery from credits.purchase_initiated audit_logs row", () => {
    expect(HANDLER).toMatch(/credits\.purchase_initiated/);
    expect(HANDLER).toMatch(
      /metadata->>payment_reference\.eq\.\$\{reference\}/,
    );
  });

  it("on recovery failure inserts a credits.purchase_rejected audit row with reason missing_metadata_no_recovery", () => {
    expect(HANDLER).toMatch(/action:\s*["']credits\.purchase_rejected["']/);
    expect(HANDLER).toMatch(/reason:\s*["']missing_metadata_no_recovery["']/);
  });

  it("on recovery failure inserts an admin_risk_items row with high severity", () => {
    // The handler already has other risk_items inserts (mismatch, promotion
    // failure). Assert that one of them carries the unrecoverable-metadata
    // title so we know the missing-metadata branch wires the alert.
    expect(HANDLER).toMatch(
      /admin_risk_items[\s\S]{0,400}unrecoverable metadata[\s\S]{0,200}severity:\s*["']high["']/,
    );
  });

  it("returns normally after the unrecoverable branch (no throw, no retry-storm trigger)", () => {
    // The unrecoverable branch must end with a plain `return;` — never
    // `throw` (which would surface as 5xx and cause Paystack to retry).
    expect(HANDLER).toMatch(
      /missing_metadata_no_recovery[\s\S]{0,1200}\n\s*return;/,
    );
    expect(HANDLER).not.toMatch(
      /missing_metadata_no_recovery[\s\S]{0,1200}\n\s*throw\s/,
    );
  });

  it("does not change the call signature of atomic_token_credit", () => {
    // Containment must not touch ledger semantics.
    expect(HANDLER).toMatch(
      /supabase\.rpc\(\s*["']atomic_token_credit["'][\s\S]{0,400}p_org_id[\s\S]{0,40}p_amount[\s\S]{0,80}p_reason[\s\S]{0,80}p_reference_id/,
    );
  });

  it("preserves existing initiation-mismatch validation (amount/currency/package)", () => {
    expect(HANDLER).toMatch(/initiation_mismatch/);
    expect(HANDLER).toMatch(/expected=\$\{expectedUsd\}/);
  });

  it("preserves existing finalised-state idempotency guard", () => {
    expect(HANDLER).toMatch(
      /\.eq\(\s*["']action_type["']\s*,\s*["']credit_purchase["']\s*\)[\s\S]{0,200}Already finalised/,
    );
  });
});
