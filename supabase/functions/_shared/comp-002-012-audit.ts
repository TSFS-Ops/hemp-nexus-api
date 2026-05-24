/**
 * COMP-002 / COMP-012 — canonical audit names (Deno mirror).
 * Must remain string-identical to src/lib/compliance/comp-002-012-audit.ts.
 * Pinned by `scripts/check-comp-002-012-audit-names.mjs`.
 */

export const COMP_002_SANCTIONS_RESCREEN_REQUIRED =
  "compliance.sanctions_rescreen_required" as const;
export const COMP_002_SANCTIONS_RESCREEN_PASSED =
  "compliance.sanctions_rescreen_passed" as const;
export const COMP_002_SANCTIONS_POTENTIAL_MATCH_DETECTED =
  "compliance.sanctions_potential_match_detected" as const;
export const COMP_002_SANCTIONS_HOLD_RELEASED =
  "compliance.sanctions_hold_released" as const;
export const COMP_002_SANCTIONS_HOLD_CLOSED =
  "compliance.sanctions_hold_closed" as const;

export const COMP_012_VERIFICATION_REFRESH_REQUIRED =
  "compliance.verification_refresh_required" as const;
export const COMP_012_VERIFICATION_REFRESH_PASSED =
  "compliance.verification_refresh_passed" as const;
export const COMP_012_VERIFICATION_REFRESH_FAILED =
  "compliance.verification_refresh_failed" as const;
export const COMP_012_VERIFICATION_HOLD_RELEASED =
  "compliance.verification_hold_released" as const;
export const COMP_012_VERIFICATION_HOLD_CLOSED =
  "compliance.verification_hold_closed" as const;

export const COMP_PROGRESSION_BLOCKED_SANCTIONS_STALE =
  "compliance.progression_blocked_sanctions_stale" as const;
export const COMP_PROGRESSION_BLOCKED_VERIFICATION_STALE =
  "compliance.progression_blocked_verification_stale" as const;

export const COMP_002_012_AUDIT_NAMES = [
  COMP_002_SANCTIONS_RESCREEN_REQUIRED,
  COMP_002_SANCTIONS_RESCREEN_PASSED,
  COMP_002_SANCTIONS_POTENTIAL_MATCH_DETECTED,
  COMP_002_SANCTIONS_HOLD_RELEASED,
  COMP_002_SANCTIONS_HOLD_CLOSED,
  COMP_012_VERIFICATION_REFRESH_REQUIRED,
  COMP_012_VERIFICATION_REFRESH_PASSED,
  COMP_012_VERIFICATION_REFRESH_FAILED,
  COMP_012_VERIFICATION_HOLD_RELEASED,
  COMP_012_VERIFICATION_HOLD_CLOSED,
  COMP_PROGRESSION_BLOCKED_SANCTIONS_STALE,
  COMP_PROGRESSION_BLOCKED_VERIFICATION_STALE,
] as const;
