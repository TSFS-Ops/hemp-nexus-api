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
import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  startCreditCheckout,
  type CreditPackageId,
} from "@/lib/credit-checkout";
import {
  startPayfastPublicCheckout,
  submitPayfastForm as submitPayfastFormLib,
  computeDisplayZar,
  PAYFAST_USD_PRICES,
  type PayfastCustomerPackageId,
} from "@/lib/credit-checkout-payfast";
import { createPayfastLogger, type PayfastLogger } from "@/lib/payfast-checkout-logger";
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
  const [payfastSubmittedAt, setPayfastSubmittedAt] = useState<number | null>(null);
  const [payfastRequestId, setPayfastRequestId] = useState<string | null>(null);
  const loggerRef = useRef<PayfastLogger | null>(null);
  const openedInNewTab = typeof window !== "undefined" && window.self !== window.top;

  const eligible = isPayfastEligible(packageId);
  const showPayfast = payfast.available && eligible;
  const showPaystack = PAYSTACK_PUBLIC_ENABLED || isAdmin;
  const zar = eligible ? computeDisplayZar(packageId, payfast.usdZarRate) : null;
  const usd = eligible ? PAYFAST_USD_PRICES[packageId] : null;

  // When the user returns to the Izenzo tab after the PayFast tab/redirect,
  // that almost always means PayFast either completed elsewhere OR refused
  // to connect. Log it as a correlated diagnostic signal.
  useEffect(() => {
    if (!payfastSubmittedAt) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible" && loggerRef.current) {
        loggerRef.current.log("tab_visibility_returned", {
          extra: { msSinceSubmit: Date.now() - payfastSubmittedAt },
        });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [payfastSubmittedAt]);

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

  const handlePayfast = async (kind: "initial" | "retry" = "initial") => {
    if (busy || disabled || !eligible) return;
    setBusy("payfast");

    // Reuse the same requestId on retry so the whole journey correlates.
    const existing = loggerRef.current;
    const logger =
      kind === "retry" && existing
        ? existing
        : createPayfastLogger(packageId as PayfastCustomerPackageId);
    loggerRef.current = logger;
    setPayfastRequestId(logger.requestId);

    logger.log("initiate_start", {
      extra: { kind, usdZarRate: payfast.usdZarRate ?? null },
    });

    try {
      const result = await startPayfastPublicCheckout(packageId as PayfastCustomerPackageId);
      const { checkoutUrl, formFields } = result;
      logger.log("edge_response_ok", {
        purchaseId: result.purchaseId,
        providerReference: result.providerReference,
        amountUsd: result.amountUsd,
        amountZar: result.amountZar,
        usdZarRate: result.usdZarRate,
        credits: result.credits,
        formFieldCount: formFields.length,
        checkoutHost: (() => {
          try { return new URL(checkoutUrl).host; } catch { return undefined; }
        })(),
      });

      submitPayfastFormLib(checkoutUrl, formFields, { logger });
      setPayfastSubmittedAt(Date.now());
      setTimeout(() => setBusy(null), 4000);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Could not start PayFast checkout.";
      logger.log("checkout_error", {
        errorMessage: msg,
        errorName: e instanceof Error ? e.name : "UnknownError",
      });
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
            onClick={() => handlePayfast("initial")}
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
            data-admin-only={!PAYSTACK_PUBLIC_ENABLED && isAdmin ? "true" : undefined}
            title={!PAYSTACK_PUBLIC_ENABLED && isAdmin ? "Admin-only / internal — not visible to customers" : undefined}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-sm text-sm font-medium border border-dashed transition-colors w-full sm:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ borderColor: "#94a3b8", color: "#475569", backgroundColor: "transparent" }}
          >
            {busy === "paystack" ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Redirecting…</>
            ) : !PAYSTACK_PUBLIC_ENABLED && isAdmin ? (
              <>[Admin only] Pay {usdPrice} via Paystack</>
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

      {showPayfast && payfastSubmittedAt !== null && (
        <div
          role="status"
          aria-live="polite"
          data-testid={`payfast-connection-notice-${packageId}`}
          className="mt-2 rounded-sm border border-amber-200 bg-amber-50 p-3 text-[12px] text-slate-800"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
            <div className="space-y-2">
              <p className="font-medium text-slate-900">
                {openedInNewTab
                  ? "PayFast opened in a new tab."
                  : "Redirecting to PayFast…"}
              </p>
              <p>
                If you see{" "}
                <span className="font-mono">payment.payfast.io refused to connect</span>
                {" "}or the page does not load, it is usually a temporary
                network issue between your device and PayFast. Try the
                following, then retry the payment:
              </p>
              <ul className="list-disc pl-5 space-y-0.5">
                <li>Disable any ad-blocker, VPN, or strict tracking-protection for this site.</li>
                <li>Try a different browser, or switch from Wi-Fi to mobile data.</li>
                <li>Wait 30–60 seconds — PayFast may be briefly unavailable.</li>
              </ul>
              <p className="text-slate-600">
                No credits are issued until PayFast confirms your payment,
                so it is safe to retry.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    loggerRef.current?.log("retry_clicked", {
                      extra: { msSinceSubmit: payfastSubmittedAt ? Date.now() - payfastSubmittedAt : null },
                    });
                    void handlePayfast("retry");
                  }}
                  disabled={!!busy || disabled}
                  data-testid={`payfast-retry-${packageId}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[12px] font-medium text-white disabled:opacity-60"
                  style={{ backgroundColor: INK_GREEN }}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${busy === "payfast" ? "animate-spin" : ""}`} />
                  Retry PayFast
                </button>
                <button
                  type="button"
                  onClick={() => setPayfastSubmittedAt(null)}
                  className="inline-flex items-center px-3 py-1.5 rounded-sm text-[12px] font-medium border border-slate-300 text-slate-700 bg-white hover:bg-slate-50"
                  data-testid={`payfast-dismiss-${packageId}`}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
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
  if (window.self !== window.top) {
    form.target = "_blank";
    form.rel = "noopener";
  }
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
