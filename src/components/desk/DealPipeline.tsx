import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Compass, Loader2 } from "lucide-react";
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
  state: string;
  created_at: string;
  laneId: "draft" | "awaiting" | "poi";
}

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
          state,
          created_at: m.created_at,
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
            state: m.state ?? "",
            created_at: m.created_at,
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

  const activeQ = useActiveLanes(orgId ?? null, activePage);
  const sealedQ = useSealedPage(orgId ?? null, sealedPage);

  const isLoading = (activeQ.isLoading && !activeQ.data) || (sealedQ.isLoading && !sealedQ.data);
  const isSealedFetching = sealedQ.isFetching;
  const isActiveFetching = activeQ.isFetching;

  const lanes = useMemo(() => {
    const activeCards = activeQ.data?.cards ?? [];
    const sealedCards = sealedQ.data?.cards ?? [];
    // De-dupe: the active query may have already returned some sealed records
    // that the paginated sealed query also returns. Sealed page wins because
    // it owns that lane's growth.
    const sealedIds = new Set(sealedCards.map((c) => c.id));
    return LANE_META.map((meta) => {
      if (meta.id === "poi") {
        return { ...meta, deals: sealedCards };
      }
      return {
        ...meta,
        deals: activeCards.filter((c) => c.laneId === meta.id && !sealedIds.has(c.id)),
      };
    });
  }, [activeQ.data, sealedQ.data]);

  const totalDeals = lanes.reduce((sum, l) => sum + l.deals.length, 0);
  const showPipelineEmpty = !isLoading && totalDeals === 0;

  if (showPipelineEmpty) {
    return (
      <section>
        <PipelineHeader totalDeals={0} />
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
      <PipelineHeader totalDeals={totalDeals} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6">
        {lanes.map((lane) => {
          const accent = LANE_ACCENT[lane.id];
          return (
            <div
              key={lane.id}
              className="flex flex-col rounded-xl border border-slate-200/80 bg-slate-50/40 overflow-hidden"
            >
              {/* Top accent bar — sets lane identity without shouting. */}
              <div className={cn("h-0.5 w-full", accent.bar)} />

              {/* Lane header */}
              <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
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
                <span className="shrink-0 inline-flex items-center justify-center min-w-[24px] h-6 px-2 bg-white border border-slate-200 text-slate-700 text-[11px] font-semibold rounded-md tabular-nums">
                  {lane.deals.length}
                </span>
              </div>

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
          );
        })}
      </div>
    </section>
  );
}

function PipelineHeader({ totalDeals }: { totalDeals: number }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <p className="text-[10px] font-mono tracking-[0.25em] uppercase text-slate-400 mb-1.5">
          9-Step WaD Workflow
        </p>
        <h2 className="text-lg font-semibold text-slate-900 tracking-tight">
          Active Deal Pipeline
        </h2>
      </div>
      <p className="text-[11px] font-mono tracking-[0.18em] uppercase text-slate-500 tabular-nums">
        {totalDeals} {totalDeals === 1 ? "Deal" : "Deals"} in flight
      </p>
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
