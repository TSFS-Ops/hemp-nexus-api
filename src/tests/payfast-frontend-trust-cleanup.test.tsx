/**
 * Frontend trust cleanup — verifies customer surfaces no longer leak
 * Paystack branding, paystack_reference values, or "settlement" wording,
 * while admin surfaces retain the legacy/internal labels.
 *
 * Covers:
 *   1. Public Pricing page footnote does not mention Paystack.
 *   2. Non-admin PurchasesList never renders "Paystack" (badge, "via",
 *      tooltip) or a raw paystack_reference for a legacy row.
 *   3. Non-admin refund-approved tooltip contains neither "Paystack" nor
 *      "settlement".
 *   4. Admin PurchasesList retains "Paystack" gated as legacy/internal.
 *   5. Legacy src/pages/Billing.tsx no longer contains the two
 *      customer-facing Paystack copy strings (guard against re-mount).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async () => ({
        data: {
          success: true,
          purchases: [
            {
              id: "pf-1",
              package_id: "pack_10",
              token_amount: 10,
              amount_usd: 10,
              status: "completed",
              created_at: "2026-07-01T00:00:00Z",
              paystack_reference: "unused-pf",
              provider: "payfast",
              provider_reference: "PFREF123",
            },
            {
              id: "ps-1",
              package_id: "pack_10",
              token_amount: 10,
              amount_usd: 10,
              status: "completed",
              created_at: "2026-06-01T00:00:00Z",
              paystack_reference: "PSREF999",
              provider: "paystack",
              provider_reference: null,
            },
          ],
          pending_refunds: [],
          blocked_refunds: [],
          resolved_refunds: [
            {
              id: "r-1",
              token_purchase_id: "pf-1",
              status: "approved",
              reviewed_at: "2026-07-02T00:00:00Z",
              decision_reason: null,
              created_at: "2026-07-02T00:00:00Z",
            },
          ],
        },
        error: null,
      })),
    },
  },
}));

import { useAuth } from "@/contexts/AuthContext";
import { PurchasesList } from "@/components/desk/billing/PurchasesList";

const renderList = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PurchasesList orgId="org-1" />
    </QueryClientProvider>,
  );
};

afterEach(() => cleanup());

describe("Pricing page — no Paystack leakage", () => {
  it("public Pricing.tsx footnote does not mention Paystack", () => {
    const src = readFileSync(resolve("src/pages/Pricing.tsx"), "utf8");
    expect(src).not.toMatch(/Paystack/i);
  });
});

describe("Legacy Billing.tsx — customer copy scrubbed", () => {
  it("does not contain the removed customer-facing Paystack strings", () => {
    const src = readFileSync(resolve("src/pages/Billing.tsx"), "utf8");
    expect(src).not.toMatch(/Paystack receipt/);
    expect(src).not.toMatch(/Payments processed securely by Paystack/);
  });
});

describe("PurchasesList — non-admin customer view", () => {
  it("never renders 'Paystack', 'settlement', or a raw paystack_reference", async () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ isAdmin: false });
    renderList();
    await screen.findByTestId("billing-purchase-row-pf-1");
    // Whole rendered surface — no Paystack, no settlement wording.
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/Paystack/i);
    expect(body).not.toMatch(/settlement/i);
    // Legacy paystack_reference value must not appear as a visible ref.
    const legacyRef = screen.getByTestId("billing-purchase-ref-ps-1");
    expect(legacyRef.textContent).not.toBe("PSREF999");
    // Admin-named tooltip must be absent.
    expect(document.querySelector('[title*="paystack" i]')).toBeNull();
  });

  it("refund-approved badge tooltip does not mention Paystack or settlement", async () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ isAdmin: false });
    renderList();
    const badge = await screen.findByTestId("refund-resolved-pf-1");
    const tip = badge.getAttribute("title") ?? "";
    expect(tip).not.toMatch(/Paystack/i);
    expect(tip).not.toMatch(/settlement/i);
    expect(badge.textContent ?? "").not.toMatch(/settlement/i);
  });
});

describe("PurchasesList — admin view retains legacy/internal Paystack label", () => {
  it("shows 'Paystack · legacy/internal' badge for admins", async () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ isAdmin: true });
    renderList();
    const badge = await screen.findByTestId("billing-purchase-provider-ps-1");
    expect(badge.textContent).toMatch(/Paystack/);
    expect(badge.textContent).toMatch(/legacy\/internal/);
    expect(badge.getAttribute("data-admin-only")).toBe("true");
    // Admin approved-refund tooltip keeps the operational wording.
    const refundBadge = await screen.findByTestId("refund-resolved-pf-1");
    expect(refundBadge.getAttribute("title") ?? "").toMatch(/settlement pending/i);
  });
});
