/**
 * Canonical engagement read-model resolver — Batch B Phase 1.
 *
 * Today the database still enforces UNIQUE(match_id) on `poi_engagements`,
 * so every match has at most one row. Batch B Phase 2 will drop that
 * uniqueness constraint and allow multiple rows per match (an expired
 * parent + a renewed child + a transient
 * `late_acceptance_pending_initiator_reconfirmation` state). The Match
 * Details page, the Engagement Tracker, and every backend side-effect
 * gate must operate on a single, well-defined "current engagement" —
 * never on `.maybeSingle()` or "first row I happen to find".
 *
 * This resolver is the single source of truth for that selection. It is
 * shipped in Phase 1 BEFORE the schema change so every consumer can be
 * migrated to the new shape while it is still trivially correct (one
 * row → exactly one current engagement, empty history). Once Phase 2
 * adds renewal columns, only this file needs to learn the new rules.
 *
 * Selection rule (forward-compatible):
 *   • An engagement row is "active" iff its status is NOT in
 *     {"expired", "declined"}. Active rows are candidates for current.
 *   • The current engagement is the most-recently-created active row.
 *     If no active row exists, current_engagement = null.
 *   • latest_historical_engagement = most-recently-created terminal row
 *     (expired or declined). May overlap with current when there is
 *     only one row — in that case `latest_historical_engagement` is
 *     null (a row cannot be both current and historical).
 *   • history = every row except the current one, newest first.
 *
 * Backwards compatibility:
 *   • The legacy `engagement` field on the response remains populated
 *     with the current engagement (or, if none, the latest historical
 *     row) so any not-yet-migrated client keeps rendering the same row
 *     it always did.
 */

export type EngagementRow = {
  id: string;
  match_id: string;
  engagement_status: string;
  created_at: string;
  // Forward-compatible columns added in Phase 2 — optional today.
  renewed_from_engagement_id?: string | null;
  // Allow the resolver to be schema-permissive; consumers cast as needed.
  [key: string]: unknown;
};

export interface EngagementReadModel<R extends EngagementRow = EngagementRow> {
  current_engagement: R | null;
  latest_historical_engagement: R | null;
  history: R[];
  /** Bumped whenever the resolver semantics change. */
  read_model: "v1";
}

const TERMINAL_STATUSES = new Set(["expired", "declined"]);

export function isHistoricalEngagement(row: Pick<EngagementRow, "engagement_status">): boolean {
  return TERMINAL_STATUSES.has(row.engagement_status);
}

function byCreatedAtDesc(a: EngagementRow, b: EngagementRow): number {
  return (b.created_at || "").localeCompare(a.created_at || "");
}

/**
 * Reduce zero or more engagement rows for a single match into the
 * canonical read-model envelope. Pure, deterministic, no I/O.
 */
export function resolveEngagementReadModel<R extends EngagementRow>(
  rows: readonly R[],
): EngagementReadModel<R> {
  const sorted = [...rows].sort(byCreatedAtDesc);

  const active = sorted.filter((r) => !isHistoricalEngagement(r));
  const historical = sorted.filter((r) => isHistoricalEngagement(r));

  const current_engagement = active[0] ?? null;
  const latest_historical_engagement = historical[0] ?? null;

  // History = everything except the current row, newest first. When
  // there is no current row, the latest historical row IS the only
  // visible engagement, so it is surfaced via
  // `latest_historical_engagement` and excluded from `history` to avoid
  // duplicate rendering.
  const history = sorted.filter((r) => r.id !== current_engagement?.id && r.id !== latest_historical_engagement?.id);

  return {
    current_engagement,
    latest_historical_engagement,
    history,
    read_model: "v1",
  };
}

/**
 * Backwards-compatibility shim. Returns the row that pre-Phase-1 callers
 * would have received from `.maybeSingle()`: prefer the current
 * engagement, fall back to the most recent historical row, else null.
 */
export function legacyEngagementAlias<R extends EngagementRow>(
  model: EngagementReadModel<R>,
): R | null {
  return model.current_engagement ?? model.latest_historical_engagement ?? null;
}
