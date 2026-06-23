/**
 * Static wiring guard for the admin-refund-mark-settled edge function and
 * the AdminBillingReviewPanel manual-settlement action.
 *
 * Mirrors src/tests/admin-refund-wiring.test.ts for the new atomic RPC
 * `mark_refund_manually_settled_with_governance`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FN_PATH = resolve(
  __dirname,
  "../../supabase/functions/admin-refund-mark-settled/index.ts",
);
const PANEL_PATH = resolve(
  __dirname,
  "../components/admin/AdminBillingReviewPanel.tsx",
);
const MANIFEST_PATH = resolve(
  __dirname,
  "../../scripts/edge-function-deploy-manifest.json",
);
const WEBHOOK_PATH = resolve(
  __dirname,
  "../../supabase/functions/token-purchase/index.ts",
);
const RECON_PATH = resolve(
  __dirname,
  "../../supabase/functions/transaction-reconciliation/index.ts",
);

const fnSrc = readFileSync(FN_PATH, "utf8");
const panelSrc = readFileSync(PANEL_PATH, "utf8");
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
  required: string[];
};
const webhookSrc = readFileSync(WEBHOOK_PATH, "utf8");
const reconSrc = readFileSync(RECON_PATH, "utf8");

describe("admin-refund-mark-settled F2 atomic wiring", () => {
  it("edge function calls the atomic RPC", () => {
    expect(fnSrc).toMatch(
      /\.rpc\(\s*[\n\s]*["']mark_refund_manually_settled_with_governance["']/,
    );
  });

  it("edge function enforces AAL2 + platform_admin + notes ≥ 20", () => {
    expect(fnSrc).toMatch(/assertAal2/);
    expect(fnSrc).toMatch(/NOT_PLATFORM_ADMIN/);
    expect(fnSrc).toMatch(/min\(\s*20\s*\)/);
  });

  it("edge function does NOT call a provider HTTP refund endpoint", () => {
    expect(fnSrc).not.toMatch(/api\.paystack/i);
    expect(fnSrc).not.toMatch(/api\.payfast/i);
    expect(fnSrc).not.toMatch(/transaction\/refund/i);
    expect(fnSrc).not.toMatch(/fetch\(/);
  });

  it("edge function does NOT mutate token_balances or token_ledger via RPC", () => {
    expect(fnSrc).not.toMatch(/atomic_token_credit/);
    expect(fnSrc).not.toMatch(/atomic_token_burn/);
    expect(fnSrc).not.toMatch(/atomic_paid_credit_purchase/);
    // No direct table writes either
    expect(fnSrc).not.toMatch(/from\(["']token_balances["']\)/);
    expect(fnSrc).not.toMatch(/from\(["']token_ledger["']\)/);
  });

  it("edge function surfaces governance_event_id from the atomic RPC", () => {
    expect(fnSrc).toMatch(/governance_event_id/);
  });

  it("admin-refund-mark-settled is registered in the deploy manifest", () => {
    expect(manifest.required).toContain("admin-refund-mark-settled");
  });
});

describe("AdminBillingReviewPanel manual-settle wiring", () => {
  it("renders settlement-status badge using the SSOT helper", () => {
    expect(panelSrc).toMatch(
      /from\s+["']@\/lib\/policy\/refund-settlement["']/,
    );
    expect(panelSrc).toMatch(/settlementBadgeLabel/);
    expect(panelSrc).toMatch(/isMoneyReturned/);
  });

  it("invokes admin-refund-mark-settled with notes payload", () => {
    expect(panelSrc).toMatch(
      /supabase\.functions\.invoke[\s\S]{0,80}admin-refund-mark-settled/,
    );
    expect(panelSrc).toMatch(/notes:\s*reason/);
  });

  it("shows manual-settle action only for approved + not_submitted", () => {
    expect(panelSrc).toMatch(/status === ["']approved["']/);
    expect(panelSrc).toMatch(/settlement === ["']not_submitted["']/);
  });

  it("uses the dedicated manual-settlement disclaimer copy", () => {
    expect(panelSrc).toMatch(/DEC_007_PAY_009_MANUAL_SETTLEMENT_DISCLAIMER/);
  });
});

describe("Paystack refund webhook routes approved refunds through settlement RPC", () => {
  it("calls mark_refund_provider_settled when a matching approved refund exists", () => {
    expect(webhookSrc).toMatch(
      /\.rpc\(\s*[\n\s]*["']mark_refund_provider_settled["']/,
    );
  });

  it("opens refund_settlement_ambiguous risk item on >1 match", () => {
    expect(webhookSrc).toMatch(/refund_settlement_ambiguous/);
  });

  it("does not silently call PayFast", () => {
    expect(webhookSrc).not.toMatch(/payfast/i);
  });
});

describe("transaction-reconciliation surfaces unsettled refunds", () => {
  it("calls surface_unsettled_refunds with 24h + 100 row bound", () => {
    expect(reconSrc).toMatch(
      /\.rpc\(\s*[\n\s]*["']surface_unsettled_refunds["']/,
    );
    expect(reconSrc).toMatch(/p_min_age_minutes:\s*1440/);
    expect(reconSrc).toMatch(/p_limit:\s*100/);
  });
});
