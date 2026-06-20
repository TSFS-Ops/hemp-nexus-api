/**
 * Batch 1 — M019 Product Truth / Module Readiness Layer (SSOT, browser mirror).
 *
 * Pinned by:
 *   - scripts/check-registry-readiness-parity.mjs (TS ↔ Deno mirror)
 *   - scripts/check-registry-readiness-forbidden-words.mjs (no "verified" / "live" / "production" / "guaranteed" wording on non-production_ready shells)
 *
 * NEVER hand-edit copy strings in components — import from here.
 * Mirror of supabase/functions/_shared/registry-readiness.ts.
 */

export const REGISTRY_READINESS_STATES = [
  "not_started",
  "shell_ready",
  "test_data_ready",
  "provider_pending",
  "data_pending",
  "licence_pending",
  "admin_only",
  "client_demo_ready",
  "production_ready",
  "disabled",
] as const;
export type RegistryReadinessState = (typeof REGISTRY_READINESS_STATES)[number];

export const REGISTRY_READINESS_LABEL: Record<RegistryReadinessState, string> = {
  not_started: "Not started",
  shell_ready: "Shell only",
  test_data_ready: "Test data only",
  provider_pending: "Provider pending",
  data_pending: "Data pending",
  licence_pending: "Licence pending",
  admin_only: "Admin only",
  client_demo_ready: "Client demo only",
  production_ready: "Production ready",
  disabled: "Disabled",
};

export const REGISTRY_READINESS_COPY: Record<RegistryReadinessState, string> = {
  not_started:
    "This module has not been started. No data, workflow or interface is available.",
  shell_ready:
    "This is a shell only. No records have been loaded and no workflow is operational. Nothing shown here may be treated as a record of truth.",
  test_data_ready:
    "Test data is available for internal walkthroughs only. Do not treat any record as a record of truth.",
  provider_pending:
    "A required data or verification provider is not yet connected. Status checks cannot be performed.",
  data_pending:
    "Required source data has not yet been loaded under an approved licence and provenance entry.",
  licence_pending:
    "A required data or commercial licence has not yet been recorded. The module is held back until the decision register confirms licence terms.",
  admin_only:
    "This surface is available to platform administrators for setup and review. It is not exposed to end users or institutional clients.",
  client_demo_ready:
    "Approved for controlled client walkthroughs using clearly labelled demo content. Do not present as a record of truth.",
  production_ready:
    "Approved for operational use against records that have completed the required source, provenance and decision-register checks.",
  disabled: "This module has been switched off pending a recorded decision.",
};

/**
 * Audit event names emitted by readiness writers. SSOT — every name listed
 * here must be emitted by exactly one writer surface and pinned by the
 * `check-registry-readiness-parity.mjs` guard.
 */
export const REGISTRY_READINESS_AUDIT_EVENT_NAMES = [
  "registry_readiness_state_changed",
] as const;
export type RegistryReadinessAuditEventName =
  (typeof REGISTRY_READINESS_AUDIT_EVENT_NAMES)[number];

/**
 * Surfaces forbidden from displaying any of these words unless the surface
 * itself is `production_ready`. Used by the forbidden-words guard.
 */
export const REGISTRY_READINESS_FORBIDDEN_WORDS = [
  "verified",
  "live",
  "guaranteed",
  "production-ready",
] as const;

export function isProductionReady(state: RegistryReadinessState): boolean {
  return state === "production_ready";
}

export function isClientSafe(state: RegistryReadinessState): boolean {
  return state === "production_ready" || state === "client_demo_ready";
}
