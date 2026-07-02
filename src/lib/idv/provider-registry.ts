/**
 * Batch V — Active IDV provider registry.
 *
 * Batch V decommissions all other providers for NEW IDV checks. Historical
 * records (Dilisense, Companies House, Onfido, Sumsub, Didit, ComplyCube,
 * Sanctions.io) remain readable in admin/audit surfaces. This registry is
 * consulted by any code that is about to START a new IDV check.
 */

export const ACTIVE_IDV_PROVIDERS = Object.freeze(["verifynow" as const]);
export type ActiveIdvProviderId = (typeof ACTIVE_IDV_PROVIDERS)[number];

export const DECOMMISSIONED_FOR_NEW_IDV = Object.freeze([
  "dilisense",
  "sanctions_io",
  "sumsub",
  "didit",
  "complycube",
  "onfido",
  "companies_house", // KYB, not person IDV — excluded from this batch anyway
]);

export function isActiveIdvProvider(id: string): id is ActiveIdvProviderId {
  return (ACTIVE_IDV_PROVIDERS as readonly string[]).includes(id);
}

export function getActiveIdvProviders(): readonly ActiveIdvProviderId[] {
  return ACTIVE_IDV_PROVIDERS;
}
