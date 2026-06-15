/**
 * BillingUnavailableNotice - small, reversible inline notice rendered
 * in place of (or beside) any credit-purchase CTA when the platform
 * `billing_availability` flag is `enabled: false`.
 *
 * Wired in from:
 *   - src/pages/Billing.tsx
 *   - src/pages/Pricing.tsx (if/when reused)
 *   - src/components/desk/billing/BillingOverview.tsx
 *   - src/components/desk/settings/TokenBalanceTab.tsx
 *   - src/components/desk/match/CreditProvisioningPanel.tsx
 *
 * Copy is fed from `admin_settings.billing_availability.message` so
 * the institutional ops team can tweak wording without a redeploy.
 * If no message is provided, falls back to the canonical text.
 */
import { Info } from "lucide-react";

interface BillingUnavailableNoticeProps {
  message?: string | null;
  /** When true, renders a compact one-line version (for slide-overs). */
  compact?: boolean;
}

const FALLBACK_MESSAGE =
  "Credit purchases are temporarily unavailable while USD settlement is being enabled. Your existing balance is unaffected.";

export function BillingUnavailableNotice({
  message,
  compact = false,
}: BillingUnavailableNoticeProps) {
  const copy = message?.trim() || FALLBACK_MESSAGE;
  return (
    <div
      role="status"
      data-testid="billing-unavailable-notice"
      className={[
        "border border-border rounded-md bg-muted/40",
        compact ? "px-3 py-2" : "px-4 py-3",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <Info
          className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground"
          strokeWidth={2}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p
            className={[
              "font-medium text-foreground",
              compact ? "text-xs" : "text-sm",
            ].join(" ")}
          >
            Credit purchases temporarily unavailable
          </p>
          {!compact && (
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              {copy}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
