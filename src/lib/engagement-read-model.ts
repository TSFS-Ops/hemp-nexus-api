/**
 * Client mirror of `supabase/functions/_shared/engagement-read-model.ts`.
 *
 * Batch B Phase 1: every UI surface that previously assumed
 * one-engagement-per-match must now consume the canonical envelope
 *   { current_engagement, latest_historical_engagement, history,
 *     read_model: "v1" }
 * returned by `GET /poi-engagements/by-match/:matchId`. This file is the
 * single client-side type contract for that envelope.
 *
 * The resolver helpers (`resolveEngagementReadModel`, `isHistoricalEngagement`)
 * are re-exported in pure form so unit tests can pin selection behaviour
 * without spinning up an edge function.
 *
 * IMPORTANT: keep this file in lockstep with the Deno copy. Any change to
 * selection semantics MUST be made in both places and bump `read_model`.
 */

export type EngagementRow = {
  id: string;
  match_id: string;
  engagement_status: string;
  created_at: string;
  renewed_from_engagement_id?: string | null;
  [key: string]: unknown;
};

export interface EngagementReadModel<R extends EngagementRow = EngagementRow> {
  current_engagement: R | null;
  latest_historical_engagement: R | null;
  history: R[];
  read_model: "v1";
}

const TERMINAL_STATUSES = new Set(["expired", "declined"]);

export function isHistoricalEngagement(row: Pick<EngagementRow, "engagement_status">): boolean {
  return TERMINAL_STATUSES.has(row.engagement_status);
}

export function resolveEngagementReadModel<R extends EngagementRow>(
  rows: readonly R[],
): EngagementReadModel<R> {
  const sorted = [...rows].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const active = sorted.filter((r) => !isHistoricalEngagement(r));
  const historical = sorted.filter((r) => isHistoricalEngagement(r));
  const current_engagement = active[0] ?? null;
  const latest_historical_engagement = historical[0] ?? null;
  const history = sorted.filter(
    (r) => r.id !== current_engagement?.id && r.id !== latest_historical_engagement?.id,
  );
  return { current_engagement, latest_historical_engagement, history, read_model: "v1" };
}

/**
 * Defensive parser for the `by-match` response. Accepts both the new
 * envelope and the legacy `{ engagement }` shape so a stale edge-function
 * deployment never blanks the UI.
 */
export function parseByMatchResponse<R extends EngagementRow>(
  raw: unknown,
): EngagementReadModel<R> {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (obj.read_model === "v1") {
      return {
        current_engagement: (obj.current_engagement as R | null) ?? null,
        latest_historical_engagement: (obj.latest_historical_engagement as R | null) ?? null,
        history: (obj.history as R[] | undefined) ?? [],
        read_model: "v1",
      };
    }
    if ("engagement" in obj) {
      const row = obj.engagement as R | null;
      return resolveEngagementReadModel(row ? [row] : []);
    }
  }
  return resolveEngagementReadModel<R>([]);
}
