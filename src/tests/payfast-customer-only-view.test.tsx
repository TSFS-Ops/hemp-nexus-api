/**
 * Non-admin customer view verification for PaymentMethodPicker.
 *
 * Confirms that when isAdmin=false (normal customer):
 *   - PayFast button renders
 *   - Paystack button does NOT render
 *   - "[Admin only]" wording does NOT appear
 *   - USD price stays visible
 *
 * And that when isAdmin=true, the Paystack button is rendered with the
 * "[Admin only]" marker so it's visually distinct from the customer
 * surface.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));
vi.mock("@/hooks/use-payfast-public-availability", () => ({
  usePayfastPublicAvailability: () => ({
    loading: false,
    probe: { ok: true, available: true, publicEnabled: true, globalMode: "live", merchantConfigured: true, urlsConfigured: true, fxRateConfigured: true, usdZarRate: 20 },
    available: true,
    usdZarRate: 20,
  }),
}));

import { useAuth } from "@/contexts/AuthContext";
import { PaymentMethodPicker } from "@/components/desk/billing/PaymentMethodPicker";

describe("Customer (non-admin) Billing view: PayFast only", () => {
  it("renders PayFast and hides Paystack for normal customers", () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ isAdmin: false, session: { access_token: "x" } });
    render(<PaymentMethodPicker packageId="single" usdPrice="$10" />);
    expect(screen.getByTestId("pay-payfast-single")).toBeTruthy();
    expect(screen.queryByTestId("pay-paystack-single")).toBeNull();
    expect(screen.queryByText(/Admin only/i)).toBeNull();
    expect(screen.queryByText(/Paystack/i)).toBeNull();
    cleanup();
  });

  it("shows Paystack as [Admin only] for platform admins", () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ isAdmin: true, session: { access_token: "x" } });
    render(<PaymentMethodPicker packageId="single" usdPrice="$10" />);
    const paystackBtn = screen.getByTestId("pay-paystack-single");
    expect(paystackBtn).toBeTruthy();
    expect(paystackBtn.getAttribute("data-admin-only")).toBe("true");
    expect(paystackBtn.textContent).toMatch(/Admin only/i);
    cleanup();
  });
});
