/**
 * Single source of truth for the `entities` table enum values.
 *
 * The DB enforces these via CHECK constraints:
 *   entities.entity_type ∈ {COMPANY, INDIVIDUAL}
 *   entities.status      ∈ {PENDING, VERIFIED, FAILED}
 *
 * Always import these constants instead of typing the strings inline,
 * to prevent silent zero-row reads or constraint-violation writes
 * caused by case drift.
 */

export const ENTITY_TYPE = {
  COMPANY: "COMPANY",
  INDIVIDUAL: "INDIVIDUAL",
} as const;
export type EntityType = (typeof ENTITY_TYPE)[keyof typeof ENTITY_TYPE];

export const ENTITY_STATUS = {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
} as const;
export type EntityStatus = (typeof ENTITY_STATUS)[keyof typeof ENTITY_STATUS];
