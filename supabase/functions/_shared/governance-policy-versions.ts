/**
 * Phase 2 — canonical policy-version constants for already-wired
 * Governance Record event families.
 *
 * Purpose:
 *   Eliminate `policy_version: null` / "Not recorded" placeholders in posture
 *   snapshots for event families whose governance contract is now stable.
 *
 * Rules:
 *   - These are STABLE identifiers; bump the suffix (e.g. `/v2`) when the
 *     governance contract for that family materially changes.
 *   - Do NOT invent constants for unwired or speculative families.
 *   - Do NOT use these as feature flags — they exist purely to stamp the
 *     posture_snapshot of the canonical event.
 *
 * Wiring convention:
 *   Pass the constant into `buildPostureSnapshot(..., { policy_version: X })`
 *   AND (where the helper accepts it) into `metadata.policy_version`.
 */

export const POI_POLICY_VERSION = "poi-governance/v1";
export const WAD_POLICY_VERSION = "wad-governance/v1";
export const EXECUTION_POLICY_VERSION = "execution-governance/v1";
export const FINALITY_POLICY_VERSION = "finality-governance/v1";
export const CREDIT_POLICY_VERSION = "credit-governance/v1";
export const PAYMENT_POLICY_VERSION = "payment-governance/v1";
export const DISPUTE_POLICY_VERSION = "dispute-governance/v1";
export const ADMIN_HQ_DECISION_POLICY_VERSION = "admin-hq-decision/v1";
export const LEGAL_HOLD_POLICY_VERSION = "legal-hold/v1";

/** Map from canonical event_type → its owning policy version. Used by tests
 *  to assert posture stamping and by helpers that need a default. */
export const POLICY_VERSION_BY_EVENT_TYPE: Readonly<Record<string, string>> = {
  "poi.created": POI_POLICY_VERSION,
  "poi.state_changed": POI_POLICY_VERSION,
  "poi.blocked": POI_POLICY_VERSION,
  "wad.passed": WAD_POLICY_VERSION,
  "wad.failed": WAD_POLICY_VERSION,
  "wad.manual_review_required": WAD_POLICY_VERSION,
  "wad.check_failed": WAD_POLICY_VERSION,
  "credit.burned": CREDIT_POLICY_VERSION,
  "credit.burn_attempted": CREDIT_POLICY_VERSION,
  "credit.burn_blocked": CREDIT_POLICY_VERSION,
  "execution.permitted": EXECUTION_POLICY_VERSION,
  "finality.recorded": FINALITY_POLICY_VERSION,
  "dispute.opened": DISPUTE_POLICY_VERSION,
  "dispute.closed": DISPUTE_POLICY_VERSION,
  "dispute.released": DISPUTE_POLICY_VERSION,
  "payment.event_created": PAYMENT_POLICY_VERSION,
  "legal_hold.applied": LEGAL_HOLD_POLICY_VERSION,
  "legal_hold.released": LEGAL_HOLD_POLICY_VERSION,
  "admin.hq_decision_recorded": ADMIN_HQ_DECISION_POLICY_VERSION,
} as const;
