/**
 * EvidenceStrengthIndicator - Visual red→amber→green strength bar
 * reflecting the volume of supporting documents uploaded for a trade.
 *
 * 0 docs   = "Weak"     (red)
 * 1-2 docs = "Moderate" (amber)
 * 3+ docs  = "Strong"   (green)
 *
 * MINIMUM (bilateral POI mint, server-enforced by atomic_generate_poi_v2):
 * at least 1 supporting document attached by EACH side (buyer and seller).
 * The strength bar is advisory above that floor; the floor itself is hard.
 * Unilateral POIs do not require a document on the absent counterparty side.
 */

import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface EvidenceStrengthIndicatorProps {
  documentCount: number;
  /** Compact mode for list views, shows just the bar + label */
  compact?: boolean;
  /**
   * When true, surface the bilateral per-side floor as the headline reason.
   * Callers (StateProgressionCard, GovernanceDocSubmit) pass this when the
   * MIN_EVIDENCE_PER_SIDE check would block POI mint.
   */
  requiredPerSideUnmet?: boolean;
  className?: string;
}

type StrengthBand = "weak" | "moderate" | "strong";

function deriveStrength(count: number): {
  band: StrengthBand;
  label: string;
  percentage: number;
} {
  if (count === 0) {
    return { band: "weak", label: "Weak", percentage: 10 };
  }
  if (count <= 2) {
    // 1 doc = 40%, 2 docs = 60%
    return { band: "moderate", label: "Moderate", percentage: 20 + count * 20 };
  }
  // 3 docs = 80%, 4+ = 100%
  return { band: "strong", label: "Strong", percentage: Math.min(100, 60 + count * 10) };
}

const bandStyles: Record<StrengthBand, { bar: string; text: string; dot: string }> = {
  weak: {
    bar: "bg-destructive",
    text: "text-destructive",
    dot: "bg-destructive",
  },
  moderate: {
    bar: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  strong: {
    bar: "bg-[hsl(var(--emerald))]",
    text: "text-[hsl(var(--emerald))] dark:text-emerald-400",
    dot: "bg-[hsl(var(--emerald))]",
  },
};

export function EvidenceStrengthIndicator({
  documentCount,
  compact = false,
  className,
}: EvidenceStrengthIndicatorProps) {
  const { band, label, percentage } = deriveStrength(documentCount);
  const styles = bandStyles[band];

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <span className={cn("h-2 w-2 rounded-full shrink-0", styles.dot)} />
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-[60px]">
          <div
            className={cn("h-full rounded-full transition-all duration-500", styles.bar)}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <span className={cn("text-xs font-medium", styles.text)}>{label}</span>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Evidence Strength</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", styles.dot)} />
          <span className={cn("text-sm font-semibold", styles.text)}>{label}</span>
        </div>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-700 ease-out", styles.bar)}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {documentCount === 0
          ? "No supporting documents uploaded. Add documents to strengthen this trade's evidence bundle."
          : `${documentCount} supporting document${documentCount !== 1 ? "s" : ""} uploaded. ${
              band === "strong"
                ? "This trade has a strong evidence bundle."
                : "Upload more documents to strengthen the evidence bundle."
            }`}
      </p>
    </div>
  );
}
