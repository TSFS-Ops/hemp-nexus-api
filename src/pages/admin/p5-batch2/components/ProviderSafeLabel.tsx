/**
 * P-5 Batch 2 — Stage 4 admin-only safe provider label.
 *
 * Wraps every rendered provider-dependent label so we cannot accidentally
 * leak forbidden wording (verified / passed / cleared / sanctions clear /
 * bank verified / provider approved / no adverse result) when
 * provider_live = false. Falls back to a safe placeholder if a label is
 * found to be unsafe.
 */
import type { P5B2ProviderStatus } from "@/lib/p5-batch2/constants";
import {
  checkP5B2ProviderWording,
  getP5B2SafeProviderLabel,
  type P5B2ViewerType,
} from "@/lib/p5-batch2/provider-wording-guard";

export interface ProviderSafeLabelProps {
  provider_status: P5B2ProviderStatus | null;
  provider_live: boolean;
  viewer?: P5B2ViewerType;
}

export function ProviderSafeLabel({
  provider_status,
  provider_live,
  viewer = "admin",
}: ProviderSafeLabelProps) {
  if (!provider_status) {
    return <span className="text-muted-foreground">—</span>;
  }
  const label = getP5B2SafeProviderLabel(viewer, provider_status);
  const check = checkP5B2ProviderWording({ text: label, provider_live, viewer });
  const safe = check.safe ? label : "Provider result pending";
  return <span data-testid="provider-safe-label">{safe}</span>;
}
