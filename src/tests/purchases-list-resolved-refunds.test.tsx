/**
 * Batch 1 fix #2/#3 — PurchasesList surfaces resolved refund outcomes and
 * pagination truncation.
 *
 * Proves:
 *   1. Approved refund renders a `refund-resolved-<id>` badge with copy
 *      "Refund approved" — resolved outcomes no longer silently
 *      disappear from the user's view.
 *   2. Declined refund renders with copy "Refund declined".
 *   3. Pending refund still suppresses the resolved badge (pending wins).
 *   4. Blocked refund (PAY009) still renders unchanged.
 *   5. When pagination.has_more is true a truncation notice is rendered
 *      so the user knows older rows are not silently hidden.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import { PurchasesList } from "@/components/desk/billing/PurchasesList";

const P_APPROVED = "11111111-1111-4111-8111-111111111111";
const P_DECLINED = "22222222-2222-4222-8222-222222222222";
const P_PENDING = "33333333-3333-4333-8333-333333333333";
const P_BLOCKED = "44444444-4444-4444-8444-444444444444";
const P_ELIGIBLE = "55555555-5555-4555-8555-555555555555";

function purchase(id: string) {
  return {
    id,
    package_id: "pack_10",
    token_amount: 10,
    amount_usd: 10,
    status: "completed",
    created_at: "2026-05-20T10:00:00Z",
    paystack_reference: `ref-${id.slice(0, 6)}`,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("PurchasesList — resolved refund visibility", () => {
  it("renders resolved approved/declined badges, preserves pending+blocked, and shows truncation notice", async () => {
    invoke.mockResolvedValue({
      data: {
        success: true,
        purchases: [
          purchase(P_APPROVED),
          purchase(P_DECLINED),
          purchase(P_PENDING),
          purchase(P_BLOCKED),
          purchase(P_ELIGIBLE),
        ],
        pending_refunds: [{ token_purchase_id: P_PENDING, status: "pending" }],
        blocked_refunds: [
          {
            token_purchase_id: P_BLOCKED,
            status: "blocked_credits_used",
            created_at: "2026-05-21T10:00:00Z",
          },
        ],
        resolved_refunds: [
          {
            id: "rr-1",
            token_purchase_id: P_APPROVED,
            status: "approved",
            reviewed_at: "2026-05-22T10:00:00Z",
            decision_reason: "Refunded in full",
            created_at: "2026-05-21T10:00:00Z",
          },
          {
            id: "rr-2",
            token_purchase_id: P_DECLINED,
            status: "declined",
            reviewed_at: "2026-05-22T10:00:00Z",
            decision_reason: "Outside policy window",
            created_at: "2026-05-21T10:00:00Z",
          },
        ],
        pagination: { limit: 25, offset: 0, total_count: 60, has_more: true },
      },
      error: null,
    });

    renderWithClient(<PurchasesList orgId="org-1" />);

    // Approved + declined badges visible.
    expect(
      await screen.findByTestId(`refund-resolved-${P_APPROVED}`),
    ).toHaveTextContent(/Refund approved/i);
    expect(screen.getByTestId(`refund-resolved-${P_DECLINED}`)).toHaveTextContent(
      /Refund declined/i,
    );

    // Pending row still shows pending badge — pending wins over resolved.
    expect(screen.getByTestId(`refund-pending-${P_PENDING}`)).toBeInTheDocument();
    expect(
      screen.queryByTestId(`refund-resolved-${P_PENDING}`),
    ).not.toBeInTheDocument();

    // Blocked row still renders unchanged (PAY009 behaviour preserved).
    expect(screen.getByTestId(`refund-blocked-${P_BLOCKED}`)).toHaveTextContent(
      /credits already used/i,
    );

    // Eligible row still offers Request refund.
    expect(
      screen.getByTestId(`refund-request-button-${P_ELIGIBLE}`),
    ).toBeInTheDocument();

    // Truncation notice rendered when has_more is true.
    expect(
      screen.getByTestId("billing-purchases-truncated-notice"),
    ).toHaveTextContent(/25.*60/);
  });
});
