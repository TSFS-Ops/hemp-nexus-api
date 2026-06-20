/**
 * Batch 2 — M010 Registry Data Provenance SSOT (Deno mirror).
 * Pinned to src/lib/registry-provenance.ts by
 * scripts/check-registry-provenance-parity.mjs.
 */

export const REGISTRY_SOURCE_TYPES = [
  "registry",
  "licensed_dataset",
  "seed_layer",
  "company_claim",
  "admin_enrichment",
  "provider_api",
  "manual_review",
] as const;
export type RegistrySourceType = (typeof REGISTRY_SOURCE_TYPES)[number];

export const REGISTRY_LICENCE_STATUSES = [
  "unlicensed",
  "licence_pending",
  "licensed",
  "expired",
  "revoked",
] as const;
export type RegistryLicenceStatus = (typeof REGISTRY_LICENCE_STATUSES)[number];

export const REGISTRY_CONFIDENCE_BANDS = [
  "unverified",
  "low",
  "medium",
  "high",
  "authoritative",
] as const;
export type RegistryConfidenceBand = (typeof REGISTRY_CONFIDENCE_BANDS)[number];

export const REGISTRY_VERIFICATION_LEVELS = [
  "none",
  "dataset_present",
  "admin_reviewed",
  "claimant_attested",
  "authority_verified",
  "provider_verified",
] as const;
export type RegistryVerificationLevel =
  (typeof REGISTRY_VERIFICATION_LEVELS)[number];

export const REGISTRY_PROVENANCE_AUDIT_EVENT_NAMES = [
  "registry_source_recorded",
  "registry_source_updated",
  "registry_source_licence_recorded",
  "registry_field_provenance_recorded",
] as const;
export type RegistryProvenanceAuditEventName =
  (typeof REGISTRY_PROVENANCE_AUDIT_EVENT_NAMES)[number];
