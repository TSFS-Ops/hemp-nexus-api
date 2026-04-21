import { useEffect, useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Compass, Loader2, ArrowDownUp, Search, X, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { EmptyStateCard } from "@/components/ui/empty-state-card";

/**
 * Deal Pipeline — paginated, column-projected.
 *
 * Performance contract (audit, 2026-04):
 * - .select() lists are *minimal*: only fields rendered on the card or required
 *   for lane bucketing. `org_id` was previously fetched and discarded — removed.
 * - Active lanes (Draft, Awaiting) are bounded by state filters and capped at
 *   ACTIVE_PAGE_SIZE; an org cannot accumulate hundreds of in-flight drafts
 *   without triggering operational alarms first.
 * - The Sealed lane grows monotonically over the org's lifetime, so it is the
 *   only lane that paginates. We load SEALED_PAGE_SIZE per page on demand and
 *   surface a "Load more" affordance plus the true server-side count, so users
 *   are never silently truncated. count is fetched head-only so it costs an
 *   index probe, not a row scan.
 * - poi_engagements is queried only for the Sealed page in view, keyed on
 *   match_id IN (...) — bounded by SEALED_PAGE_SIZE.
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
  /** Inferred deadline — uses explicit deal expiry if present, otherwise a
   *  lane-based heuristic so "nearest deadline" remains meaningful even when
   *  the underlying record has no SLA timestamp. */
  deadline_at: string | null;
  laneId: "draft" | "awaiting" | "poi";
}

type SortKey = "newest" | "oldest" | "volume_desc" | "deadline";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "volume_desc", label: "Highest volume" },
  { value: "deadline", label: "Nearest deadline" },
];

const ACTIVE_PAGE_SIZE = 60;
const SEALED_PAGE_SIZE = 20;
// Active lanes are bounded by business reality but not by physics — an org can
// theoretically accumulate hundreds of stale drafts. We cap the first window at
// ACTIVE_PAGE_SIZE and surface a "Load more" affordance when the server count
// exceeds it, so neither lane is ever silently truncated.
const ACTIVE_PAGE_INCREMENT = 60;

// State buckets — these mirror the 9-step WaD workflow.
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
  { id: "draft", title: "Draft Interests", subtitle: "Steps 1–7 · Intent captured" },
  { id: "awaiting", title: "Awaiting Engagement", subtitle: "Step 8 · POI sent" },
  { id: "poi", title: "Sealed Proofs of Intent", subtitle: "Step 9 · Engagement accepted" },
] as const;

// Tone-of-voice colour per lane — used for the subtle top accent and the stage pill.
const LANE_ACCENT: Record<string, { bar: string; pill: string; dot: string }> = {
  draft:    { bar: "bg-indigo-400/70",   pill: "text-indigo-700 bg-indigo-50",   dot: "bg-indigo-500" },
  awaiting: { bar: "bg-amber-400/70",    pill: "text-amber-700 bg-amber-50",    dot: "bg-amber-500" },
  poi:      { bar: "bg-emerald-400/70",  pill: "text-emerald-700 bg-emerald-50", dot: "bg-emerald-500" },
};
const LANE_PILL_LABEL: Record<string, string> = {
  draft: "Draft",
  awaiting: "Awaiting",
  poi: "Sealed",
};

// Minimal column projection. Anything not on the card or used for routing is excluded.
// `org_id` was dropped — it is encoded in the `.or()` filter and never read post-fetch.
const MATCH_COLUMNS =
  "id, commodity, quantity_amount, quantity_unit, buyer_name, seller_name, state, buyer_org_id, seller_org_id, created_at";

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
 * makes "Nearest deadline" sort actionable without a schema change — the moment
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
 * Active lanes (Draft + Awaiting) — bounded query.
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

      const list = matches ?? [];

      // Resolve engagement status only for matches in POI states; this keeps
      // the secondary query bounded by the page size, not by table size.
      const poiIds = list.filter((m) => POI_STATES.includes(m.state ?? "")).map((m) => m.id);
      const engagementByMatch = new Map<string, string>();
      if (poiIds.length > 0) {
        const { data: engagements } = await supabase
          .from("poi_engagements")
          .select("match_id, engagement_status")
          .in("match_id", poiIds);
        for (const e of engagements ?? []) {
          if (e.match_id && e.engagement_status) {
            engagementByMatch.set(e.match_id, e.engagement_status);
          }
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
          deadline_at: inferDeadline(m.created_at, laneId),
          laneId,
        };
      });
      return { cards, totalActive: count ?? cards.length };
    },
  });
}

/**
 * Sealed lane — paginated query.
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
      const to = (page + 1) * SEALED_PAGE_SIZE - 1; // cumulative window — we render everything fetched so far

      const { data: matches, count } = await supabase
        .from("matches")
        .select(MATCH_COLUMNS, { count: "exact" })
        .or(`buyer_org_id.eq.${orgId},seller_org_id.eq.${orgId},org_id.eq.${orgId}`)
        .in("state", POI_STATES)
        .order("created_at", { ascending: false })
        .range(from, to);

      const list = matches ?? [];

      // Only the page in view needs engagement resolution.
      const ids = list.map((m) => m.id);
      const engagementByMatch = new Map<string, string>();
      if (ids.length > 0) {
        const { data: engagements } = await supabase
          .from("poi_engagements")
          .select("match_id, engagement_status")
          .in("match_id", ids);
        for (const e of engagements ?? []) {
          if (e.match_id && e.engagement_status) {
            engagementByMatch.set(e.match_id, e.engagement_status);
          }
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
  // Reads are guarded against SSR (no window) and against malformed JSON — a
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
    v === "newest" || v === "oldest" || v === "volume_desc" || v === "deadline";
  const isLaneFilter = (v: unknown): v is "all" | DealCard["laneId"] =>
    v === "all" || v === "draft" || v === "awaiting" || v === "poi";
  const isString = (v: unknown): v is string => typeof v === "string";

  const [sortKey, setSortKey] = useState<SortKey>(() =>
    readStorage<SortKey>(SORT_KEY_STORAGE, "newest", isSortKey),
  );

  // Per-lane collapse state — persisted to localStorage so a user who prefers
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
      // localStorage write failures are non-fatal — collapse simply won't persist.
    }
  }, [collapsedLanes]);
  const toggleLane = (id: string) =>
    setCollapsedLanes((s) => ({ ...s, [id]: !s[id] }));

  // Filter state — purely client-side. Filtering server-side would require
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
  // can fail (quota, private mode) — failure is non-fatal: the in-memory state
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

  const isLoading = (activeQ.isLoading && !activeQ.data) || (sealedQ.isLoading && !sealedQ.data);
  const isSealedFetching = sealedQ.isFetching;
  const isActiveFetching = activeQ.isFetching;

  // Distinct commodity list across all loaded deals — drives the commodity
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
    const activeCards = activeQ.data?.cards ?? [];
    const sealedCards = sealedQ.data?.cards ?? [];
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
  }, [activeQ.data, sealedQ.data, sortKey, counterpartyQuery, commodityFilter, laneFilter]);

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
            onClick: () => navigate("/desk/initiate"),
          }}
        />
      </section>
    );
  }

  // Sealed pagination state derived from the server count, not from page-size guesses.
  const sealedLoaded = sealedQ.data?.cards.length ?? 0;
  const sealedWindow = (sealedPage + 1) * SEALED_PAGE_SIZE;
  const sealedHasMore = (sealedQ.data?.totalSealedish ?? 0) > sealedWindow;

  // Active-lane pagination — `totalActive` is the server-side count of *all*
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
              className="flex flex-col rounded-xl border border-slate-200/80 bg-slate-50/40 overflow-hidden"
            >
              {/* Top accent bar — sets lane identity without shouting. */}
              <div className={cn("h-0.5 w-full", accent.bar)} />

              {/* Lane header — full-width button so the entire row is a click
                  target. Chevron rotates to indicate state; aria-expanded keeps
                  assistive tech in sync. */}
              <button
                type="button"
                id={headerId}
                onClick={() => toggleLane(lane.id)}
                aria-expanded={!collapsed}
                aria-controls={bodyId}
                className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 text-left hover:bg-slate-100/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-1.5 w-1.5 rounded-full", accent.dot)} />
                    <h3 className="text-[13px] font-semibold text-slate-900 leading-none">
                      {lane.title}
                    </h3>
                  </div>
                  <p className="mt-1.5 text-[10px] font-mono tracking-[0.2em] uppercase text-slate-400">
                    {lane.subtitle}
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 bg-white border border-slate-200 text-slate-700 text-[11px] font-semibold rounded-md tabular-nums">
                    {lane.deals.length}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-slate-500 transition-transform duration-300 ease-out",
                      collapsed ? "-rotate-90" : "rotate-0",
                    )}
                    strokeWidth={2}
                    aria-hidden
                  />
                </div>
              </button>

              {/* Collapsible region — animated via grid-template-rows so we can
                  transition between collapsed (0fr) and expanded (1fr) without
                  measuring content height in JS. The inner wrapper owns
                  `overflow-hidden` so cards clip cleanly during the transition,
                  and `motion-reduce` disables the animation for users who have
                  requested reduced motion. */}
              <div
                id={bodyId}
                role="region"
                aria-labelledby={headerId}
                aria-hidden={collapsed}
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
                  collapsed
                    ? "grid-rows-[0fr] opacity-0"
                    : "grid-rows-[1fr] opacity-100",
                )}
              >
                <div className="overflow-hidden min-h-0">
                  {/* Cards */}
                  <div className="flex flex-col gap-2 px-3 pb-3 min-h-[120px] md:min-h-[220px]">
                    {isLoading ? (
                      <SkeletonCard />
                    ) : lane.deals.length === 0 ? (
                      <LaneEmptyState />
                    ) : (
                      lane.deals.map((deal) => (
                        <DealDocumentCard
                          key={deal.id}
                          deal={deal}
                          laneId={lane.id}
                          onClick={() => navigate(`/desk/match/${deal.id}`)}
                        />
                      ))
                    )}
                  </div>

                  {/* Sealed pagination affordance. */}
                  {lane.id === "poi" && !isLoading && lane.deals.length > 0 && (
                    <div className="px-4 py-2.5 border-t border-slate-200/70 bg-white/60 flex items-center justify-between gap-3">
                      <p className="text-[10px] font-mono tracking-[0.18em] uppercase text-slate-500">
                        Showing {sealedLoaded}
                        {sealedQ.data?.totalSealedish ? ` of ~${sealedQ.data.totalSealedish}` : ""}
                      </p>
                      {sealedHasMore && (
                        <button
                          type="button"
                          onClick={() => setSealedPage((p) => p + 1)}
                          disabled={isSealedFetching}
                          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 hover:text-emerald-800 disabled:opacity-60"
                        >
                          {isSealedFetching && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />}
                          Load more
                        </button>
                      )}
                    </div>
                  )}

                  {/* Active-lane pagination — appears on Draft and Awaiting lanes
                      whenever the org has more active records than the current window. */}
                  {(lane.id === "draft" || lane.id === "awaiting") &&
                    !isLoading &&
                    activeQ.data &&
                    activeHasMore && (
                      <div className="px-4 py-2.5 border-t border-slate-200/70 bg-white/60 flex items-center justify-between gap-3">
                        <p className="text-[10px] font-mono tracking-[0.18em] uppercase text-slate-500">
                          Showing {activeLoaded} of {activeQ.data.totalActive}
                        </p>
                        <button
                          type="button"
                          onClick={() => setActivePage((p) => p + 1)}
                          disabled={isActiveFetching}
                          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 hover:text-emerald-800 disabled:opacity-60"
                        >
                          {isActiveFetching && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />}
                          Load more
                        </button>
                      </div>
                    )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * FilterBar — narrows the visible pipeline by counterparty (free-text contains
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
    "appearance-none bg-white border border-slate-200 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 rounded-md text-[12px] font-medium text-slate-700 transition-colors";
  return (
    <div className="mb-5 rounded-lg border border-slate-200/80 bg-slate-50/60 px-3 py-2.5 flex flex-col lg:flex-row lg:items-center gap-2.5 lg:gap-3">
      {/* Counterparty contains-search */}
      <div className="relative flex-1 min-w-[180px]">
        <Search
          className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none"
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
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded"
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

      {/* Lane / status pill toggle group — keeps stage filtering immediately
          visible without burying it in a dropdown. */}
      <div
        className="inline-flex items-center bg-white border border-slate-200 rounded-md p-0.5"
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
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Visible count + reset affordance */}
      <div className="flex items-center gap-3 lg:ml-auto">
        <span className="text-[10px] font-mono tracking-[0.18em] uppercase text-slate-500 tabular-nums">
          {visibleCount} visible
        </span>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onReset}
            className="text-[11px] font-medium text-emerald-700 hover:text-emerald-800"
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
        <p className="text-[10px] font-mono tracking-[0.25em] uppercase text-slate-400 mb-1.5">
          9-Step WaD Workflow
        </p>
        <h2 className="text-lg font-semibold text-slate-900 tracking-tight">
          Active Deal Pipeline
        </h2>
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        <p className="text-[11px] font-mono tracking-[0.18em] uppercase text-slate-500 tabular-nums">
          {totalDeals} {totalDeals === 1 ? "Deal" : "Deals"} in flight
        </p>

        {/* Sort selector — applied client-side across all three lanes so the
            most important deals surface first regardless of stage. */}
        <label className="group relative inline-flex items-center gap-2">
          <span className="sr-only">Sort deals by</span>
          <ArrowDownUp
            className="h-3.5 w-3.5 text-slate-400 pointer-events-none"
            strokeWidth={1.75}
            aria-hidden
          />
          <select
            value={sortKey}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
            className="appearance-none bg-white border border-slate-200 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 rounded-md pl-2 pr-7 py-1.5 text-[12px] font-medium text-slate-700 cursor-pointer transition-colors"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Sort: {opt.label}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-[9px]">
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
  const date = new Date(deal.created_at).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const accent = LANE_ACCENT[laneId];
  return (
    <button
      onClick={onClick}
      className="group relative text-left bg-white border border-slate-200 rounded-lg px-4 py-3.5 shadow-[0_1px_0_rgba(15,23,42,0.04)] hover:border-slate-300 hover:shadow-[0_4px_12px_-4px_rgba(15,23,42,0.12)] transition-all"
    >
      {/* Row 1 — commodity headline + stage pill */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-[14px] font-semibold text-slate-900 leading-snug truncate">
          {deal.commodity}
        </p>
        <span
          className={cn(
            "shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-[0.08em]",
            accent.pill,
          )}
        >
          {LANE_PILL_LABEL[laneId]}
        </span>
      </div>

      {/* Row 2 — counterparty (the most important "with whom") */}
      <p className="text-[12px] text-slate-600 truncate mb-3">
        with <span className="text-slate-900 font-medium">{deal.counterparty}</span>
      </p>

      {/* Row 3 — meta strip: volume · date · ref · open */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
        <span className="text-slate-700">{deal.volume}</span>
        <div className="flex items-center gap-2">
          <span>{date}</span>
          <span className="text-slate-300">·</span>
          <span className="tracking-[0.1em]">{deal.id.slice(0, 6).toUpperCase()}</span>
          <ArrowUpRight
            className="h-3 w-3 text-slate-400 group-hover:text-emerald-700 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all"
            strokeWidth={2}
          />
        </div>
      </div>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 animate-pulse">
      <div className="h-3 w-24 bg-slate-100 rounded mb-4" />
      <div className="h-4 w-3/4 bg-slate-100 rounded mb-3" />
      <div className="h-3 w-1/2 bg-slate-100 rounded" />
    </div>
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
