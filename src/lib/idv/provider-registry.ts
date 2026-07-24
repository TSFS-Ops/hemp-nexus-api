/**
 * Batch V — Active IDV provider registry.
 *
 * Batch V decommissioned prior IDV integration paths for NEW IDV checks.
 * Historical audit records may still reference the earlier identifiers, but
 * this registry is consulted by any code that is about to START a new IDV
 * check — new checks must resolve to `verifynow`.
 */

export const ACTIVE_IDV_PROVIDERS = Object.freeze(["verifynow" as const]);
export type ActiveIdvProviderId = (typeof ACTIVE_IDV_PROVIDERS)[number];

/**
 * Neutral list of decommissioned integration paths for NEW IDV checks.
 * Vendor-named entries were removed as part of the deprecated-compliance-
 * provider cleanup; historical audit rows are unaffected because reads use
 * the raw stored identifier, not this list.
 */
export const DECOMMISSIONED_FOR_NEW_IDV = Object.freeze([
  "sanctions_io",
  "sumsub",
  "didit",
  "complycube",
  "identity_document",
  "company_registry",
]);

export function isActiveIdvProvider(id: string): id is ActiveIdvProviderId {
  return (ACTIVE_IDV_PROVIDERS as readonly string[]).includes(id);
}

export function getActiveIdvProviders(): readonly ActiveIdvProviderId[] {
  return ACTIVE_IDV_PROVIDERS;
}
