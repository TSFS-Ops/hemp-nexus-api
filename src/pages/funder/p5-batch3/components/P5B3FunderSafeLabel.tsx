/**
 * P-5 Batch 3 — Stage 5 funder-safe provider label.
 *
 * Server already downgrades unsafe labels; this component is a defensive
 * second pass. Funder UI never renders the raw label without this guard.
 */
import { guardProviderWording } from "@/lib/p5-batch3/summary-client";
import type { P5B3WordingContext } from "@/lib/p5-batch3/provider-wording";

export interface P5B3FunderSafeLabelProps {
  label: string | null | undefined;
  context?: P5B3WordingContext;
}

const DEFAULT_CTX: P5B3WordingContext = {
  provider_live: false,
  provider_result_reference: null,
  approved_manual_decision_ref: null,
};

export function P5B3FunderSafeLabel({ label, context }: P5B3FunderSafeLabelProps) {
  const safe = guardProviderWording(label, context ?? DEFAULT_CTX);
  return (
    <span data-testid="p5b3-funder-safe-label" className="text-foreground">
      {safe}
    </span>
  );
}
