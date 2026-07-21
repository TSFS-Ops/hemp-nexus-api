/**
 * Funder Workspace — shared client-side metric derivations.
 *
 * SSOT for anything the UI computes from an already-fetched
 * DealReleaseRow[] list, so the summary cards, deal list, filters
 * and status badges cannot disagree.
 *
 * Business rules (mirror docs/funder-workspace/dashboard-metrics.md):
 *  - "Active" = effective status is `active` OR `expiring_soon`.
 *    An expiring-soon release is a WARNING SUBSET of active — it is
 *    counted in both cards, never subtracted from Active.
 *  - "Expiring in 14 days" = effective status is `expiring_soon` (i.e.
 *    strictly in the future AND within 14 days). Already-expired
 *    releases NEVER count here, even if the DB row still says `active`.
 *  - Revoked and (effectively) expired releases are excluded from
 *    Active and from Expiring soon.
 *  - Null / malformed expiry: treated as `active` (server matches).
 *
 * Server-side counters (fw_counters_funder_v1) remain authoritative for
 * pack, RFI and decision counts. Documented gaps live in
 * docs/funder-workspace/dashboard-metrics.md.
 */
import type { DealReleaseRow } from "./types";
import { effectiveReleaseStatus } from "./release-state";

/** Releases that are currently active OR expiring-soon (warning subset). */
export function activeReleases(
  rows: readonly DealReleaseRow[],
  now: number = Date.now(),
): DealReleaseRow[] {
  return rows.filter((r) => {
    const s = effectiveReleaseStatus(r, now);
    return s === "active" || s === "expiring_soon";
  });
}

/** Releases that will expire within the next 14 days but are not yet expired. */
export function expiringSoonReleases(
  rows: readonly DealReleaseRow[],
  now: number = Date.now(),
): DealReleaseRow[] {
  return rows.filter((r) => effectiveReleaseStatus(r, now) === "expiring_soon");
}

export interface ClientReleaseMetrics {
  active: number;
  expiring_soon: number;
  expired: number;
  revoked: number;
  total: number;
}

/** One pass over the release list; used by the dashboard cards. */
export function computeReleaseMetrics(
  rows: readonly DealReleaseRow[],
  now: number = Date.now(),
): ClientReleaseMetrics {
  const m: ClientReleaseMetrics = {
    active: 0,
    expiring_soon: 0,
    expired: 0,
    revoked: 0,
    total: rows.length,
  };
  for (const r of rows) {
    const s = effectiveReleaseStatus(r, now);
    if (s === "active" || s === "expiring_soon") m.active += 1;
    if (s === "expiring_soon") m.expiring_soon += 1;
    if (s === "expired") m.expired += 1;
    if (s === "revoked") m.revoked += 1;
  }
  return m;
}
