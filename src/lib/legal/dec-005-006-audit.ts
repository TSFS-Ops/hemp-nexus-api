/**
 * DEC-005 / DEC-006 — Canonical audit-name SSOT for legal pre-acceptance
 * and POI binding wording governance.
 *
 * Phase 1 scope: declare the six canonical audit action names signed
 * against the client decision form so other modules and the prebuild
 * guard have a single import-target.
 *
 * Phase 1 deliberately does NOT fabricate runtime audit IO. The wording
 * helpers (`assertPreAcceptanceSafe`, `assertPoiWordingSafe`,
 * `getPoiLabel`) are pure, side-effect-free static helpers with no
 * runtime callers in the repo today. Inventing fake `audit_logs` writes
 * here would be dishonest — it would suggest enforcement coverage that
 * does not exist. When a real wording-application or wording-blocking
 * surface ships (Phase 2), it MUST import the constants below and emit
 * them via the standard `audit_logs` insert path; the prebuild guard
 * `check-dec-005-006-audit-names.mjs` already pins the names so dual-
 * write contracts can be added without drift.
 *
 * Cross-references:
 *   - DEC-005 SSOT: src/lib/legal/pre-acceptance-wording.ts
 *   - DEC-006 SSOT: src/lib/legal/poi-wording.ts
 *   - Forbidden terms: src/lib/legal/forbidden-terms.ts
 *   - Static guard:   scripts/check-engagement-wording.mjs (wired in prebuild)
 */

/** DEC-005 — legally safe language before counterparty acceptance. */
export const DEC_005_AUDIT_ACTIONS = {
  /** Emitted when a wording helper applied signed pre-acceptance copy. */
  pre_acceptance_wording_applied: "legal.pre_acceptance_wording_applied",
  /** Emitted when admin-edited / templated copy was rejected for forbidden terms. */
  unsafe_pre_acceptance_wording_blocked: "legal.unsafe_pre_acceptance_wording_blocked",
  /** Emitted when counterparty acceptance is recorded and surface wording flips. */
  acceptance_recorded_wording_state_updated:
    "counterparty.acceptance_recorded_wording_state_updated",
} as const;

/** DEC-006 — POI binding-wording governance. */
export const DEC_006_AUDIT_ACTIONS = {
  /** Emitted when Draft / Accepted POI label was applied via `getPoiLabel`. */
  poi_binding_wording_applied: "legal.poi_binding_wording_applied",
  /** Emitted when a binding/finality claim was rejected pre-acceptance. */
  unsafe_poi_binding_claim_blocked: "legal.unsafe_poi_binding_claim_blocked",
  /** Emitted when POI wording is upgraded to Accepted POI after express acceptance. */
  poi_wording_updated_after_counterparty_acceptance:
    "legal.poi_wording_updated_after_counterparty_acceptance",
} as const;

export type Dec005AuditAction =
  (typeof DEC_005_AUDIT_ACTIONS)[keyof typeof DEC_005_AUDIT_ACTIONS];
export type Dec006AuditAction =
  (typeof DEC_006_AUDIT_ACTIONS)[keyof typeof DEC_006_AUDIT_ACTIONS];

/** Frozen tuple of every canonical name — used by the prebuild guard + tests. */
export const DEC_005_006_CANONICAL_AUDIT_ACTIONS: readonly string[] = Object.freeze([
  ...Object.values(DEC_005_AUDIT_ACTIONS),
  ...Object.values(DEC_006_AUDIT_ACTIONS),
]);
