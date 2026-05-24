/**
 * COMP-002 / COMP-012 — freshness thresholds (SSOT, client mirror).
 *
 * Sanctions screening must be re-run every 30 calendar days.
 * Verification evidence (IDV / KYB / UBO / authorised rep / compliance
 * docs) must be refreshed every 365 calendar days (12 months).
 *
 * These constants are pinned by `scripts/check-comp-002-012-thresholds.mjs`
 * which runs in the prebuild — never change them without updating the
 * runbook and the signed Client Workflow Decision Form.
 */

export const SANCTIONS_FRESHNESS_DAYS = 30;
export const VERIFICATION_FRESHNESS_DAYS = 365;

export const SANCTIONS_FRESHNESS_MS = SANCTIONS_FRESHNESS_DAYS * 86_400_000;
export const VERIFICATION_FRESHNESS_MS = VERIFICATION_FRESHNESS_DAYS * 86_400_000;
