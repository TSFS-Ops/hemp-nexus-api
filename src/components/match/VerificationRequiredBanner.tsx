/**
 * VerificationRequiredBanner
 *
 * Counterparty-facing gap-fill UX for the POI verification gate.
 *
 * Renders the canonical "verification required before issuing / sending /
 * progressing" message near any counterparty-facing action surface. The
 * server (_shared/legitimacy.ts) is the source of truth - this banner only
 * surfaces the same decision in the UI so users don't click a button just
 * to receive a 403.
 *
 * Intentionally read-only: no enforcement, no toggles, no overrides.
 */

import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useOrgLegitimacy } from "@/hooks/use-org-legitimacy";
import { cn } from "@/lib/utils";

type Reason = "no_record" | "not_approved" | "revoked" | "expired" | "frozen" | "no_org";

const HEADLINES: Record<Reason, string> = {
  no_org: "Organisation profile not linked",
  no_record: "Verification required before issuing POI",
  not_approved: "Your organisation verification is still pending",
  revoked: "POI issuance is currently blocked for this organisation",
  expired: "Your organisation's verification has expired",
  frozen: "Your organisation is suspended",
};

const REASON_CODES: Record<Reason, string> = {
  no_org: "ORG_PROFILE_MISSING",
  no_record: "ORG_NOT_VERIFIED",
  not_approved: "ORG_VERIFICATION_PENDING",
  revoked: "ORG_VERIFICATION_REVOKED",
  expired: "ORG_VERIFICATION_EXPIRED",
  frozen: "ORG_SUSPENDED",
};

export function VerificationRequiredBanner({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { data, isLoading } = useOrgLegitimacy();
  if (isLoading || !data) return null;
  if (data.allowed === true) return null;
  const blocked = data as Extract<typeof data, { allowed: false }>;

  const reason = blocked.reason as Reason;


  const headline = HEADLINES[reason] ?? "Verification required before issuing POI";
  const code = REASON_CODES[reason] ?? "ORG_NOT_VERIFIED";

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="verification-required-banner"
      data-reason={reason}
      data-code={code}
      className={cn(
        "flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950",
        compact && "px-3 py-2 text-xs",
        className,
      )}
    >
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-700" aria-hidden />
      <div className="space-y-1">
        <div className="flex items-center gap-2 font-medium">
          <span>{headline}</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-amber-700/80">
            {code}
          </span>
        </div>
        {!compact && (
          <p className="text-amber-900/90">
            {blocked.message} You can continue preparing this POI as an internal
            draft, but it cannot be issued, sent, exported, or progressed into a
            counterparty-facing state until verification is complete.
          </p>

        )}
        <div className="flex items-center gap-1.5 text-xs text-amber-800/80">
          <ShieldCheck className="h-3 w-3" aria-hidden />
          <span>Settings → Company Identity</span>
        </div>
      </div>
    </div>
  );
}
