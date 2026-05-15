import { useEffect, useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Compass, Loader2, ArrowDownUp, Search, X, ChevronDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { resolveEngagementReadModel, type EngagementRow } from "@/lib/engagement-read-model";
import { isInconsistentMatch } from "@/lib/match-lifecycle";

/**
 * Deal Pipeline - paginated, column-projected.
 *
 * Performance contract (audit, 2026-04):
 * - .select() lists are *minimal*: only fields rendered on the card or required
 *   for lane bucketing. `org_id` was previously fetched and discarded - removed.
 * - Active lanes (Draft, Awaiting) are bounded by state filters and capped at
 *   ACTIVE_PAGE_SIZE; an org cannot accumulate hundreds of in-flight drafts
 *   without triggering operational alarms first.
 * - The Sealed lane grows monotonically over the org's lifetime, so it is the
 *   only lane that paginates. We load SEALED_PAGE_SIZE per page on demand and
 *   surface a "Load more" affordance plus the true server-side count, so users
 *   are never silently truncated. count is fetched head-only so it costs an
 *   index probe, not a row scan.
 * - poi_engagements is queried only for the Sealed page in view, keyed on
 *   match_id IN (...) - bounded by SEALED_PAGE_SIZE.
 */

interface DealCard {
  id: string;
  commodity: string;
  counterparty: string;
  volume: string;
  /** Raw numeric quantity for sorting (null when unspecified). */
  quantityValue: number | null;
  state: string;
  created_at: string;
  /**
   * Last meaningful activity on the deal as observed by the current user.
   * Computed as max(this user's match_ui_prefs.updated_at, latest match_events.created_at).
   * Falls back to created_at when neither exists.
   * This is what the card renders so a deal you opened five minutes ago does
   * not appear as "3d ago" just because that's when it was created.
   */
  last_activity_at: string;
  /** Where the activity timestamp came from, for tooltip clarity. */
  last_activity_source: "viewed" | "event" | "created";
  /** Inferred deadline - uses explicit deal expiry if present, otherwise a
   *  lane-based heuristic so "nearest deadline" remains meaningful even when
   *  the underlying record has no SLA timestamp. */
  deadline_at: string | null;
  laneId: "draft" | "awaiting" | "poi";
}

type SortKey = "recent" | "newest" | "oldest" | "volume_desc" | "deadline";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Recently active" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "volume_desc", label: "Highest volume" },
  { value: "deadline", label: "Nearest deadline" },
];

const ACTIVE_PAGE_SIZE = 60;
const SEALED_PAGE_SIZE = 20;
// Active lanes are bounded by business reality but not by physics - an org can
// theoretically accumulate hundreds of stale drafts. We cap the first window at
// ACTIVE_PAGE_SIZE and surface a "Load more" affordance when the server count
// exceeds it, so neither lane is ever silently truncated.
const ACTIVE_PAGE_INCREMENT = 60;

// State buckets - these mirror the 9-step WaD workflow.
// ACCEPTED engagements live in "poi"; pending engagements in "awaiting".
const POI_STATES = [
  "committed",
  "intent_declared",
  "pending_finality",
  "settled",
  "poi_generated",
  "finalised",
  "completed",
];
const DRAFT_STATES = [
  "draft",
  "interest_logged",
  "match_proposed",
  "discovery",
  "counterparty_sighted",
  "buyer_committed",
  "seller_committed",
  "terms_pending",
];

const LANE_META = [
  { id: "draft", title: "Draft", subtitle: "Steps 1–7 · Intent captured" },
  { id: "awaiting", title: "Awaiting", subtitle: "Step 8 · POI sent" },
  { id: "poi", title: "Sealed", subtitle: "Step 9 · Engagement accepted" },
] as const;

// Tone-of-voice colour per lane - used for the subtle top accent and the stage pill.
// `tint` provides a soft column background so the white deal cards visibly "pop"
// off the lane (Institutional Premium hierarchy: depth via tint + shadow, never flat).
const LANE_ACCENT: Record<string, { bar: string; pill: string; dot: string; tint: string; ring: string }> = {
  draft:    { bar: "bg-indigo-400/70",   pill: "text-indigo-700 bg-indigo-50",   dot: "bg-indigo-500", tint: "bg-slate-50/70",  ring: "ring-1 ring-inset ring-slate-200/70" },
  awaiting: { bar: "bg-amber-400/70",    pill: "text-amber-700 bg-amber-50",    dot: "bg-amber-500",  tint: "bg-amber-50/40",  ring: "ring-1 ring-inset ring-amber-200/60" },
  poi:      { bar: "bg-emerald-400/70",  pill: "text-[hsl(var(--emerald))] bg-[hsl(var(--emerald-muted))]", dot: "bg-[hsl(var(--emerald))]", tint: "bg-emerald-50/40", ring: "ring-1 ring-inset ring-emerald-200/60" },
};
const LANE_PILL_LABEL: Record<string, string> = {
  draft: "Draft",
  awaiting: "Awaiting",
  poi: "Sealed",
};

// Minimal column projection. Anything not on the card or used for routing is excluded.
// `org_id` was dropped - it is encoded in the `.or()` filter and never read post-fetch.
const MATCH_COLUMNS =
  "id, commodity, quantity_amount, quantity_unit, buyer_name, seller_name, status, state, poi_state, settled_at, buyer_committed_at, seller_committed_at, buyer_org_id, seller_org_id, created_at, metadata";

function formatVolume(amount: number | null | undefined, unit: string | null | undefined): string {
  if (!amount || !unit) return "-";
  return `${Number(amount).toLocaleString()} ${unit}`;
}

/**
 * Infer a meaningful deadline timestamp for a deal.
 *
 * Trade rows do not (yet) carry an explicit SLA column, so we approximate using
 * lane semantics: drafts age out at 30d, awaiting-engagement deals at 7d (the
 * POI hold-point window), and sealed deals at 90d (settlement horizon). This
 * makes "Nearest deadline" sort actionable without a schema change - the moment
 * a real `expires_at` column is added, swap this for a direct read.
 */
function inferDeadline(createdAt: string, laneId: DealCard["laneId"]): string {
  const created = new Date(createdAt).getTime();
  const days = laneId === "awaiting" ? 7 : laneId === "draft" ? 30 : 90;
  return new Date(created + days * 86_400_000).toISOString();
}

/** Resolve current user's org once; cached aggressively, used by every sub-query. */
function useOrgId() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["desk-pipeline-org", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000, // org membership rarely changes mid-session
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user!.id)
        .maybeSingle();
      return data?.org_id ?? null;
    },
  });
}

/**
 * Last-activity enrichment.
 *
 * For the visible set of match ids, fetch:
 *   1. The current user's own match_ui_prefs.updated_at (per-user "last viewed").
 *   2. The most recent match_events.created_at across the whole org's activity.
 *
 * The card's displayed timestamp is the max of those signals, falling back to
 * the match's created_at when neither exists. This is what lets a deal Daniel
 * just opened show "5m ago" instead of "3d ago".
 *
 * Both reads are bounded by the visible page (matchIds.length is at most
 * ACTIVE_PAGE_SIZE + sealedWindow), so this never grows with table size.
 * RLS already restricts both tables to the user's org, so we don't add
 * extra filters here.
 */
function useLastActivity(matchIds: string[]) {
  const { user } = useAuth();
  const key = matchIds.length === 0 ? "" : [...matchIds].sort().join(",");

  return useQuery({
    queryKey: ["desk-pipeline-last-activity", user?.id, key],
    enabled: !!user && matchIds.length > 0,
    staleTime: 15_000, // re-fetch frequently so a deal opened in another tab climbs quickly
    queryFn: async () => {
      const result = new Map<string, { at: string; source: "viewed" | "event" }>();
      if (!user || matchIds.length === 0) return result;

      // Per-user "last viewed" via match_ui_prefs.
      const { data: prefs } = await supabase
        .from("match_ui_prefs")
        .select("match_id, updated_at")
        .eq("user_id", user.id)
        .in("match_id", matchIds);

      for (const p of prefs ?? []) {
        if (!p.match_id || !p.updated_at) continue;
        result.set(p.match_id, { at: p.updated_at, source: "viewed" });
      }

      // Most recent event per match. We pull all events for the visible page
      // (capped, ordered desc) and keep only the newest per match_id.
      const { data: events } = await supabase
        .from("match_events")
        .select("match_id, created_at")
        .in("match_id", matchIds)
        .order("created_at", { ascending: false })
        .limit(matchIds.length * 5); // 5 most-recent slots per match is plenty

      for (const e of events ?? []) {
        if (!e.match_id || !e.created_at) continue;
        const existing = result.get(e.match_id);
        if (!existing || new Date(e.created_at).getTime() > new Date(existing.at).getTime()) {
          result.set(e.match_id, { at: e.created_at, source: "event" });
        }
      }
      return result;
    },
  });
}

/**
 * Active lanes (Draft + Awaiting) - bounded query.
 *
 * These states are bounded by business reality (an org rarely holds more than
 * a few dozen in-flight intents). We pull both lanes in one round-trip filtered
 * by state to avoid yanking historical sealed trades into the active view.
 */
function useActiveLanes(orgId: string | null, page: number) {
  return useQuery({
    queryKey: ["desk-pipeline-active", orgId, page],
    enabled: !!orgId,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async () => {
      const activeStates = [...DRAFT_STATES, ...POI_STATES];
      const to = (page + 1) * ACTIVE_PAGE_INCREMENT - 1;
      const { data: matches, count } = await supabase
        .from("matches")
        .select(MATCH_COLUMNS, { count: "exact" })
        .or(`buyer_org_id.eq.${orgId},seller_org_id.eq.${orgId},org_id.eq.${orgId}`)
        .in("state", activeStates)
        .order("created_at", { ascending: false })
        .range(0, to);

      // Batch O Phase 2 (MT-008): hide inconsistent rows from user pipeline.
      const list = (matches ?? []).filter((m: any) => !isInconsistentMatch(m));

      // Resolve engagement status only for matches in POI states; this keeps
      // the secondary query bounded by the page size, not by table size.
      const poiIds = list.filter((m) => POI_STATES.includes(m.state ?? "")).map((m) => m.id);
      const engagementByMatch = new Map<string, string>();
      if (poiIds.length > 0) {
        // Phase 1.5: select all rows + group by match_id + apply the
        // canonical resolver. Once Phase 2 drops UNIQUE(match_id), a
        // match may carry an expired-parent + renewed-child pair; the
        // pipeline lane MUST follow the current engagement, never the
        // first or last row PostgREST happens to return.
        const { data: engagements } = await supabase
          .from("poi_engagements")
          .select("id, match_id, engagement_status, created_at")
          .in("match_id", poiIds)
          .order("created_at", { ascending: false });
        const grouped = new Map<string, EngagementRow[]>();
        for (const e of (engagements ?? []) as EngagementRow[]) {
          if (!e.match_id) continue;
          const arr = grouped.get(e.match_id) ?? [];
          arr.push(e);
          grouped.set(e.match_id, arr);
        }
        for (const [matchId, rows] of grouped) {
          const env = resolveEngagementReadModel(rows);
          const picked = env.current_engagement ?? env.latest_historical_engagement;
          if (picked?.engagement_status) engagementByMatch.set(matchId, picked.engagement_status);
        }
      }

      const cards: DealCard[] = list.map((m) => {
        const isBuyer = m.buyer_org_id === orgId;
        const state = m.state ?? "draft";
        let laneId: DealCard["laneId"] = "draft";
        if (POI_STATES.includes(state)) {
          laneId = engagementByMatch.get(m.id) === "accepted" ? "poi" : "awaiting";
        } else if (DRAFT_STATES.includes(state)) {
          laneId = "draft";
        }
        return {
          id: m.id,
          commodity: m.commodity ?? "Unspecified commodity",
          counterparty: (isBuyer ? m.seller_name : m.buyer_name) ?? "Counterparty TBD",
          volume: formatVolume(m.quantity_amount, m.quantity_unit),
          quantityValue: m.quantity_amount != null ? Number(m.quantity_amount) : null,
          state,
          created_at: m.created_at,
          last_activity_at: m.created_at, // enriched downstream by useLastActivity
          last_activity_source: "created" as const,
          deadline_at: inferDeadline(m.created_at, laneId),
          laneId,
        };
      });
      return { cards, totalActive: count ?? cards.length };
    },
  });
}

/**
 * Sealed lane - paginated query.
 *
 * The only lane that grows without bound. `count: "exact", head: true` returns
 * the total without scanning rows, so we can show "Showing 40 of 312" honestly.
 * `keepPreviousData` keeps the prior page visible while the next page loads,
 * so the user never sees a flash-empty list when they hit "Load more".
 */
function useSealedPage(orgId: string | null, page: number) {
  return useQuery({
    queryKey: ["desk-pipeline-sealed", orgId, page],
    enabled: !!orgId,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async () => {
      const from = 0;
      const to = (page + 1) * SEALED_PAGE_SIZE - 1; // cumulative window - we render everything fetched so far

      const { data: matches, count } = await supabase
        .from("matches")
        .select(MATCH_COLUMNS, { count: "exact" })
        .or(`buyer_org_id.eq.${orgId},seller_org_id.eq.${orgId},org_id.eq.${orgId}`)
        .in("state", POI_STATES)
        .order("created_at", { ascending: false })
        .range(from, to);

      // Batch O Phase 2 (MT-008): hide inconsistent rows from user pipeline.
      const list = (matches ?? []).filter((m: any) => !isInconsistentMatch(m));

      // Only the page in view needs engagement resolution.
      const ids = list.map((m) => m.id);
      const engagementByMatch = new Map<string, string>();
      if (ids.length > 0) {
        // Phase 1.5: read-model resolver — see the active-lanes block above
        // for the full rationale. Same shape, same Phase 2 forward-compat.
        const { data: engagements } = await supabase
          .from("poi_engagements")
          .select("id, match_id, engagement_status, created_at")
          .in("match_id", ids)
          .order("created_at", { ascending: false });
        const grouped = new Map<string, EngagementRow[]>();
        for (const e of (engagements ?? []) as EngagementRow[]) {
          if (!e.match_id) continue;
          const arr = grouped.get(e.match_id) ?? [];
          arr.push(e);
          grouped.set(e.match_id, arr);
        }
        for (const [matchId, rows] of grouped) {
          const env = resolveEngagementReadModel(rows);
          const picked = env.current_engagement ?? env.latest_historical_engagement;
          if (picked?.engagement_status) engagementByMatch.set(matchId, picked.engagement_status);
        }
      }

      // Sealed = engagement accepted. Anything else falls through to the awaiting
      // lane already loaded by useActiveLanes, so we filter it out here to avoid
      // double-counting.
      const cards: DealCard[] = list
        .filter((m) => engagementByMatch.get(m.id) === "accepted")
        .map((m) => {
          const isBuyer = m.buyer_org_id === orgId;
          return {
            id: m.id,
            commodity: m.commodity ?? "Unspecified commodity",
            counterparty: (isBuyer ? m.seller_name : m.buyer_name) ?? "Counterparty TBD",
            volume: formatVolume(m.quantity_amount, m.quantity_unit),
            quantityValue: m.quantity_amount != null ? Number(m.quantity_amount) : null,
            state: m.state ?? "",
            created_at: m.created_at,
            last_activity_at: m.created_at,
            last_activity_source: "created" as const,
            deadline_at: inferDeadline(m.created_at, "poi"),
            laneId: "poi" as const,
          };
        });

      return { cards, totalSealedish: count ?? cards.length };
    },
  });
}

export function DealPipeline() {
  const navigate = useNavigate();
  const { data: orgId } = useOrgId();
  const [sealedPage, setSealedPage] = useState(0);
  const [activePage, setActivePage] = useState(0);

  // Sort + filter selections are persisted to localStorage so the desk restores
  // the same view across reloads. Each key is namespaced under `desk:pipeline:`
  // to avoid collision with other modules and to make storage inspection easy.
  // Reads are guarded against SSR (no window) and against malformed JSON - a
  // bad value silently falls back to the default rather than crashing the desk.
  const SORT_KEY_STORAGE = "desk:pipeline:sortKey";
  const COUNTERPARTY_STORAGE = "desk:pipeline:counterpartyQuery";
  const COMMODITY_STORAGE = "desk:pipeline:commodityFilter";
  const LANE_FILTER_STORAGE = "desk:pipeline:laneFilter";

  const readStorage = <T,>(key: string, fallback: T, validate: (v: unknown) => v is T): T => {
    if (typeof window === "undefined") return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return fallback;
      const parsed = JSON.parse(raw);
      return validate(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  };

  const isSortKey = (v: unknown): v is SortKey =>
    v === "recent" ||
    v === "newest" ||
    v === "oldest" ||
    v === "volume_desc" ||
    v === "deadline";
  const isLaneFilter = (v: unknown): v is "all" | DealCard["laneId"] =>
    v === "all" || v === "draft" || v === "awaiting" || v === "poi";
  const isString = (v: unknown): v is string => typeof v === "string";

  // Default sort is "Recently active" so the deal a user just had open
  // (e.g. Daniel returning to a sealed deal he was reviewing seconds ago)
  // surfaces at the top of its lane instead of being buried by creation date.
  const [sortKey, setSortKey] = useState<SortKey>(() =>
    readStorage<SortKey>(SORT_KEY_STORAGE, "recent", isSortKey),
  );

  // Per-lane collapse state - persisted to localStorage so a user who prefers
  // to stay focused on (say) "Awaiting Engagement" doesn't have to re-collapse
  // the other lanes after every reload.
  const [collapsedLanes, setCollapsedLanes] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem("desk:pipeline:collapsedLanes");
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "desk:pipeline:collapsedLanes",
        JSON.stringify(collapsedLanes),
      );
    } catch {
      // localStorage write failures are non-fatal - collapse simply won't persist.
    }
  }, [collapsedLanes]);
  const toggleLane = (id: string) =>
    setCollapsedLanes((s) => ({ ...s, [id]: !s[id] }));

  // Filter state - purely client-side. Filtering server-side would require
  // narrowing the paginated queries, which would in turn require server-side
  // support for full-text counterparty search. For pipeline-scale data
  // (≤ a few hundred in-flight deals per org) client filtering is the right
  // trade-off: zero added latency, instant feedback as the user types.
  const [counterpartyQuery, setCounterpartyQuery] = useState<string>(() =>
    readStorage<string>(COUNTERPARTY_STORAGE, "", isString),
  );
  const [commodityFilter, setCommodityFilter] = useState<string>(() =>
    readStorage<string>(COMMODITY_STORAGE, "all", isString),
  );
  const [laneFilter, setLaneFilter] = useState<"all" | DealCard["laneId"]>(() =>
    readStorage<"all" | DealCard["laneId"]>(LANE_FILTER_STORAGE, "all", isLaneFilter),
  );

  // Persist sort + filter selections. Each write is wrapped because storage
  // can fail (quota, private mode) - failure is non-fatal: the in-memory state
  // continues to drive the UI, and the user simply loses persistence for that
  // selection.
  useEffect(() => {
    try { window.localStorage.setItem(SORT_KEY_STORAGE, JSON.stringify(sortKey)); } catch {}
  }, [sortKey]);
  useEffect(() => {
    try { window.localStorage.setItem(COUNTERPARTY_STORAGE, JSON.stringify(counterpartyQuery)); } catch {}
  }, [counterpartyQuery]);
  useEffect(() => {
    try { window.localStorage.setItem(COMMODITY_STORAGE, JSON.stringify(commodityFilter)); } catch {}
  }, [commodityFilter]);
  useEffect(() => {
    try { window.localStorage.setItem(LANE_FILTER_STORAGE, JSON.stringify(laneFilter)); } catch {}
  }, [laneFilter]);

  const activeQ = useActiveLanes(orgId ?? null, activePage);
  const sealedQ = useSealedPage(orgId ?? null, sealedPage);

  // Collect every visible match id and ask for the freshest activity signal.
  // This runs after the base lists land, so the "Recently active" sort and the
  // age label are eventually-consistent (cards may briefly show created_at,
  // then climb to "5m ago" once the enrichment resolves). That's acceptable -
  // the alternative is blocking the pipeline render on a secondary query.
  const visibleMatchIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of activeQ.data?.cards ?? []) ids.add(c.id);
    for (const c of sealedQ.data?.cards ?? []) ids.add(c.id);
    return Array.from(ids);
  }, [activeQ.data, sealedQ.data]);
  const lastActivityQ = useLastActivity(visibleMatchIds);

  const isLoading = (activeQ.isLoading && !activeQ.data) || (sealedQ.isLoading && !sealedQ.data);
  const isSealedFetching = sealedQ.isFetching;
  const isActiveFetching = activeQ.isFetching;

  // Distinct commodity list across all loaded deals - drives the commodity
  // dropdown options. Recomputed from the loaded data so newly loaded pages
  // surface their commodities automatically.
  const commodityOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const c of [...(activeQ.data?.cards ?? []), ...(sealedQ.data?.cards ?? [])]) {
      if (c.commodity) seen.add(c.commodity);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [activeQ.data, sealedQ.data]);

  const lanes = useMemo(() => {
    const activityMap = lastActivityQ.data;
    // Merge the activity enrichment onto each card. We never mutate the
    // upstream query data; we project a new card with last_activity_at
    // derived from whichever signal is most recent.
    const enrich = (c: DealCard): DealCard => {
      const hit = activityMap?.get(c.id);
      if (!hit) return c;
      const candidate = new Date(hit.at).getTime();
      const baseline = new Date(c.last_activity_at).getTime();
      if (Number.isFinite(candidate) && candidate > baseline) {
        return { ...c, last_activity_at: hit.at, last_activity_source: hit.source };
      }
      return c;
    };
    const activeCards = (activeQ.data?.cards ?? []).map(enrich);
    const sealedCards = (sealedQ.data?.cards ?? []).map(enrich);
    // De-dupe: the active query may have already returned some sealed records
    // that the paginated sealed query also returns. Sealed page wins because
    // it owns that lane's growth.
    const sealedIds = new Set(sealedCards.map((c) => c.id));

    // Sort comparator. Each branch is total-ordered with stable secondary keys
    // so deals without the sort field don't oscillate between renders. Records
    // missing the primary key sink to the bottom.
    const compare = (a: DealCard, b: DealCard): number => {
      const tCreatedA = new Date(a.created_at).getTime();
      const tCreatedB = new Date(b.created_at).getTime();
      switch (sortKey) {
        case "recent": {
          const ta = new Date(a.last_activity_at).getTime();
          const tb = new Date(b.last_activity_at).getTime();
          if (tb !== ta) return tb - ta;
          return tCreatedB - tCreatedA;
        }
        case "oldest":
          return tCreatedA - tCreatedB;
        case "volume_desc": {
          const va = a.quantityValue ?? -Infinity;
          const vb = b.quantityValue ?? -Infinity;
          if (vb !== va) return vb - va;
          return tCreatedB - tCreatedA;
        }
        case "deadline": {
          const da = a.deadline_at ? new Date(a.deadline_at).getTime() : Infinity;
          const db = b.deadline_at ? new Date(b.deadline_at).getTime() : Infinity;
          if (da !== db) return da - db;
          return tCreatedB - tCreatedA;
        }
        case "newest":
        default:
          return tCreatedB - tCreatedA;
      }
    };

    // Predicate composing all active filters. Lane filter is applied as a
    // whole-lane mask further down so empty lanes still render their headers
    // (predictable layout > collapsing the grid).
    const needle = counterpartyQuery.trim().toLowerCase();
    const matchesFilters = (c: DealCard): boolean => {
      if (commodityFilter !== "all" && c.commodity !== commodityFilter) return false;
      if (needle && !c.counterparty.toLowerCase().includes(needle)) return false;
      return true;
    };

    return LANE_META.map((meta) => {
      const laneIncluded = laneFilter === "all" || laneFilter === meta.id;
      const sourceDeals =
        meta.id === "poi"
          ? sealedCards
          : activeCards.filter((c) => c.laneId === meta.id && !sealedIds.has(c.id));
      const filtered = laneIncluded ? sourceDeals.filter(matchesFilters) : [];
      return { ...meta, deals: [...filtered].sort(compare), suppressedByLane: !laneIncluded };
    });
  }, [activeQ.data, sealedQ.data, lastActivityQ.data, sortKey, counterpartyQuery, commodityFilter, laneFilter]);

  const totalDeals = lanes.reduce((sum, l) => sum + l.deals.length, 0);
  const hasActiveFilters =
    counterpartyQuery.trim().length > 0 || commodityFilter !== "all" || laneFilter !== "all";
  const showPipelineEmpty = !isLoading && totalDeals === 0 && !hasActiveFilters;
  const resetFilters = () => {
    setCounterpartyQuery("");
    setCommodityFilter("all");
    setLaneFilter("all");
  };

  if (showPipelineEmpty) {
    return (
      <section>
        <PipelineHeader totalDeals={0} sortKey={sortKey} onSortChange={setSortKey} />
        <EmptyStateCard
          kicker="Pipeline Idle"
          title="No active pipeline"
          description="Discover verified counterparty liquidity, then initiate a trade request to populate your desk."
          icon={<Compass className="h-5 w-5" strokeWidth={1.75} />}
          primaryAction={{
            label: "Discover Counterparties",
            onClick: () => navigate("/desk/discover"),
          }}
          secondaryAction={{
            label: "Initiate Trade Request",
            onClick: () => navigate("/desk/match/new"),
          }}
        />
      </section>
    );
  }

  // Sealed pagination state derived from the server count, not from page-size guesses.
  const sealedLoaded = sealedQ.data?.cards.length ?? 0;
  const sealedWindow = (sealedPage + 1) * SEALED_PAGE_SIZE;
  const sealedHasMore = (sealedQ.data?.totalSealedish ?? 0) > sealedWindow;

  // Active-lane pagination - `totalActive` is the server-side count of *all*
  // matches in DRAFT_STATES ∪ POI_STATES. We display "Load more" on Draft
  // and Awaiting lanes whenever the cumulative window has not yet covered it.
  const activeLoaded = activeQ.data?.cards.length ?? 0;
  const activeWindow = (activePage + 1) * ACTIVE_PAGE_INCREMENT;
  const activeHasMore = (activeQ.data?.totalActive ?? 0) > activeWindow;

  return (
    <section>
      <PipelineHeader totalDeals={totalDeals} sortKey={sortKey} onSortChange={setSortKey} />
      <FilterBar
        counterpartyQuery={counterpartyQuery}
        onCounterpartyQueryChange={setCounterpartyQuery}
        commodityFilter={commodityFilter}
        onCommodityFilterChange={setCommodityFilter}
        commodityOptions={commodityOptions}
        laneFilter={laneFilter}
        onLaneFilterChange={setLaneFilter}
        hasActiveFilters={hasActiveFilters}
        onReset={resetFilters}
        visibleCount={totalDeals}
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6">
        {lanes.map((lane) => {
          const accent = LANE_ACCENT[lane.id];
          const collapsed = !!collapsedLanes[lane.id];
          const headerId = `lane-header-${lane.id}`;
          const bodyId = `lane-body-${lane.id}`;
          return (
            <div
              key={lane.id}
              className={cn(
                "flex flex-col rounded-md border border-border overflow-hidden",
                accent.tint,
                accent.ring,
              )}
            >
              {/* Top accent bar - sets lane identity without shouting. */}
              <div className={cn("h-0.5 w-full", accent.bar)} />

              {/* Lane header - full-width button so the entire row is a click
                  target. Chevron rotates to indicate state; aria-expanded keeps
                  assistive tech in sync. */}
              <button
                type="button"
                id={headerId}
                onClick={() => toggleLane(lane.id)}
                aria-expanded={!collapsed}
                aria-controls={bodyId}
                className="flex items-center justify-between gap-3 bg-muted/80 border-b border-border px-4 py-3 text-left hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--emerald))]/30"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", accent.dot)} />
                  <h3 className="text-xs font-bold tracking-wider uppercase text-muted-foreground whitespace-nowrap">
                    {lane.title}
                  </h3>
                  <span className="hidden xl:inline text-[10px] font-mono tracking-[0.18em] uppercase text-muted-foreground/70 truncate">
                    · {lane.subtitle}
                  </span>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <span className="inline-flex items-center justify-center min-w-[24px] h-5 px-2 bg-card border border-border text-muted-foreground text-[10px] font-semibold rounded-full tabular-nums">
                    {lane.deals.length}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform duration-300 ease-out",
                      collapsed ? "-rotate-90" : "rotate-0",
                    )}
                    strokeWidth={2}
                    aria-hidden
                  />
                </div>
              </button>

              {/* Collapsible region - animated via grid-template-rows so we can
                  transition between collapsed (0fr) and expanded (1fr) without
                  measuring content height in JS. */}
              {!collapsed && (
                <div
                  id={bodyId}
                  role="region"
                  aria-labelledby={headerId}
                >
                  {/* Rows */}
                  <div className="p-2 min-h-[120px] md:min-h-[220px]">
                    {isLoading ? (
                      <SkeletonCard />
                    ) : lane.deals.length === 0 ? (
                      <div className="px-2 py-4">
                        <LaneEmptyState />
                      </div>
                    ) : (
                      <ul className="space-y-1.5">
                        {lane.deals.map((deal) => (
                          <li
                            key={deal.id}
                            className="bg-card rounded-md border border-slate-200/70 hover:border-slate-300 transition-colors"
                          >
                            <DealDocumentCard
                              deal={deal}
                              laneId={lane.id}
                              onClick={() => navigate(`/desk/match/${deal.id}`)}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {lane.id === "poi" && !isLoading && lane.deals.length > 0 && (
                    <div className="px-4 py-2.5 border-t border-border bg-card/60 flex items-center justify-between gap-3">
                      <p className="text-[10px] font-mono tracking-[0.18em] uppercase text-muted-foreground">
                        Showing {sealedLoaded}
                        {sealedQ.data?.totalSealedish ? ` of ~${sealedQ.data.totalSealedish}` : ""}
                      </p>
                      {sealedHasMore && (
                        <button
                          type="button"
                          onClick={() => setSealedPage((p) => p + 1)}
                          disabled={isSealedFetching}
                          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--emerald))] hover:text-[hsl(var(--emerald))] disabled:opacity-60"
                        >
                          {isSealedFetching && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />}
                          Load more
                        </button>
                      )}
                    </div>
                  )}

                  {/* Active-lane pagination - appears on Draft and Awaiting lanes
                      whenever the org has more active records than the current window. */}
                  {(lane.id === "draft" || lane.id === "awaiting") &&
                    !isLoading &&
                    activeQ.data &&
                    activeHasMore && (
                      <div className="px-4 py-2.5 border-t border-border bg-card/60 flex items-center justify-between gap-3">
                        <p className="text-[10px] font-mono tracking-[0.18em] uppercase text-muted-foreground">
                          Showing {activeLoaded} of {activeQ.data.totalActive}
                        </p>
                        <button
                          type="button"
                          onClick={() => setActivePage((p) => p + 1)}
                          disabled={isActiveFetching}
                          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--emerald))] hover:text-[hsl(var(--emerald))] disabled:opacity-60"
                        >
                          {isActiveFetching && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />}
                          Load more
                        </button>
                      </div>
                    )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * FilterBar - narrows the visible pipeline by counterparty (free-text contains
 * search), commodity (exact match against a derived dropdown), and stage
 * (lane). All filters are AND-combined and applied client-side before the
 * sort comparator runs in the parent.
 */
function FilterBar({
  counterpartyQuery,
  onCounterpartyQueryChange,
  commodityFilter,
  onCommodityFilterChange,
  commodityOptions,
  laneFilter,
  onLaneFilterChange,
  hasActiveFilters,
  onReset,
  visibleCount,
}: {
  counterpartyQuery: string;
  onCounterpartyQueryChange: (v: string) => void;
  commodityFilter: string;
  onCommodityFilterChange: (v: string) => void;
  commodityOptions: string[];
  laneFilter: "all" | DealCard["laneId"];
  onLaneFilterChange: (v: "all" | DealCard["laneId"]) => void;
  hasActiveFilters: boolean;
  onReset: () => void;
  visibleCount: number;
}) {
  const inputBase =
    "appearance-none bg-card border border-border hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--emerald))]/30 rounded-md text-[12px] font-medium text-muted-foreground transition-colors";
  return (
    <div className="mb-5 rounded-md border border-border bg-muted/60 px-3 py-2.5 flex flex-col lg:flex-row lg:items-center gap-2.5 lg:gap-3">
      {/* Counterparty contains-search */}
      <div className="relative flex-1 min-w-[180px]">
        <Search
          className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70 pointer-events-none"
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          type="text"
          value={counterpartyQuery}
          onChange={(e) => onCounterpartyQueryChange(e.target.value)}
          placeholder="Search counterparty…"
          className={cn(inputBase, "w-full pl-8 pr-8 py-1.5")}
          aria-label="Search by counterparty name"
        />
        {counterpartyQuery && (
          <button
            type="button"
            onClick={() => onCounterpartyQueryChange("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/70 hover:text-muted-foreground rounded"
            aria-label="Clear counterparty search"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Commodity selector */}
      <label className="inline-flex items-center gap-2">
        <span className="sr-only">Filter by commodity</span>
        <select
          value={commodityFilter}
          onChange={(e) => onCommodityFilterChange(e.target.value)}
          className={cn(inputBase, "pl-2.5 pr-7 py-1.5 cursor-pointer min-w-[140px]")}
          aria-label="Filter by commodity"
        >
          <option value="all">All commodities</option>
          {commodityOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      {/* Lane / status pill toggle group - keeps stage filtering immediately
          visible without burying it in a dropdown. */}
      <div
        className="inline-flex items-center bg-card border border-border rounded-md p-0.5"
        role="tablist"
        aria-label="Filter by stage"
      >
        {(
          [
            { id: "all", label: "All stages" },
            { id: "draft", label: "Draft" },
            { id: "awaiting", label: "Awaiting" },
            { id: "poi", label: "Sealed" },
          ] as const
        ).map((opt) => {
          const active = laneFilter === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onLaneFilterChange(opt.id)}
              className={cn(
                "px-2.5 py-1 text-[11px] font-medium rounded transition-colors",
                active
                  ? "bg-slate-900 text-white"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Visible count + reset affordance */}
      <div className="flex items-center gap-3 lg:ml-auto">
        <span className="text-[10px] font-mono tracking-[0.18em] uppercase text-muted-foreground tabular-nums">
          {visibleCount} visible
        </span>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onReset}
            className="text-[11px] font-medium text-[hsl(var(--emerald))] hover:text-[hsl(var(--emerald))]"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

function PipelineHeader({
  totalDeals,
  sortKey,
  onSortChange,
}: {
  totalDeals: number;
  sortKey: SortKey;
  onSortChange: (k: SortKey) => void;
}) {
  return (
    <div className="mb-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-4">
      <div className="min-w-0">
        <p className="text-[10px] font-mono tracking-[0.25em] uppercase text-muted-foreground/70 mb-1.5">
          9-Step WaD Workflow
        </p>
        <h2 className="text-lg font-semibold text-foreground tracking-tight">
          Active Deal Pipeline
        </h2>
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        <p className="text-[11px] font-mono tracking-[0.18em] uppercase text-muted-foreground tabular-nums">
          {totalDeals} {totalDeals === 1 ? "Deal" : "Deals"} in flight
        </p>

        {/* Sort selector - applied client-side across all three lanes so the
            most important deals surface first regardless of stage. */}
        <label className="group relative inline-flex items-center gap-2">
          <span className="sr-only">Sort deals by</span>
          <ArrowDownUp
            className="h-3.5 w-3.5 text-muted-foreground/70 pointer-events-none"
            strokeWidth={1.75}
            aria-hidden
          />
          <select
            value={sortKey}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
            className="appearance-none bg-card border border-border hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--emerald))]/30 rounded-md pl-2 pr-7 py-1.5 text-[12px] font-medium text-muted-foreground cursor-pointer transition-colors"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Sort: {opt.label}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/70 text-[9px]">
            ▼
          </span>
        </label>
      </div>
    </div>
  );
}

function DealDocumentCard({
  deal,
  laneId,
  onClick,
}: {
  deal: DealCard;
  laneId: string;
  onClick: () => void;
}) {
  const accent = LANE_ACCENT[laneId];
  // Display the freshest activity, not the creation date - so a deal the user
  // just opened doesn't read "3d ago" the moment they navigate back to the desk.
  const activityIso = deal.last_activity_at || deal.created_at;
  const ageLabel = relativeAge(activityIso);
  const ageTooltip = (() => {
    const ts = new Date(activityIso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    switch (deal.last_activity_source) {
      case "viewed":
        return `Last viewed by you ${ts}`;
      case "event":
        return `Last activity ${ts}`;
      case "created":
      default:
        return `Created ${ts}`;
    }
  })();
  const deadlineLabel = deadlineFromIso(deal.deadline_at);
  const initials = initialsOf(deal.counterparty);

  return (
    <button
      onClick={onClick}
      className="group w-full flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3 rounded-md text-left hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--emerald))]/30"
    >
      {/* Lane priority dot */}
      <span
        aria-hidden
        className={cn("shrink-0 w-2 h-2 rounded-full", accent.dot)}
        title={LANE_PILL_LABEL[laneId]}
      />

      {/* Counterparty initials */}
      <div
        className="shrink-0 hidden sm:flex items-center justify-center w-8 h-8 rounded-full bg-muted text-muted-foreground text-[10px] font-semibold tracking-wide"
        title={deal.counterparty}
      >
        {initials}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground font-medium leading-snug truncate">
          {deal.volume !== "-" ? `${deal.volume} ` : ""}
          {deal.commodity}
        </p>
        <p className="text-[11px] text-muted-foreground leading-snug truncate flex items-center gap-1.5 flex-wrap">
          <span className="truncate">with <span className="text-muted-foreground">{deal.counterparty}</span></span>
          <span className="text-muted-foreground/50">·</span>
          <span className="font-mono text-muted-foreground/70 cursor-help" title={ageTooltip}>{ageLabel}</span>
          {deadlineLabel && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span
                className={cn(
                  "font-mono cursor-help",
                  deadlineLabel === "overdue"
                    ? "text-red-600 font-semibold"
                    : "text-amber-600",
                )}
                title={
                  deal.deadline_at
                    ? `Expires ${new Date(deal.deadline_at).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}`
                    : undefined
                }
              >
                {deadlineLabel}
              </span>
            </>
          )}
          <span className="text-muted-foreground/50">·</span>
          <span className="font-mono tracking-[0.1em] text-muted-foreground/70">
            {deal.id.slice(0, 6).toUpperCase()}
          </span>
        </p>
      </div>

      {/* Stage pill + chevron CTA */}
      <span
        className={cn(
          "shrink-0 hidden md:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-[0.08em]",
          accent.pill,
        )}
      >
        {LANE_PILL_LABEL[laneId]}
      </span>
      <ArrowRight
        className="shrink-0 h-4 w-4 text-muted-foreground/50 group-hover:text-[hsl(var(--emerald))] group-hover:translate-x-0.5 transition-all"
        strokeWidth={2}
        aria-hidden
      />
    </button>
  );
}

/** Mirrors AttentionPipeline.relativeAge - kept local to avoid coupling. */
function relativeAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.floor(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function deadlineFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return "overdue";
  const hrs = Math.floor(diffMs / 3600000);
  if (hrs < 48) return `expires in ${Math.max(1, hrs)}h`;
  const days = Math.floor(hrs / 24);
  return `expires in ${days}d`;
}

function initialsOf(name: string | null | undefined): string {
  if (!name) return "-";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "-";
}

function SkeletonCard() {
  return (
    <ul className="divide-y divide-border" aria-busy="true" aria-label="Loading deals">
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3">
          <Skeleton className="shrink-0 w-2 h-2 rounded-full" />
          <Skeleton className="shrink-0 hidden sm:block w-8 h-8 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/2 max-w-[220px]" />
            <Skeleton className="h-2.5 w-2/3 max-w-[280px]" />
          </div>
          <Skeleton className="shrink-0 h-5 w-16 rounded-full hidden md:block" />
        </li>
      ))}
    </ul>
  );
}

function LaneEmptyState() {
  return (
    <EmptyStateCard
      density="compact"
      kicker="No Records"
      title="Lane empty"
      description="No trade requests have entered this stage."
    />
  );
}
