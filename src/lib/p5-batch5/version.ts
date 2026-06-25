/**
 * P-5 Batch 5 — version stamps.
 *
 * Mirrored in the migration defaults for
 *   p5_batch4_finality_records.schema_version / outcome_code_version
 *   p5_batch5_memory_records.schema_version / outcome_code_version
 *
 * Bump these together with a new migration when the API surface changes.
 */
export const P5B5_SCHEMA_VERSION = "p5b5.v1" as const;
export const P5B5_OUTCOME_CODE_VERSION = "p5b5-outcomes.v1" as const;
