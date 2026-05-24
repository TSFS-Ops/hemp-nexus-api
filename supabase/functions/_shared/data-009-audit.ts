/**
 * DATA-009 Phase 2 — canonical audit names (Deno mirror).
 * Must remain string-identical to src/lib/policy/data-residency-policy.ts.
 * Pinned by scripts/check-data-009-phase2-audit-emission.mjs.
 */
export const DATA_RESIDENCY_REQUIREMENT_DETECTED =
  "data.residency_requirement_detected" as const;
export const DATA_UNAPPROVED_RESIDENCY_CLAIM_BLOCKED =
  "data.unapproved_residency_claim_blocked" as const;
export const DATA_RESIDENCY_EXCEPTION_APPROVED =
  "data.residency_exception_approved" as const;
export const DATA_RESIDENCY_EXCEPTION_DECLINED =
  "data.residency_exception_declined" as const;

export const DATA_009_PHASE2_AUDIT_NAMES = [
  DATA_RESIDENCY_REQUIREMENT_DETECTED,
  DATA_UNAPPROVED_RESIDENCY_CLAIM_BLOCKED,
  DATA_RESIDENCY_EXCEPTION_APPROVED,
  DATA_RESIDENCY_EXCEPTION_DECLINED,
] as const;

export const RESIDENCY_ADMIN_REASON_MIN_LENGTH = 20 as const;
