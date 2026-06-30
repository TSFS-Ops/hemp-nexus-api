/**
 * PaymentMethodPicker — Phase 2J.
 *
 * Renders the customer-facing payment method choice for a single
 * credit pack on the Billing page:
 *
 *   • Paystack (USD) — default, unchanged path via
 *     `startCreditCheckout`. Always visible.
 *   • PayFast (ZAR)  — fixed ZAR price. Visible only when the
 *     `payfast-checkout-public` availability probe reports available.
 *
 * Izenzo performs no currency conversion. The displayed Paystack and
 * PayFast amounts are the actual amounts each provider will charge.
 *
 * PayFast credits are issued ONLY by the verified ITN handler.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  startCreditCheckout,
  type CreditPackageId,
} from "@/lib/credit-checkout";
import {
  startPayfastPublicCheckout,
  submitPayfastForm,
  PAYFAST_ZAR_PRICES,
  type PayfastCustomerPackageId,
} from "@/lib/credit-checkout-payfast";
import { usePayfastPublicAvailability } from "@/hooks/use-payfast-public-availability";

/**
 * PAYFAST_PUBLIC_PRICING_CONFIRMED — flip to `true` only once the
 * client has signed off the fixed ZAR price table that corresponds to
 * the $10/credit USD correction (David, 2026-06). While `false`, the
 * customer-facing PayFast button is hidden so users cannot buy at the
 * old ZAR amounts. ITN/webhook crediting paths are unchanged.
 */
const PAYFAST_PUBLIC_PRICING_CONFIRMED = false;

const INK_GREEN = "hsl(155 35% 22%)";
const INK_GREEN_HOVER = "hsl(155 35% 16%)";

interface PaymentMethodPickerProps {
  packageId: CreditPackageId;
  usdPrice: string;
  disabled?: boolean;
  onError?: (message: string) => void;
}

function isPayfastEligible(id: CreditPackageId): id is PayfastCustomerPackageId {
  return id === "single" || id === "pack_10" || id === "pack_50" || id === "pack_200";
}

function formatZar(amount: number): string {
  return `R${amount.toLocaleString("en-ZA", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function PaymentMethodPicker({
  packageId,
  usdPrice,
  disabled,
  onError,
}: PaymentMethodPickerProps) {
  const payfast = usePayfastPublicAvailability();
  const [busy, setBusy] = useState<"paystack" | "payfast" | null>(null);
  const showPayfast = payfast.available && isPayfastEligible(packageId);
  const zar = isPayfastEligible(packageId) ? PAYFAST_ZAR_PRICES[packageId] : 0;

  const handlePaystack = async () => {
    if (busy || disabled) return;
    setBusy("paystack");
    try {
      const { checkoutUrl } = await startCreditCheckout(packageId);
      window.location.href = checkoutUrl;
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Could not start Paystack checkout.";
      onError?.(msg);
      toast.error(msg);
      setBusy(null);
    }
  };

  const handlePayfast = async () => {
    if (busy || disabled || !isPayfastEligible(packageId)) return;
    setBusy("payfast");
    try {
      const { checkoutUrl, formFields } = await startPayfastPublicCheckout(
        packageId,
      );
      submitPayfastForm(checkoutUrl, formFields);
      // Navigation away handles the rest; reset busy in case PayFast
      // does not navigate (browser blocked submit etc.).
      setTimeout(() => setBusy(null), 4000);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Could not start PayFast checkout.";
      onError?.(msg);
      toast.error(msg);
      setBusy(null);
    }
  };

  return (
    <div
      className="space-y-2"
      data-testid={`payment-method-picker-${packageId}`}
    >
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={handlePaystack}
          disabled={!!busy || disabled}
          data-testid={`pay-paystack-${packageId}`}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-sm text-sm font-medium text-white transition-colors w-full sm:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ backgroundColor: INK_GREEN }}
          onMouseEnter={(e) => {
            if (!busy && !disabled) e.currentTarget.style.backgroundColor = INK_GREEN_HOVER;
          }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = INK_GREEN; }}
        >
          {busy === "paystack" ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Redirecting…</>
          ) : (
            <>Pay {usdPrice} via Paystack</>
          )}
        </button>

        {showPayfast && (
          <button
            type="button"
            onClick={handlePayfast}
            disabled={!!busy || disabled}
            data-testid={`pay-payfast-${packageId}`}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-sm text-sm font-medium border transition-colors w-full sm:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              borderColor: INK_GREEN,
              color: INK_GREEN,
              backgroundColor: "transparent",
            }}
          >
            {busy === "payfast" ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Redirecting…</>
            ) : (
              <>Pay {formatZar(zar)} via PayFast</>
            )}
          </button>
        )}
      </div>

      {showPayfast && (
        <p
          className="font-mono text-[10px] tracking-wide text-muted-foreground/80"
          data-testid={`payment-method-no-fx-note-${packageId}`}
        >
          PayFast charges in ZAR. Paystack charges in USD. Izenzo performs
          no currency conversion — the price shown is the price charged.
        </p>
      )}
    </div>
  );
}
