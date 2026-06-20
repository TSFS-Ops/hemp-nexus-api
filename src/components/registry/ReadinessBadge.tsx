/**
 * Batch 1 — Readiness state badge. Reads label copy from the registry-readiness SSOT.
 */
import { REGISTRY_READINESS_LABEL, type RegistryReadinessState } from "@/lib/registry-readiness";

const TONE: Record<RegistryReadinessState, string> = {
  not_started: "bg-muted text-muted-foreground border-border",
  shell_ready: "bg-muted text-foreground border-border",
  test_data_ready: "bg-muted text-foreground border-border",
  provider_pending: "bg-muted text-foreground border-border",
  data_pending: "bg-muted text-foreground border-border",
  licence_pending: "bg-muted text-foreground border-border",
  admin_only: "bg-muted text-foreground border-border",
  client_demo_ready: "bg-muted text-foreground border-border",
  production_ready: "bg-primary/10 text-primary border-primary/30",
  disabled: "bg-muted text-muted-foreground border-border",
};

export function ReadinessBadge({ state }: { state: RegistryReadinessState }) {
  return (
    <span
      data-testid="readiness-badge"
      data-state={state}
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${TONE[state]}`}
    >
      {REGISTRY_READINESS_LABEL[state]}
    </span>
  );
}
