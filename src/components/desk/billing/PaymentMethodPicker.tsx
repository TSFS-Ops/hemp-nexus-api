/**
 * PaymentMethodPicker — customer-facing payment options.
 *
 * Pricing model
 * ─────────────
 *   • Credits are priced in USD ($10 per credit, no volume discount).
 *   • PayFast is the primary, default customer payment option. It
 *     settles in ZAR, so the ZAR amount sent to PayFast is computed
 *     from the platform-admin-managed USD/ZAR rate at checkout-start
 *     and snapshotted into purchase metadata.
 *   • Paystack is hidden from normal customers by the
 *     `PAYSTACK_PUBLIC_ENABLED` flag below. It is still rendered for
 *     platform admins so the Paystack code path stays warm.
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
  computeDisplayZar,
  PAYFAST_USD_PRICES,
  type PayfastCustomerPackageId,
} from "@/lib/credit-checkout-payfast";
import { usePayfastPublicAvailability } from "@/hooks/use-payfast-public-availability";
import { useAuth } from "@/contexts/AuthContext";

/**
 * PAYFAST_PUBLIC_PRICING_CONFIRMED — historic Phase-2J pause flag.
 * Pricing is now sourced from the FX-locked USD/ZAR rate (which is
 * itself gated by `admin_settings.payfast_usd_zar_rate`), so this
 * constant is no longer the customer gate. Kept exported for the
 * admin review panel.
 */
export const PAYFAST_PUBLIC_PRICING_CONFIRMED = true;

/**
 * PAYSTACK_PUBLIC_ENABLED — when false, normal customers no longer see
 * the Paystack option on the credit packs. Platform admins still see
 * it so Paystack QA paths remain testable. Set this back to `true`
 * when Paystack is re-approved as a public-facing option.
 */
export const PAYSTACK_PUBLIC_ENABLED = false;

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
  const { isAdmin } = useAuth();
  const [busy, setBusy] = useState<"paystack" | "payfast" | null>(null);

  const eligible = isPayfastEligible(packageId);
  const showPayfast = payfast.available && eligible;
  const showPaystack = PAYSTACK_PUBLIC_ENABLED || isAdmin;
  const zar = eligible ? computeDisplayZar(packageId, payfast.usdZarRate) : null;
  const usd = eligible ? PAYFAST_USD_PRICES[packageId] : null;

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
    if (busy || disabled || !eligible) return;
    setBusy("payfast");
    try {
      const { checkoutUrl, formFields } = await startPayfastPublicCheckout(
        packageId,
      );
      submitPayfastForm(checkoutUrl, formFields);
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
        {showPayfast && (
          <button
            type="button"
            onClick={handlePayfast}
            disabled={!!busy || disabled}
            data-testid={`pay-payfast-${packageId}`}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-sm text-sm font-medium text-white transition-colors w-full sm:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ backgroundColor: INK_GREEN }}
            onMouseEnter={(e) => {
              if (!busy && !disabled) e.currentTarget.style.backgroundColor = INK_GREEN_HOVER;
            }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = INK_GREEN; }}
          >
            {busy === "payfast" ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Redirecting…</>
            ) : zar !== null ? (
              <>Pay {formatZar(zar)} via PayFast</>
            ) : (
              <>Pay via PayFast</>
            )}
          </button>
        )}

        {showPaystack && (
          <button
            type="button"
            onClick={handlePaystack}
            disabled={!!busy || disabled}
            data-testid={`pay-paystack-${packageId}`}
            className={
              showPayfast
                ? "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-sm text-sm font-medium border transition-colors w-full sm:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
                : "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-sm text-sm font-medium text-white transition-colors w-full sm:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
            }
            style={
              showPayfast
                ? { borderColor: INK_GREEN, color: INK_GREEN, backgroundColor: "transparent" }
                : { backgroundColor: INK_GREEN }
            }
          >
            {busy === "paystack" ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Redirecting…</>
            ) : (
              <>Pay {usdPrice} via Paystack</>
            )}
          </button>
        )}
      </div>

      {showPayfast && eligible && usd !== null && (
        <p
          className="font-mono text-[11px] tracking-wide text-muted-foreground"
          data-testid={`payment-method-fx-note-${packageId}`}
        >
          {`${usd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} `}
          {zar !== null && payfast.usdZarRate ? (
            <>
              · PayFast amount: <span className="text-foreground">{formatZar(zar)}</span>
              {" "}· Rate used: $1 = R{payfast.usdZarRate}
            </>
          ) : (
            <>· PayFast rate is being prepared.</>
          )}
        </p>
      )}

      {showPayfast && (
        <p
          className="text-[11px] text-muted-foreground"
          data-testid={`payment-method-note-${packageId}`}
        >
          Credits are priced in USD. PayFast charges the ZAR amount shown
          before payment. The rate is set by Izenzo and locked when
          checkout starts.
        </p>
      )}
    </div>
  );
}

/** Internal — hoisted out to keep the JSX tidy. */
function submitPayfastForm(
  checkoutUrl: string,
  formFields: Array<{ name: string; value: string }>,
): void {
  const url = new URL(checkoutUrl);
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `${url.origin}${url.pathname}`;
  form.style.display = "none";
  for (const { name, value } of formFields) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = String(value);
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
