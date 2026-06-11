/**
 * DraftPoiBadge — per-POI "Internal draft only" label.
 *
 * Mounted on the POI surface (MatchHeroCard) whenever the POI is in DRAFT.
 * Distinct from the wizard-level VerificationRequiredBanner: the banner
 * explains *why* issuance is gated; this badge labels the POI artifact
 * itself so it can never be confused with a formally issued POI.
 *
 * Client decision (binding): draft labels must include
 *   - "Internal draft only"
 *   - "Not issued"
 *   - "Organisation verification required before issuance"
 */

import { FileWarning } from "lucide-react";
import { cn } from "@/lib/utils";

export function DraftPoiBadge({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="note"
      data-testid="draft-poi-badge"
      className={cn(
        "flex items-start gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-800",
        className,
      )}
    >
      <FileWarning className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-600" aria-hidden />
      <div className="space-y-0.5">
        <div className="font-semibold uppercase tracking-wide text-[10px] text-slate-700">
          Internal draft only · Not issued
        </div>
        {!compact && (
          <p className="text-slate-700/90">
            Organisation verification is required before this Proof of Intent
            can be issued, sent, exposed to a counterparty, or progressed.
          </p>
        )}
      </div>
    </div>
  );
}
