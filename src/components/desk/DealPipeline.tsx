import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Building2, ArrowUpRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

interface DealCard {
  id: string;
  commodity: string;
  counterparty: string;
  volume: string;
  state: string;
  created_at: string;
  laneId?: string;
}
interface PipelineLane {
  id: string;
  title: string;
  subtitle: string;
  states: string[];
  deals: DealCard[];
}

// Mapping the 9-step WaD workflow into three editorial buckets.
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
  {
    id: "draft",
    title: "Draft Interests",
    subtitle: "Steps 1 to 7 · Intent captured",
  },
  {
    id: "awaiting",
    title: "Awaiting Engagement",
    subtitle: "Step 8 · POI sent, hold-point active",
  },
  {
    id: "poi",
    title: "Proofs of Intent Sealed",
    subtitle: "Step 9 · Engagement accepted",
  },
] as const;

// Semantic badge variants per lane.
const LANE_BADGE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  awaiting: "bg-amber-50 text-amber-700 border border-amber-200/60",
  poi: "bg-emerald-50 text-emerald-700 border border-emerald-200/60",
};

const LANE_PILL_LABEL: Record<string, string> = {
  draft: "Draft",
  awaiting: "Awaiting",
  poi: "Sealed",
};

export function DealPipeline() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["desk-pipeline", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<PipelineLane[]> => {
      const emptyLanes: PipelineLane[] = LANE_META.map((l) => ({ ...l, states: [], deals: [] }));
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user!.id)
        .maybeSingle();
      if (!profile?.org_id) return emptyLanes;
      const { data: matches } = await supabase
        .from("matches")
        .select(
          "id, commodity, quantity_amount, quantity_unit, buyer_name, seller_name, state, buyer_org_id, seller_org_id, org_id, created_at",
        )
        .or(
          `buyer_org_id.eq.${profile.org_id},seller_org_id.eq.${profile.org_id},org_id.eq.${profile.org_id}`,
        )
        .order("created_at", { ascending: false })
        .limit(60);
      const matchList = matches ?? [];

      const poiMatchIds = matchList
        .filter((m) => POI_STATES.includes(m.state ?? ""))
        .map((m) => m.id);
      const engagementByMatch = new Map<string, string>();
      if (poiMatchIds.length > 0) {
        const { data: engagements } = await supabase
          .from("poi_engagements")
          .select("match_id, engagement_status")
          .in("match_id", poiMatchIds);
        for (const e of engagements ?? []) {
          if (e.match_id && e.engagement_status) {
            engagementByMatch.set(e.match_id, e.engagement_status);
          }
        }
      }

      const cards: DealCard[] = matchList.map((m) => {
        const isBuyer = m.buyer_org_id === profile.org_id;
        const state = m.state ?? "draft";
        let laneId = "draft";
        if (POI_STATES.includes(state)) {
          const eng = engagementByMatch.get(m.id);
          laneId = eng === "accepted" ? "poi" : "awaiting";
        } else if (DRAFT_STATES.includes(state)) {
          laneId = "draft";
        }
        return {
          id: m.id,
          commodity: m.commodity ?? "Unspecified commodity",
          counterparty: (isBuyer ? m.seller_name : m.buyer_name) ?? "Counterparty TBD",
          volume:
            m.quantity_amount && m.quantity_unit
              ? `${Number(m.quantity_amount).toLocaleString()} ${m.quantity_unit}`
              : "-",
          state,
          created_at: m.created_at,
          laneId,
        };
      });
      return LANE_META.map((meta) => ({
        ...meta,
        states: [],
        deals: cards.filter((c) => c.laneId === meta.id),
      }));
    },
  });
  const lanes = data ?? LANE_META.map((l) => ({ ...l, states: [], deals: [] }));

  return (
    <section>
      <div className="mb-6 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-slate-900 tracking-tight">
          Active Deal Pipeline
        </h2>
        <p className="text-[11px] text-slate-500 font-mono tracking-widest uppercase">
          9-Step WaD Workflow
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
        {lanes.map((lane) => (
          <div key={lane.id} className="flex flex-col gap-3">
            {/* Column header */}
            <div className="flex items-center justify-between px-1">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 leading-tight">
                  {lane.title}
                </h3>
                <p className="mt-0.5 text-[10px] font-mono tracking-widest uppercase text-slate-500">
                  {lane.subtitle}
                </p>
              </div>
              <span className="shrink-0 ml-2 bg-slate-100 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full">
                {lane.deals.length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-3 min-h-[80px] md:min-h-[200px]">
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
                    onClick={() => navigate(`/desk/deals/${deal.id}`)}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
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
  return (
    <button
      onClick={onClick}
      className="text-left bg-white border border-slate-200 rounded-lg p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition-all cursor-pointer group"
    >
      {/* Header row: ref + status pill */}
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-slate-500">
          {deal.id.slice(0, 8)}
        </span>
        <span
          className={cn(
            "px-2.5 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide",
            LANE_BADGE[laneId],
          )}
        >
          {LANE_PILL_LABEL[laneId]}
        </span>
      </div>

      {/* Commodity */}
      <p className="text-[15px] font-semibold text-slate-900 leading-snug mb-2">
        {deal.commodity}
      </p>

      {/* Counterparty with icon anchor */}
      <div className="flex items-center gap-1.5 text-xs text-slate-600 mb-4">
        <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" strokeWidth={1.75} />
        <span className="truncate">
          with <span className="text-slate-900 font-medium">{deal.counterparty}</span>
        </span>
      </div>

      {/* Footer */}
      <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
        <span className="font-mono text-xs text-slate-700 tracking-tight">{deal.volume}</span>
        <span className="text-[10px] font-mono text-slate-500 tracking-wide">{date}</span>
      </div>

      {/* Open hint */}
      <div className="mt-2 flex items-center justify-end text-[10px] font-medium text-slate-500 group-hover:text-emerald-700 transition-colors">
        Open
        <ArrowUpRight className="h-3 w-3 ml-0.5" strokeWidth={2} />
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
    <div className="bg-white rounded-lg border border-dashed border-slate-200 p-6 text-center">
      <p className="text-[11px] text-slate-500 font-mono tracking-wide uppercase">No deals</p>
    </div>
  );
}
