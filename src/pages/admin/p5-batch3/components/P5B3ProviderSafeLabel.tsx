/**
 * P-5 Batch 3 — Stage 4 safe provider label (admin surfaces).
 *
 * Wraps any provider-derived status string. Falls back to a safe
 * placeholder when the label is forbidden or when the provider result
 * is not actually live.
 */
import {
  isLabelAllowed,
  isLabelUnsafe,
  type P5B3WordingContext,
} from "@/lib/p5-batch3/provider-wording";

export interface P5B3ProviderSafeLabelProps {
  label: string | null | undefined;
  context: P5B3WordingContext;
}

export function P5B3ProviderSafeLabel({ label, context }: P5B3ProviderSafeLabelProps) {
  if (!label) return <span className="text-muted-foreground">—</span>;
  const allowed = isLabelAllowed(label, context);
  if (!allowed && isLabelUnsafe(label)) {
    return (
      <span data-testid="p5b3-provider-safe-label" className="text-muted-foreground">
        Provider-ready, not live-provider verified
      </span>
    );
  }
  if (!allowed) {
    return (
      <span data-testid="p5b3-provider-safe-label" className="text-muted-foreground">
        Provider result unavailable
      </span>
    );
  }
  return <span data-testid="p5b3-provider-safe-label">{label}</span>;
}
