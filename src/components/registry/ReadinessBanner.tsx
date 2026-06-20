/**
 * Batch 1 — Readiness banner. Renders the SSOT explanation for the current
 * readiness state so no shell surface can ever be mistaken for an
 * operational record of truth.
 */
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  REGISTRY_READINESS_COPY,
  REGISTRY_READINESS_LABEL,
  type RegistryReadinessState,
} from "@/lib/registry-readiness";

export function ReadinessBanner({
  state,
  moduleCode,
}: {
  state: RegistryReadinessState;
  moduleCode?: string;
}) {
  return (
    <Alert data-testid="readiness-banner" data-state={state} className="mb-6">
      <AlertTitle>
        {moduleCode ? `${moduleCode} — ` : ""}
        {REGISTRY_READINESS_LABEL[state]}
      </AlertTitle>
      <AlertDescription className="text-xs">
        {REGISTRY_READINESS_COPY[state]}
      </AlertDescription>
    </Alert>
  );
}
