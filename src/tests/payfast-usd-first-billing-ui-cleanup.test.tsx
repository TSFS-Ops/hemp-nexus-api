/**
 * Phase A - USD-first customer billing UI cleanup guards.
 *
 * Confirms:
 * 1. PurchasesList shows PayFast purchase rows with the USD package
 *    price first ("$X.XX USD via PayFast"), and no longer leads with
 *    "ZAR via PayFast" for normal customers.
 * 2. Paystack rows are unaffected.
 * 3. BillingOverview's customer-facing Provisioning label no longer
 *    reads "USD - Native settlement".
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "@testing-library/jest-dom/vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
    supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/contexts/AuthContext", () => ({
    useAuth: () => ({ isAdmin: false }),
}));

import { PurchasesList } from "@/components/desk/billing/PurchasesList";

const PF_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function renderWithClient(ui: React.ReactElement) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
describe("PurchasesList - USD-first PayFast row wording", () => {
    it("shows the USD amount first for a PayFast row and never leads with ZAR", async () => {
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
                                            created_at: "2026-06-01T10:00:00Z",
                                            paystack_reference: "payfast_live::izpf_001",
                                            provider: "payfast",
                                            provider_reference: "izpf_001",
                              },
                              {
                                            id: PS_ID,
                                            package_id: "single",
                                            token_amount: 1,
                                            amount_usd: 10,
                                            status: "completed",
                                            created_at: "2026-05-30T10:00:00Z",
                                            paystack_reference: "ps_ref_001",
                                            provider: "paystack",
                                            provider_reference: "ps_ref_001",
                              },
                                      ],
                            pending_refunds: [],
                            blocked_refunds: [],
                            resolved_refunds: [],
                  },
                  error: null,
          });

           renderWithClient(<PurchasesList orgId="org-1" />);

           const pfRow = await screen.findByTestId(`billing-purchase-row-${PF_ID}`);
          expect(pfRow.textContent).toMatch(/\$10\.00 USD via PayFast/);
          expect(pfRow.textContent).not.toMatch(/ZAR via PayFast/);

           const psRow = screen.getByTestId(`billing-purchase-row-${PS_ID}`);
          expect(psRow.textContent).toMatch(/\$10\.00 USD via Paystack/);
    });
});

describe("BillingOverview - customer Provisioning label is simplified", () => {
    const BILLING_SRC = readFileSync(
          resolve("src/components/desk/billing/BillingOverview.tsx"),
          "utf8",
        );

           it("no longer reads 'USD - Native settlement'", () => {
                 expect(BILLING_SRC).not.toMatch(/Native settlement/);
           });

           it("uses a simple USD pricing label instead", () => {
                 expect(BILLING_SRC).toMatch(/USD pricing/);
           });
});
