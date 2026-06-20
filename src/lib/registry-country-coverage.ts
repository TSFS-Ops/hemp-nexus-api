/**
 * Batch 2 — M011 Country Coverage SSOT (browser).
 *
 * Pinned by:
 *   - scripts/check-registry-country-coverage-parity.mjs
 *   - scripts/check-registry-country-coverage-forbidden-words.mjs
 *
 * Mirror: supabase/functions/_shared/registry-country-coverage.ts
 */

export const COUNTRY_COVERAGE_STATES = [
  "no_coverage",
  "seed_only",
  "sample_only",
  "dataset_acquired",
  "provider_api_available",
  "imported_unverified",
  "claim_enabled",
  "verification_enabled",
  "api_demo_ready",
  "production_ready",
  "disabled",
] as const;
export type CountryCoverageState = (typeof COUNTRY_COVERAGE_STATES)[number];

export const COUNTRY_COVERAGE_LABEL: Record<CountryCoverageState, string> = {
  no_coverage: "No coverage",
  seed_only: "Seed only",
  sample_only: "Sample only",
  dataset_acquired: "Dataset acquired",
  provider_api_available: "Provider API available",
  imported_unverified: "Imported, unverified",
  claim_enabled: "Claim enabled",
  verification_enabled: "Verification enabled",
  api_demo_ready: "API demo ready",
  production_ready: "Production ready",
  disabled: "Disabled",
};

export const COUNTRY_COVERAGE_AUDIT_EVENT_NAMES = [
  "registry_country_coverage_state_changed",
  "registry_country_coverage_wording_changed",
] as const;
export type CountryCoverageAuditEventName =
  (typeof COUNTRY_COVERAGE_AUDIT_EVENT_NAMES)[number];

/**
 * Seed-only / sample-only countries MUST never be presented as operational
 * record of truth. Anything below production_ready blocks public wording.
 */
export function canShowAsProductionReady(state: CountryCoverageState): boolean {
  return state === "production_ready";
}

export function isSeedOnly(state: CountryCoverageState): boolean {
  return state === "seed_only" || state === "sample_only";
}

export const COUNTRY_COVERAGE_FORBIDDEN_WORDS = [
  "verified",
  "live",
  "guaranteed",
  "production-ready",
] as const;
