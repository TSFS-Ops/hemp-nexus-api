/**
 * P-5 Batch 4 Stage 4 — provider-safe label.
 *
 * Wraps any provider-derived label string. If the label contains any
 * Batch 4 forbidden wording (verified / compliant / bankable /
 * live-provider verified) we substitute the safe label.
 */
import { scanForbidden, P5B4_PROVIDER_DEPENDENT_SAFE_LABEL } from "@/lib/p5-batch4/wording-guard";

export interface P5B4ProviderSafeLabelProps {
  label: string | null | undefined;
}

export function P5B4ProviderSafeLabel({ label }: P5B4ProviderSafeLabelProps) {
  if (!label) {
    return <span className="text-muted-foreground" data-testid="p5b4-provider-safe-label">—</span>;
  }
  const scan = scanForbidden(label);
  if (!scan.ok) {
    return (
      <span
        data-testid="p5b4-provider-safe-label"
        data-safe-substituted="true"
        className="text-muted-foreground"
      >
        {P5B4_PROVIDER_DEPENDENT_SAFE_LABEL}
      </span>
    );
  }
  return (
    <span data-testid="p5b4-provider-safe-label" className="text-foreground">
      {label}
    </span>
  );
}
