/**
 * Batch 1 — M019 Product Truth / Module Readiness Layer (SSOT, Deno mirror).
 *
 * Pinned to src/lib/registry-readiness.ts by
 * scripts/check-registry-readiness-parity.mjs.
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

export const REGISTRY_READINESS_AUDIT_EVENT_NAMES = [
  "registry_readiness_state_changed",
] as const;
export type RegistryReadinessAuditEventName =
  (typeof REGISTRY_READINESS_AUDIT_EVENT_NAMES)[number];
