/**
 * Paystack admin-only checkout initiation guard (hardening phase) --
 * static guards.
 *
 * Product rule: PayFast is the only customer-facing payment provider.
 * Paystack checkout initiation must remain admin-only/internal, even
 * though PaymentMethodPicker.tsx already hides the button from normal
 * customers (PAYSTACK_PUBLIC_ENABLED=false). UI hiding alone is not a
 * security boundary, so token-purchase/index.ts must also refuse a
 * direct POST from a non-admin caller, server-side, before any
 * idempotency reservation, Paystack API call, or token_purchases row.
 *
 * Scope: guard placement and behaviour only. No schema, RLS, ledger,
 * webhook, verify, refund, or dispute logic is exercised here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "../../supabase/functions/token-purchase/index.ts"),
  "utf8",
);

// Narrow to the initiation path: from the "Profile not found" guard
// through the start of the billing-availability guard. This excludes
// /verify, /webhook, /packages, and /entity, which are handled and
// returned earlier in the file.
const profileNotFoundIdx = SRC.indexOf('"Profile not found"');
expect(profileNotFoundIdx, "profile-not-found guard must exist").toBeGreaterThan(-1);
const billingAvailabilityIdx = SRC.indexOf("SERVER-SIDE BILLING AVAILABILITY GUARD");
expect(billingAvailabilityIdx, "billing availability guard must exist").toBeGreaterThan(-1);
const GUARD_REGION = SRC.slice(profileNotFoundIdx, billingAvailabilityIdx);

describe("Paystack admin-only checkout initiation guard", () => {
  it("checks platform_admin via the has_role RPC (same pattern as PayFast's admin-only sandbox gate)", () => {
    expect(GUARD_REGION).toMatch(/supabase\.rpc\(\s*["']has_role["']/);
    expect(GUARD_REGION).toMatch(/_role:\s*["']platform_admin["']/);
    expect(GUARD_REGION).toMatch(/_user_id:\s*userData\.user\.id/);
  });

  it("rejects non-admin callers with 403 and a not_admin code", () => {
    expect(GUARD_REGION).toMatch(/isPlatformAdmin\s*!==?\s*true|!isPlatformAdmin/);
    expect(GUARD_REGION).toMatch(/code:\s*["']not_admin["']/);
    expect(GUARD_REGION).toMatch(/status:\s*403/);
  });

  it("does not insert token_purchases, reserve idempotency, or call Paystack in the rejection branch", () => {
    const notAdminIdx = GUARD_REGION.indexOf('code: "not_admin"');
    expect(notAdminIdx).toBeGreaterThan(-1);
    const rejectionBranch = GUARD_REGION.slice(
      GUARD_REGION.lastIndexOf("if (!isPlatformAdmin)", notAdminIdx),
      notAdminIdx + 400,
    );
    expect(rejectionBranch).not.toMatch(/idempotency_keys/);
    expect(rejectionBranch).not.toMatch(/token_purchases/);
    expect(rejectionBranch).not.toMatch(/api\.paystack\.co/);
  });

  it("writes a best-effort audit row for blocked attempts without blocking the 403", () => {
    expect(GUARD_REGION).toMatch(/credits\.purchase_initiation_blocked/);
    expect(GUARD_REGION).toMatch(/catch\s*\(_auditErr\)/);
  });

  it("fails closed (503) if the role-check RPC itself errors, rather than defaulting to allow", () => {
    expect(GUARD_REGION).toMatch(/roleCheckError/);
    expect(GUARD_REGION).toMatch(/admin_check_failed/);
    expect(GUARD_REGION).toMatch(/status:\s*503/);
  });

  it("the guard appears before the billing-availability, billing-hold, and demo-mode guards", () => {
    const guardIdx = SRC.indexOf("PAYSTACK ADMIN-ONLY HARDENING");
    const billingIdx = SRC.indexOf("SERVER-SIDE BILLING AVAILABILITY GUARD");
    const holdIdx = SRC.indexOf("DEC-007 / PAY-009");
    const demoIdx = SRC.indexOf("OPS-010 Phase 2A");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(billingIdx);
    expect(guardIdx).toBeLessThan(holdIdx);
    expect(guardIdx).toBeLessThan(demoIdx);
  });

  it("does not appear inside the webhook, verify, packages, or entity handlers (initiation-only scope)", () => {
    const webhookHandlerIdx = SRC.indexOf("async function handleWebhook");
    const verifyIdx = SRC.indexOf('path === "verify"');
    const packagesIdx = SRC.indexOf("async function handleGetPackages");
    expect(webhookHandlerIdx).toBeGreaterThan(-1);
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(packagesIdx).toBeGreaterThan(-1);
    // The verify branch is handled and returned entirely BEFORE the
    // admin-only guard region begins.
    const guardIdx = SRC.indexOf("PAYSTACK ADMIN-ONLY HARDENING");
    expect(verifyIdx).toBeLessThan(guardIdx);
  });

  it("does not change wallet or ledger crediting semantics (guard is additive only; comment referencing the PayFast precedent is fine)", () => {
    expect(GUARD_REGION).not.toMatch(/supabase\.rpc\(\s*["']atomic_token_credit["']|supabase\.rpc\(\s*["']atomic_paid_credit_purchase["']/);
    expect(GUARD_REGION).not.toMatch(/\.from\(\s*["']token_ledger["']\s*\)/);
  });
});
