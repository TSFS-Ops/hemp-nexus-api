/**
 * PayFast Frontend Trust Cleanup -- regression guards.
 *
 * Confirms:
 * 1. Pricing.tsx no longer contains public Paystack checkout copy.
 * 2. Legacy Billing.tsx no longer contains customer-visible Paystack
 *    strings.
 * 3. Non-admin PurchasesList never renders "Paystack", "via Paystack", or
 *    a raw paystack_reference value; legacy rows show neutral "card
 *    checkout" wording and a masked "Payment reference" instead.
 * 4. Admin PurchasesList retains "Paystack · legacy/internal" behind a
 *    data-admin-only="true" gate.
 * 5. PayFast rows render identically for both admin and non-admin
 *    viewers.
 * 6. The non-admin refund-approved tooltip uses safe wording and never
 *    mentions Paystack or "settlement"; admins retain the operational
 *    wording.
 * 7. No ZAR / FX-rate / bank-settlement wording is introduced on the
 *    customer-facing PurchasesList surface.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "@testing-library/jest-dom/vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "@/contexts/AuthContext";
import { PurchasesList } from "@/components/desk/billing/PurchasesList";

function mockAuth(isAdmin: boolean) {
  (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ isAdmin });
}

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const PF_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PS_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function mockPurchasesResponse(overrides: { resolved_refunds?: unknown[] } = {}) {
  invoke.mockResolvedValue({
    data: {
      success: true,
      purchases: [
        {
          id: PF_ID,
          package_id: "single",
          token_amount: 1,
          amount_usd: 10,
          status: "completed",
          created_at: "2026-07-01T10:00:00Z",
          paystack_reference: "payfast_live::izpf_900",
          provider: "payfast",
          provider_reference: "izpf_900",
        },
        {
          id: PS_ID,
          package_id: "single",
          token_amount: 1,
          amount_usd: 10,
          status: "completed",
          created_at: "2026-06-15T10:00:00Z",
          paystack_reference: "ps_ref_secret_9182",
          provider: "paystack",
          provider_reference: null,
        },
      ],
      pending_refunds: [],
      blocked_refunds: [],
      resolved_refunds: overrides.resolved_refunds ?? [],
    },
    error: null,
  });
}

describe("Pricing.tsx -- no public Paystack checkout copy", () => {
  const PRICING_SRC = readFileSync(resolve("src/pages/Pricing.tsx"), "utf8");

  it("does not mention Paystack anywhere in the page", () => {
    expect(PRICING_SRC).not.toMatch(/Paystack/i);
  });

  it("describes checkout as PayFast for customers", () => {
    expect(PRICING_SRC).toMatch(/purchased securely through PayFast/i);
  });
});

describe("Billing.tsx (legacy) -- no customer-visible Paystack strings", () => {
  const BILLING_SRC = readFileSync(resolve("src/pages/Billing.tsx"), "utf8");

  it("does not render Paystack in customer-facing receipt/success copy", () => {
    expect(BILLING_SRC).not.toMatch(/receipt from our checkout provider[^"]*Paystack/is);
    expect(BILLING_SRC).not.toMatch(/Payments processed securely (by|via) Paystack/i);
  });

  it("uses PayFast wording for the customer-facing security copy", () => {
    expect(BILLING_SRC).toMatch(/Payments processed securely through PayFast/i);
  });
});

describe("PurchasesList -- non-admin customer view", () => {
  it("never renders the word Paystack, \u0027via Paystack\u0027, or a raw paystack_reference", async () => {
    mockAuth(false);
    mockPurchasesResponse();
    renderWithClient(<PurchasesList orgId="org-1" />);

    const psRow = await screen.findByTestId(`billing-purchase-row-${PS_ID}`);
    expect(psRow.textContent).not.toMatch(/Paystack/i);
    expect(psRow.textContent).not.toMatch(/via Paystack/i);
    expect(psRow.textContent).not.toMatch(/ps_ref_secret_9182/);
    expect(psRow.textContent).toMatch(/via card checkout/i);

    const badge = screen.getByTestId(`billing-purchase-provider-${PS_ID}`);
    expect(badge.textContent).toBe("Card");
    expect(badge.getAttribute("data-admin-only")).toBeNull();

    const refCode = screen.getByTestId(`billing-purchase-ref-${PS_ID}`);
    expect(refCode.getAttribute("data-admin-only")).toBeNull();
    expect(refCode.textContent).not.toMatch(/ps_ref_secret_9182/);
    expect(refCode.getAttribute("title")).toBe("Payment reference");
    cleanup();
  });

  it("still shows PayFast rows correctly", async () => {
    mockAuth(false);
    mockPurchasesResponse();
    renderWithClient(<PurchasesList orgId="org-1" />);
    const pfRow = await screen.findByTestId(`billing-purchase-row-${PF_ID}`);
    expect(pfRow.textContent).toMatch(/\$10\.00 USD via PayFast/);
    const badge = screen.getByTestId(`billing-purchase-provider-${PF_ID}`);
    expect(badge.textContent).toBe("PayFast");
    cleanup();
  });

  it("introduces no ZAR / rate / settlement wording on the customer surface", async () => {
    mockAuth(false);
    mockPurchasesResponse();
    renderWithClient(<PurchasesList orgId="org-1" />);
    const card = await screen.findByTestId("billing-purchases-card");
    expect(card.textContent).not.toMatch(/ZAR/);
    expect(card.textContent).not.toMatch(/settlement/i);
    expect(card.textContent).not.toMatch(/exchange rate/i);
    cleanup();
  });

  it("shows safe wording for an approved refund, with no Paystack/settlement mention", async () => {
    mockAuth(false);
    mockPurchasesResponse({
      resolved_refunds: [
        {
          id: "r1",
          token_purchase_id: PS_ID,
          status: "approved",
          reviewed_at: "2026-07-02T10:00:00Z",
          decision_reason: null,
          created_at: "2026-07-02T10:00:00Z",
        },
      ],
    });
    renderWithClient(<PurchasesList orgId="org-1" />);
    const resolvedBadge = await screen.findByTestId(`refund-resolved-${PS_ID}`);
    expect(resolvedBadge.textContent).toBe("Refund approved");
    const tooltip = resolvedBadge.getAttribute("title") ?? "";
    expect(tooltip).not.toMatch(/Paystack/i);
    expect(tooltip).not.toMatch(/settlement/i);
    expect(tooltip).toMatch(/original payment method/i);
    cleanup();
  });
});

describe("PurchasesList -- admin view retains legacy Paystack visibility", () => {
  it("shows \u0027Paystack · legacy/internal\u0027 behind a data-admin-only gate", async () => {
    mockAuth(true);
    mockPurchasesResponse();
    renderWithClient(<PurchasesList orgId="org-1" />);
    const badge = await screen.findByTestId(`billing-purchase-provider-${PS_ID}`);
    expect(badge.textContent).toMatch(/Paystack.*legacy\/internal/);
    expect(badge.getAttribute("data-admin-only")).toBe("true");

    const refCode = screen.getByTestId(`billing-purchase-ref-${PS_ID}`);
    expect(refCode.getAttribute("data-admin-only")).toBe("true");
    expect(refCode.textContent).toMatch(/ps_ref_secret_9182/);
    cleanup();
  });

  it("keeps operational wording on the approved-refund tooltip for admins", async () => {
    mockAuth(true);
    mockPurchasesResponse({
      resolved_refunds: [
        {
          id: "r1",
          token_purchase_id: PS_ID,
          status: "approved",
          reviewed_at: "2026-07-02T10:00:00Z",
          decision_reason: null,
          created_at: "2026-07-02T10:00:00Z",
        },
      ],
    });
    renderWithClient(<PurchasesList orgId="org-1" />);
    const resolvedBadge = await screen.findByTestId(`refund-resolved-${PS_ID}`);
    const tooltip = resolvedBadge.getAttribute("title") ?? "";
    expect(tooltip).toMatch(/Paystack/i);
    cleanup();
  });
});
