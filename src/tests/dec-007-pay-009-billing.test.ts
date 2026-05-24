/**
 * DEC-007 / PAY-009 — billing governance regression tests.
 * SSOT + guard wiring + ledger-integrity contracts.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  DEC_007_PAY_009_AUDIT_NAMES,
  BILLING_REFUND_REQUESTED,
  BILLING_REFUND_APPROVED,
  BILLING_REFUND_DECLINED,
  BILLING_REFUND_BLOCKED_CREDITS_USED,
  BILLING_REFUND_BLOCKED_CREDITS_EXPIRED,
  BILLING_CREDIT_ADJUSTMENT_RECORDED,
  BILLING_PAYMENT_DISPUTE_DETECTED,
  BILLING_CREDITS_FROZEN_DUE_TO_DISPUTE,
  BILLING_USED_CREDITS_MARKED_BILLING_REVIEW,
  BILLING_PAYMENT_DISPUTE_RESOLVED_WON,
  BILLING_PAYMENT_DISPUTE_RESOLVED_LOST,
  BILLING_ORG_BILLING_HOLD_APPLIED,
  BILLING_ORG_BILLING_HOLD_RELEASED,
} from "@/lib/policy/dec-007-pay-009-audit";
import { DEC_007_REFUND_POLICY, DEC_007_PAY_009_ADMIN_DISCLAIMER } from "@/lib/policy/dec-007-refund-policy";

describe("DEC-007 / PAY-009 SSOT", () => {
  it("exports 13 canonical audit names", () => {
    expect(DEC_007_PAY_009_AUDIT_NAMES).toHaveLength(13);
  });
  it("DEC-007 audit names are exact", () => {
    expect(BILLING_REFUND_REQUESTED).toBe("billing.refund_requested");
    expect(BILLING_REFUND_APPROVED).toBe("billing.refund_approved");
    expect(BILLING_REFUND_DECLINED).toBe("billing.refund_declined");
    expect(BILLING_REFUND_BLOCKED_CREDITS_USED).toBe("billing.refund_blocked_credits_used");
    expect(BILLING_REFUND_BLOCKED_CREDITS_EXPIRED).toBe("billing.refund_blocked_credits_expired");
    expect(BILLING_CREDIT_ADJUSTMENT_RECORDED).toBe("billing.credit_adjustment_recorded");
  });
  it("PAY-009 audit names are exact", () => {
    expect(BILLING_PAYMENT_DISPUTE_DETECTED).toBe("billing.payment_dispute_detected");
    expect(BILLING_CREDITS_FROZEN_DUE_TO_DISPUTE).toBe("billing.credits_frozen_due_to_dispute");
    expect(BILLING_USED_CREDITS_MARKED_BILLING_REVIEW).toBe("billing.used_credits_marked_billing_review");
    expect(BILLING_PAYMENT_DISPUTE_RESOLVED_WON).toBe("billing.payment_dispute_resolved_won");
    expect(BILLING_PAYMENT_DISPUTE_RESOLVED_LOST).toBe("billing.payment_dispute_resolved_lost");
    expect(BILLING_ORG_BILLING_HOLD_APPLIED).toBe("billing.org_billing_hold_applied");
    expect(BILLING_ORG_BILLING_HOLD_RELEASED).toBe("billing.org_billing_hold_released");
  });
  it("policy constants pinned", () => {
    expect(DEC_007_REFUND_POLICY.unusedCreditsRefundableDays).toBe(7);
    expect(DEC_007_REFUND_POLICY.expiryDays).toBe(180);
    expect(DEC_007_REFUND_POLICY.consumedCreditsRefundable).toBe(false);
    expect(DEC_007_REFUND_POLICY.minAdminReasonLength).toBe(20);
  });
  it("admin disclaimer copy is exact", () => {
    expect(DEC_007_PAY_009_ADMIN_DISCLAIMER).toMatch(/Burned credits/);
    expect(DEC_007_PAY_009_ADMIN_DISCLAIMER).toMatch(/No evidence is deleted/);
  });
});

describe("DEC-007 / PAY-009 Deno mirror parity", () => {
  it("Deno audit module mirrors TS", () => {
    const ts = fs.readFileSync("src/lib/policy/dec-007-pay-009-audit.ts", "utf8");
    const deno = fs.readFileSync("supabase/functions/_shared/dec-007-pay-009-audit.ts", "utf8");
    for (const n of DEC_007_PAY_009_AUDIT_NAMES) {
      expect(ts).toContain(`"${n}"`);
      expect(deno).toContain(`"${n}"`);
    }
  });
});

describe("DEC-007 / PAY-009 guard wiring", () => {
  it("token-purchase init wires assertNoBillingHold", () => {
    const s = fs.readFileSync("supabase/functions/token-purchase/index.ts", "utf8");
    expect(s).toContain("assertNoBillingHold");
    expect(s).toContain("BILLING_HOLD_ACTIVE");
  });
  it("atomic_token_burn migration installs BILLING_HOLD_ACTIVE guard", () => {
    const dir = "supabase/migrations";
    const found = fs.readdirSync(dir).some(f => {
      const s = fs.readFileSync(`${dir}/${f}`, "utf8");
      return s.includes("atomic_token_burn") && s.includes("BILLING_HOLD_ACTIVE");
    });
    expect(found).toBe(true);
  });
});

describe("DEC-007 / PAY-009 ledger integrity contract", () => {
  const SURFACES = [
    "supabase/functions/refund-request/index.ts",
    "supabase/functions/admin-refund-approve/index.ts",
    "supabase/functions/admin-refund-decline/index.ts",
    "supabase/functions/admin-payment-dispute-record/index.ts",
    "supabase/functions/admin-payment-dispute-resolve-won/index.ts",
    "supabase/functions/admin-payment-dispute-resolve-lost/index.ts",
    "supabase/functions/admin-billing-hold-apply/index.ts",
    "supabase/functions/admin-billing-hold-release/index.ts",
    "supabase/functions/_shared/billing-hold-guard.ts",
  ];
  it("no DEC-007/PAY-009 surface deletes token_ledger / audit_logs / matches / poi / wads", () => {
    for (const p of SURFACES) {
      const s = fs.readFileSync(p, "utf8");
      expect(s).not.toMatch(/delete\s+from\s+token_ledger/i);
      expect(s).not.toMatch(/\.from\(\s*['"]token_ledger['"]\s*\)\s*\.delete\(/);
      expect(s).not.toMatch(/\.from\(\s*['"]audit_logs['"]\s*\)\s*\.delete\(/);
      expect(s).not.toMatch(/\.from\(\s*['"]matches['"]\s*\)\s*\.delete\(/);
      expect(s).not.toMatch(/\.from\(\s*['"]poi['"]\s*\)\s*\.delete\(/);
      expect(s).not.toMatch(/\.from\(\s*['"]wads['"]\s*\)\s*\.delete\(/);
    }
  });
});

describe("DEC-007 / PAY-009 admin endpoint contract", () => {
  const ADMIN = [
    "admin-refund-approve","admin-refund-decline",
    "admin-payment-dispute-record","admin-payment-dispute-resolve-won","admin-payment-dispute-resolve-lost",
    "admin-billing-hold-apply","admin-billing-hold-release",
  ];
  it.each(ADMIN)("%s requires platform_admin + AAL2 + reason", (fn) => {
    const s = fs.readFileSync(`supabase/functions/${fn}/index.ts`, "utf8");
    expect(s).toContain("is_admin");
    expect(s).toContain("NOT_PLATFORM_ADMIN");
    expect(s).toContain("assertAal2");
    expect(s).toContain("MFA_REQUIRED");
    expect(s).toContain("REASON_REQUIRED");
    expect(s).toMatch(/min\(20\)/);
  });
});

describe("DEC-007 / PAY-009 migration shape", () => {
  it("creates refund_requests + payment_disputes + payment_dispute_affected_burns and billing_hold columns", () => {
    const dir = "supabase/migrations";
    const all = fs.readdirSync(dir).map(f => fs.readFileSync(`${dir}/${f}`, "utf8")).join("\n");
    expect(all).toMatch(/CREATE TABLE IF NOT EXISTS public\.refund_requests/);
    expect(all).toMatch(/CREATE TABLE IF NOT EXISTS public\.payment_disputes/);
    expect(all).toMatch(/CREATE TABLE IF NOT EXISTS public\.payment_dispute_affected_burns/);
    expect(all).toMatch(/billing_hold BOOLEAN NOT NULL DEFAULT false/);
    expect(all).toMatch(/REVOKE EXECUTE ON FUNCTION public\.approve_refund/);
    expect(all).toMatch(/GRANT EXECUTE ON FUNCTION public\.approve_refund.*TO service_role/);
  });
});
