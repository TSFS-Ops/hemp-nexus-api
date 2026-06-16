/**
 * Batch O Phase 1 — Canonical Match Lifecycle Predicates (EDGE MIRROR)
 *
 * Pure deterministic predicates. NO database mutation, NO audit writes,
 * NO notification sends, NO UI behaviour, NO schema reads.
 *
 * This file MUST stay byte-for-byte identical (within the MIRROR-START /
 * MIRROR-END markers) with `src/lib/match-lifecycle.ts`.
 * Drift is enforced by `scripts/check-match-lifecycle-mirror.mjs`.
 *
 * Source of truth: signed Client Workflow Decision Form — MT-008, MT-009, MT-012.
 */

// MIRROR-START
export type LifecycleMatch = {
  status?: string | null;
  state?: string | null;
  poi_state?: string | null;
  settled_at?: string | Date | null;
  completed_at?: string | Date | null;
  buyer_committed_at?: string | Date | null;
  seller_committed_at?: string | Date | null;
  buyer_org_id?: string | null;
  seller_org_id?: string | null;
  buyer_authorised_user_id?: string | null;
  seller_authorised_user_id?: string | null;
  buyer_contact_user_id?: string | null;
  seller_contact_user_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type LifecycleChild = {
  status?: string | null;
  state?: string | null;
  poi_state?: string | null;
  settled_at?: string | Date | null;
  completed_at?: string | Date | null;
  metadata?: Record<string, unknown> | null;
};

export type NamedContactGap = "buyer" | "seller" | "both" | null;

/**
 * MT-009 Phase 1: controlled named contact record (subset used by the
 * predicate). Pure: only the fields needed to evaluate satisfaction.
 */
export type ActiveNamedContact = {
  side: "buyer" | "seller";
  status?: string | null;
};

const TERMINAL_POI_STATES = new Set([
  "EXPIRED",
  "REJECTED",
  "ANNULLED",
  "CANCELLED",
  "COMPLETED",
  "SETTLED",
]);

const TERMINAL_STATUSES = new Set(["completed", "cancelled", "annulled"]);
const TERMINAL_STATES = new Set(["completed", "cancelled", "annulled"]);

function hasMarker(m: LifecycleMatch | LifecycleChild, key: string): boolean {
  const md = m.metadata;
  if (!md || typeof md !== "object") return false;
  const v = (md as Record<string, unknown>)[key];
  return v === true || v === "true" || v === 1;
}

/** A match is terminal if its lifecycle has clearly ended. */
export function isTerminalMatch(m: LifecycleMatch | LifecycleChild): boolean {
  const status = (m.status ?? "").toString();
  const state = (m.state ?? "").toString();
  const poi = (m.poi_state ?? "").toString();
  if (TERMINAL_STATUSES.has(status)) return true;
  if (TERMINAL_STATES.has(state)) return true;
  if (TERMINAL_POI_STATES.has(poi)) return true;
  if (m.completed_at != null && state === "completed") return true;
  return false;
}

/**
 * A match is "active" iff it is NOT terminal AND NOT inconsistent AND
 * NOT held by an admin lifecycle marker. Used later (Phase 2+) to filter
 * normal user views and route inconsistent rows to admin repair.
 */
export function isActiveMatch(m: LifecycleMatch): boolean {
  if (isTerminalMatch(m)) return false;
  if (isInconsistentMatch(m)) return false;
  if (hasMarker(m, "parent_archived_admin_exception_hold")) return false;
  if (hasMarker(m, "legacy_archived_admin_hold")) return false;
  return true;
}

/**
 * Stable ordered list of inconsistency reason codes for a match row.
 * Pure: deterministic, no I/O, no mutation. Order is fixed so callers
 * (admin chips, audit signatures) can rely on it.
 *
 * Invariant: `isInconsistentMatch(m) === (inconsistencyReasons(m).length > 0)`.
 */
export type InconsistencyReason =
  | "legacy_repair_required"
  | "state_reconciliation_required"
  | "settled_with_draft_poi"
  | "completed_state_with_open_poi"
  | "settled_at_without_settled_status"
  | "both_committed_but_still_discovery"
  | "same_org_both_sides";

export function inconsistencyReasons(
  m: LifecycleMatch | LifecycleChild,
): InconsistencyReason[] {
  const reasons: InconsistencyReason[] = [];
  const status = (m.status ?? "").toString();
  const state = (m.state ?? "").toString();
  const poi = (m.poi_state ?? "").toString();

  // Explicit operator markers
  if (hasMarker(m, "legacy_repair_required")) reasons.push("legacy_repair_required");
  if (hasMarker(m, "state_reconciliation_required")) reasons.push("state_reconciliation_required");

  // settled status with a draft POI
  if (status === "settled" && poi === "DRAFT") reasons.push("settled_with_draft_poi");

  // completed state but POI is not in a terminal/post-issue state
  if (state === "completed" && poi !== "" && !TERMINAL_POI_STATES.has(poi) && poi !== "ISSUED") {
    reasons.push("completed_state_with_open_poi");
  }

  // settled_at present but status not settled (and not a later terminal)
  if (m.settled_at != null && status !== "settled" && !TERMINAL_STATUSES.has(status)) {
    reasons.push("settled_at_without_settled_status");
  }

  // both sides committed but state is still discovery
  const matchOnly = m as LifecycleMatch;
  if (
    matchOnly.buyer_committed_at != null &&
    matchOnly.seller_committed_at != null &&
    state === "discovery"
  ) {
    reasons.push("both_committed_but_still_discovery");
  }

  // same organisation on both sides of the match (only meaningful on the
  // parent match row, child rows do not carry org ids)
  if (
    matchOnly.buyer_org_id != null &&
    matchOnly.seller_org_id != null &&
    matchOnly.buyer_org_id === matchOnly.seller_org_id
  ) {
    reasons.push("same_org_both_sides");
  }

  return reasons;
}

/**
 * Detect contradictory lifecycle data. Conservative: only flag when the
 * contradiction is unambiguous so we do not mass-mark legitimate rows.
 *
 * Equivalent to `inconsistencyReasons(m).length > 0`.
 */
export function isInconsistentMatch(m: LifecycleMatch | LifecycleChild): boolean {
  return inconsistencyReasons(m).length > 0;
}

/**
 * MT-009: detect organisation-attached rows missing a named buyer/seller
 * authorised contact. Returns which side is missing.
 *
 * A side is satisfied when ANY of:
 *   1. `{side}_authorised_user_id` (registered Izenzo user - strongest);
 *   2. legacy optional `{side}_contact_user_id`;
 *   3. an active controlled named contact for that side in
 *      `activeNamedContacts` (status === 'active').
 *
 * Pure: caller supplies pre-fetched active named contacts. The predicate
 * does NOT read the DB.
 *
 * Returns null when no organisation is attached on either side - there is
 * no named-contact requirement for fully unattached rows.
 */
export function requiresNamedContact(
  m: LifecycleMatch,
  activeNamedContacts: ReadonlyArray<ActiveNamedContact> = [],
): NamedContactGap {
  const buyerOrg = m.buyer_org_id ?? null;
  const sellerOrg = m.seller_org_id ?? null;
  if (!buyerOrg && !sellerOrg) return null;

  let buyerHasControlled = false;
  let sellerHasControlled = false;
  for (const c of activeNamedContacts) {
    if ((c.status ?? "active") !== "active") continue;
    if (c.side === "buyer") buyerHasControlled = true;
    else if (c.side === "seller") sellerHasControlled = true;
  }

  const buyerNamed =
    m.buyer_authorised_user_id ?? m.buyer_contact_user_id ?? null;
  const sellerNamed =
    m.seller_authorised_user_id ?? m.seller_contact_user_id ?? null;

  const buyerMissing = !!buyerOrg && !buyerNamed && !buyerHasControlled;
  const sellerMissing = !!sellerOrg && !sellerNamed && !sellerHasControlled;

  if (buyerMissing && sellerMissing) return "both";
  if (buyerMissing) return "buyer";
  if (sellerMissing) return "seller";
  return null;
}

/**
 * MT-012 helper: returns true iff the supplied child matches contain at
 * least one row that is non-terminal AND active (i.e. would block archive
 * of the parent trade request).
 *
 * Pure: caller is responsible for fetching the child rows. No I/O here.
 */
export function hasActiveChildMatches(children: ReadonlyArray<LifecycleChild>): boolean {
  for (const c of children) {
    if (isTerminalMatch(c)) continue;
    // Reuse active rules but child rows have no org/contact fields, so we
    // only check terminal + inconsistent + exception/legacy hold markers.
    if (isInconsistentMatch(c)) continue;
    if (hasMarker(c, "parent_archived_admin_exception_hold")) continue;
    if (hasMarker(c, "legacy_archived_admin_hold")) continue;
    return true;
  }
  return false;
}
// MIRROR-END

