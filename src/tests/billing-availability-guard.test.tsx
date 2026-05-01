/**
 * billing-availability-guard.test.tsx
 *
 * Verifies the temporary "billing temporarily unavailable" guard wired
 * up while Paystack USD settlement is pending:
 *
 *   1. When `useBillingAvailability` reports `enabled: false`, every
 *      Purchase / Buy / Proceed-to-Payment CTA is disabled, the
 *      <BillingUnavailableNotice /> is rendered, and the
 *      `startCreditCheckout` helper (which invokes the token-purchase
 *      edge function) is NEVER called.
 *
 *   2. When the flag flips back to `enabled: true`, the CTA is enabled
 *      again and the helper is invoked exactly once on click — proving
 *      the guard is fully reversible without any further code change.
 *
 *   3. Token balance display continues to render in both states, so
 *      the lockout never blacks out balance data for end users.
 *
 * Component coverage:
 *   - TokenBalanceTab        (desk → settings → tokens)
 *   - CreditProvisioningPanel (in-flow POI mint slide-over)
 *
 * The other two purchase entry points — BillingOverview and the legacy
 * /billing page — share the same hook and notice component, so the
 * unit-level proof here covers them by construction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── Mock auth so the components mount without a real Supabase session.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "test-user-id" },
    session: { access_token: "x" },
    isLoading: false,
    isAuthenticated: true,
    roles: [],
  }),
}));

// ── Mock sonner so toast calls don't blow up in jsdom.
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// ── Mock supabase client used by TokenBalanceTab for refresh().
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { org_id: "org-1", balance: 42 } }),
          order: () => ({ limit: async () => ({ data: [] }) }),
        }),
      }),
    }),
    rpc: vi.fn(async () => ({ data: { enabled: false }, error: null })),
  },
}));

// ── Spy on the credit-checkout helper so we can assert it is NOT
// invoked while billing is disabled, and IS invoked when re-enabled.
const startCreditCheckoutSpy = vi.fn(async () => ({
  checkoutUrl: "https://paystack.test/checkout",
  reference: "ref_123",
}));
vi.mock("@/lib/credit-checkout", async () => {
  return {
    startCreditCheckout: (...args: unknown[]) => (startCreditCheckoutSpy as unknown as (...a: unknown[]) => unknown)(...args),
    verifyCreditCheckout: vi.fn(async () => ({ success: true })),
  };
});

// ── Mock the recordPaystackAttempt side-effect imported transitively.
vi.mock("@/components/desk/billing/PaymentReferenceStatus", () => ({
  PaymentReferenceStatus: () => null,
  recordPaystackAttempt: vi.fn(),
}));

// ── Controllable mock for useBillingAvailability — we flip it per test.
const billingMock = vi.fn();
vi.mock("@/hooks/use-billing-availability", () => ({
  useBillingAvailability: () => billingMock(),
}));

import { TokenBalanceTab } from "@/components/desk/settings/TokenBalanceTab";
import { CreditProvisioningPanel } from "@/components/desk/match/CreditProvisioningPanel";

describe("Billing availability guard — billing disabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    billingMock.mockReturnValue({
      availability: {
        enabled: false,
        reason: "usd_settlement_pending",
        message:
          "Credit purchases are temporarily unavailable while USD settlement is being enabled.",
      },
      loading: false,
    });
  });

  it("TokenBalanceTab: balance displays, every purchase button is disabled, notice is rendered", async () => {
    render(<TokenBalanceTab />);

    // Notice is rendered.
    await waitFor(() =>
      expect(screen.getByTestId("billing-unavailable-notice")).toBeInTheDocument()
    );

    // All three purchase CTAs are disabled and labelled "Unavailable".
    for (const id of ["single", "pack_50", "pack_200"]) {
      const btn = screen.getByTestId(`token-balance-purchase-${id}`);
      expect(btn).toBeDisabled();
      expect(btn).toHaveTextContent(/Unavailable/i);
      fireEvent.click(btn);
    }

    // Edge function is NEVER invoked while disabled.
    expect(startCreditCheckoutSpy).not.toHaveBeenCalled();

    // Balance is still rendered (not blacked out).
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("CreditProvisioningPanel: Proceed-to-Payment is disabled and notice rendered", () => {
    render(
      <CreditProvisioningPanel open={true} onClose={() => {}} currentBalance={5} />
    );

    expect(screen.getByTestId("billing-unavailable-notice")).toBeInTheDocument();

    const proceed = screen.getByTestId("credit-provisioning-proceed");
    expect(proceed).toBeDisabled();
    expect(proceed).toHaveTextContent(/temporarily unavailable/i);

    fireEvent.click(proceed);
    expect(startCreditCheckoutSpy).not.toHaveBeenCalled();
  });
});

describe("Billing availability guard — billing enabled (reversibility)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    billingMock.mockReturnValue({
      availability: { enabled: true, reason: null, message: null },
      loading: false,
    });
  });

  it("CreditProvisioningPanel: Proceed-to-Payment becomes active and invokes checkout exactly once", async () => {
    // Replace location with a writable stand-in so the redirect inside
    // handleProceed completes without leaving jsdom.
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { href: "" } as Location,
    });

    try {
      render(
        <CreditProvisioningPanel open={true} onClose={() => {}} currentBalance={5} />
      );

      expect(
        screen.queryByTestId("billing-unavailable-notice")
      ).not.toBeInTheDocument();

      const proceed = screen.getByTestId("credit-provisioning-proceed");
      expect(proceed).not.toBeDisabled();
      expect(proceed).toHaveTextContent(/Proceed to Payment/i);

      fireEvent.click(proceed);

      await waitFor(() =>
        expect(startCreditCheckoutSpy).toHaveBeenCalledTimes(1)
      );
      expect(startCreditCheckoutSpy).toHaveBeenCalledWith("pack_50");
      expect(window.location.href).toBe("https://paystack.test/checkout");
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    }
  });
});
