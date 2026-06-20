/**
 * Batch 2 — M010 Registry Data Provenance SSOT (browser).
 *
 * Pinned by:
 *   - scripts/check-registry-provenance-parity.mjs  (TS ↔ Deno mirror)
 *   - scripts/check-registry-batch2-audit-names.mjs (audit-name SSOT)
 *
 * Mirror: supabase/functions/_shared/registry-provenance.ts
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

export const REGISTRY_SOURCE_TYPE_LABEL: Record<RegistrySourceType, string> = {
  registry: "Official registry",
  licensed_dataset: "Licensed dataset",
  seed_layer: "Seed layer",
  company_claim: "Company claim",
  admin_enrichment: "Admin enrichment",
  provider_api: "Provider API",
  manual_review: "Manual review",
};

/** Hard rule: presence in a dataset must NOT equal verification. */
export function presenceImpliesVerification(): false {
  return false;
}
