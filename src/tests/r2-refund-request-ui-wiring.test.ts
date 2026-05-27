/**
 * DEC-007 — Batch R2 — Org-side Refund Request UI wiring guard.
 *
 * Static, dependency-free regression test ensuring:
 *  1. RefundRequestDialog and PurchasesList exist and reference the
 *     existing refund-request edge function with the documented payload
 *     (token_purchase_id / reason_code / reason_detail).
 *  2. Reason codes match the canonical DEC-007 SSOT.
 *  3. Min reason length matches the DEC-007 SSOT (20).
 *  4. /desk/billing page mounts <PurchasesList />.
 *  5. UI never calls live provider refund endpoints (Paystack, etc.).
 *  6. UI never renders admin approve/decline controls on the org page.
 *  7. Disclaimer copy is present and honest about no live provider refund.
 *  8. Pending refund state is rendered and blocks duplicate request.
 *  9. Eligibility check is restricted to status === 'completed'.
 * 10. New list-org-purchases edge function is registered in deploy
 *     manifest and is read-only (no provider mutation).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  REFUND_REASON_CODES,
  DEC_007_REFUND_POLICY,
} from "@/lib/policy/dec-007-refund-policy";

const DIALOG = readFileSync(
  resolve(__dirname, "../components/desk/billing/RefundRequestDialog.tsx"),
  "utf8",
);
const LIST = readFileSync(
  resolve(__dirname, "../components/desk/billing/PurchasesList.tsx"),
  "utf8",
);
const BILLING = readFileSync(
  resolve(__dirname, "../pages/Billing.tsx"),
  "utf8",
);
const BILLING_OVERVIEW = readFileSync(
  resolve(__dirname, "../components/desk/billing/BillingOverview.tsx"),
  "utf8",
);
const DESK = readFileSync(
  resolve(__dirname, "../pages/Desk.tsx"),
  "utf8",
);
const EDGE = readFileSync(
  resolve(__dirname, "../../supabase/functions/list-org-purchases/index.ts"),
  "utf8",
);
const MANIFEST = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../scripts/edge-function-deploy-manifest.json"),
    "utf8",
  ),
) as { required: string[] };

describe("DEC-007 / R2 — org-side refund request UI wiring", () => {
  it("dialog invokes the refund-request edge function", () => {
    expect(DIALOG).toMatch(/supabase\.functions\.invoke\(\s*["']refund-request["']/);
  });

  it("dialog payload carries token_purchase_id, reason_code, reason_detail", () => {
    expect(DIALOG).toMatch(/token_purchase_id/);
    expect(DIALOG).toMatch(/reason_code/);
    expect(DIALOG).toMatch(/reason_detail/);
  });

  it("dialog uses DEC-007 reason codes SSOT (not hardcoded)", () => {
    expect(DIALOG).toMatch(/REFUND_REASON_CODES/);
    // SSOT must contain the six canonical codes
    expect(REFUND_REASON_CODES).toContain("unused_within_window");
    expect(REFUND_REASON_CODES).toContain("other");
  });

  it("dialog enforces the SSOT min reason-detail length (20)", () => {
    expect(DEC_007_REFUND_POLICY.minAdminReasonLength).toBe(20);
    // The SSOT constant is the one wired into the dialog
    expect(DIALOG).toMatch(/DEC_007_REFUND_POLICY/);
    expect(DIALOG).toMatch(/minAdminReasonLength/);
  });

  it("dialog disclaims that no live provider refund is triggered", () => {
    expect(DIALOG).toMatch(/does not trigger a\s*\n?\s*live provider refund/);
  });

  it("dialog shows success copy 'Refund request submitted for review.'", () => {
    expect(DIALOG).toMatch(/Refund request submitted for review\./);
  });

  it("PurchasesList exposes the 'Request refund' button only for completed purchases", () => {
    expect(LIST).toMatch(/Request refund/);
    expect(LIST).toMatch(/p\.status === ["']completed["']/);
  });

  it("PurchasesList renders pending state and blocks duplicate request", () => {
    expect(LIST).toMatch(/Refund request pending/);
    expect(LIST).toMatch(/hasPending\s*\?/);
  });

  it("PurchasesList loads via the read-only list-org-purchases edge function", () => {
    expect(LIST).toMatch(/supabase\.functions\.invoke\(\s*["']list-org-purchases["']/);
  });

  it("Billing page (legacy /billing) mounts <PurchasesList />", () => {
    expect(BILLING).toMatch(/import\s*\{\s*PurchasesList\s*\}\s*from\s*["']@\/components\/desk\/billing\/PurchasesList["']/);
    expect(BILLING).toMatch(/<PurchasesList\s+orgId=\{billingProfile\?\.org_id\}\s*\/>/);
  });

  it("R2B — /desk/billing route renders <BillingOverview />", () => {
    // src/pages/Desk.tsx must mount BillingOverview at the billing route.
    expect(DESK).toMatch(/path=["']billing["']\s+element=\{<BillingOverview\s*\/>\}/);
    expect(DESK).toMatch(/import\s*\{\s*BillingOverview\s*\}\s*from\s*["']@\/components\/desk\/billing\/BillingOverview["']/);
  });

  it("R2B — BillingOverview (actual /desk/billing surface) mounts <PurchasesList />", () => {
    // Regression guard: PurchasesList must live in the rendered route,
    // not only in the orphaned src/pages/Billing.tsx shell.
    expect(BILLING_OVERVIEW).toMatch(/import\s*\{\s*PurchasesList\s*\}\s*from\s*["']\.\/PurchasesList["']/);
    expect(BILLING_OVERVIEW).toMatch(/<PurchasesList\s+orgId=\{orgId\s*\?\?\s*undefined\}\s*\/>/);
  });

  it("R2B — BillingOverview preserves existing sections (Provisioning / Usage History / Balance)", () => {
    expect(BILLING_OVERVIEW).toMatch(/Provisioning/);
    expect(BILLING_OVERVIEW).toMatch(/Usage History/);
    expect(BILLING_OVERVIEW).toMatch(/Available Balance/);
    expect(BILLING_OVERVIEW).toMatch(/PaymentReferenceStatus/);
  });

  it("no client-side surface calls Paystack or any provider refund directly", () => {
    for (const src of [DIALOG, LIST, BILLING, BILLING_OVERVIEW]) {
      expect(src).not.toMatch(/paystack\.com/i);
      expect(src).not.toMatch(/api\.paystack/i);
      expect(src).not.toMatch(/transaction\/refund/i);
    }
  });

  it("org refund UI does NOT call admin approve/decline endpoints", () => {
    for (const src of [DIALOG, LIST, BILLING, BILLING_OVERVIEW]) {
      expect(src).not.toMatch(/admin-refund-approve/);
      expect(src).not.toMatch(/admin-refund-decline/);
      expect(src).not.toMatch(/AdminBillingReviewPanel/);
    }
  });

  it("list-org-purchases is read-only and registered in deploy manifest", () => {
    expect(MANIFEST.required).toContain("list-org-purchases");
    // read-only: no insert/update/delete/upsert/rpc
    expect(EDGE).not.toMatch(/\.insert\(/);
    expect(EDGE).not.toMatch(/\.update\(/);
    expect(EDGE).not.toMatch(/\.delete\(/);
    expect(EDGE).not.toMatch(/\.upsert\(/);
    expect(EDGE).not.toMatch(/\.rpc\(/);
    // requires bearer auth
    expect(EDGE).toMatch(/Bearer/);
    expect(EDGE).toMatch(/auth\.getUser\(\)/);
  });
});
