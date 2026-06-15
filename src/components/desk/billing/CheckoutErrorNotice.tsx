/**
 * CheckoutErrorNotice - surfaces a Paystack checkout-initiation failure
 * inline (next to the Purchase button that failed) with the backend's
 * returned error message and a Retry control.
 *
 * Used by every credit-purchase surface (BillingOverview, TokenBalanceTab,
 * CreditProvisioningPanel) so the error UX is identical wherever a
 * Purchase button lives.
 */
import { AlertCircle, RotateCw, X } from "lucide-react";

interface CheckoutErrorNoticeProps {
  message: string;
  onRetry: () => void;
  onDismiss?: () => void;
  retrying?: boolean;
  /** Visual variant: `inline` for narrow card slots, `banner` for full-width sections. */
  variant?: "inline" | "banner";
}

export function CheckoutErrorNotice({
  message,
  onRetry,
  onDismiss,
  retrying = false,
  variant = "banner",
}: CheckoutErrorNoticeProps) {
  const isInline = variant === "inline";
  return (
    <div
      role="alert"
      aria-live="polite"
      className={[
        "rounded-sm border border-destructive/30 bg-destructive/5 text-destructive",
        isInline ? "px-3 py-2.5" : "px-4 py-3",
      ].join(" ")}
    >
      <div className={["flex items-start gap-2.5", isInline ? "text-[12px]" : "text-sm"].join(" ")}>
        <AlertCircle className={isInline ? "h-3.5 w-3.5 mt-0.5 shrink-0" : "h-4 w-4 mt-0.5 shrink-0"} strokeWidth={2} />
        <div className="flex-1 min-w-0">
          <p className="font-medium leading-snug">Could not start checkout</p>
          <p className={["text-destructive/80 leading-relaxed mt-0.5 break-words", isInline ? "text-[11px]" : "text-xs"].join(" ")}>
            {message}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className={[
                "inline-flex items-center gap-1.5 rounded-sm border border-destructive/40 bg-card px-2.5 py-1 font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
                isInline ? "text-[11px]" : "text-xs",
              ].join(" ")}
            >
              <RotateCw
                className={[isInline ? "h-3 w-3" : "h-3.5 w-3.5", retrying ? "animate-spin" : ""].join(" ")}
                strokeWidth={2.5}
              />
              {retrying ? "Retrying…" : "Retry"}
            </button>
            <a
              href="mailto:support@izenzo.co.za"
              className={["text-destructive/80 hover:text-destructive underline-offset-2 hover:underline", isInline ? "text-[11px]" : "text-xs"].join(" ")}
            >
              Contact support
            </a>
          </div>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="shrink-0 -mr-1 -mt-0.5 p-1 text-destructive/70 hover:text-destructive transition-colors"
          >
            <X className={isInline ? "h-3 w-3" : "h-3.5 w-3.5"} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}
