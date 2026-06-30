/**
 * Batch 1 — Readiness state badge. Reads label copy from the registry-readiness SSOT.
 *
 * C8 hardening — the `state` prop now accepts any string. Known module
 * readiness states render with their SSOT label; unknown values (e.g.
 * record-lifecycle values such as `imported_unverified` coming from the
 * search edge function) fall back to the C8 readiness display map, and
 * any still-unknown value uses a neutral title-cased fallback. No raw
 * snake_case is ever rendered.
 */
import {
  REGISTRY_READINESS_LABEL,
  REGISTRY_READINESS_STATES,
  type RegistryReadinessState,
} from "@/lib/registry-readiness";
import { formatReadinessLabel } from "@/lib/registry-status-labels";

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

const NEUTRAL_TONE = "bg-muted text-foreground border-border";

function isModuleReadinessState(value: string): value is RegistryReadinessState {
  return (REGISTRY_READINESS_STATES as readonly string[]).includes(value);
}

export function ReadinessBadge({ state }: { state: RegistryReadinessState | string }) {
  const known = typeof state === "string" && isModuleReadinessState(state);
  const tone = known ? TONE[state as RegistryReadinessState] : NEUTRAL_TONE;
  const label = known
    ? REGISTRY_READINESS_LABEL[state as RegistryReadinessState]
    : formatReadinessLabel(state);
  return (
    <span
      data-testid="readiness-badge"
      data-state={state}
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  );
}
