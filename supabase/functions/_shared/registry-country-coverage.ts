/**
 * Batch 2 — M011 Country Coverage SSOT (Deno mirror).
 * Pinned to src/lib/registry-country-coverage.ts by
 * scripts/check-registry-country-coverage-parity.mjs.
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

export const COUNTRY_COVERAGE_AUDIT_EVENT_NAMES = [
  "registry_country_coverage_state_changed",
  "registry_country_coverage_wording_changed",
] as const;
export type CountryCoverageAuditEventName =
  (typeof COUNTRY_COVERAGE_AUDIT_EVENT_NAMES)[number];
