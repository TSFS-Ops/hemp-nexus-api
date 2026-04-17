import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
interface DealCard {
  id: string;
  commodity: string;
  counterparty: string;
  volume: string;
  state: string;
  created_at: string;
}
interface PipelineLane {
  id: string;
  title: string;
  subtitle: string;
  states: string[];
  deals: DealCard[];
}

// Mapping the 9-step WaD workflow into three editorial buckets
const LANE_DEFS = [{
  id: "draft",
  title: "Draft Interests",
  subtitle: "Steps 1 to 3 · Intent captured",
  states: ["draft", "interest_logged", "match_proposed"]
}, {
  id: "pending",
  title: "Pending Counterparty",
  subtitle: "Steps 4 to 7 · In negotiation",
  states: ["counterparty_sighted", "buyer_committed", "seller_committed", "terms_pending"]
}, {
  id: "poi",
  title: "Proofs of Intent Generated",
  subtitle: "Steps 8 to 9 · Sealed",
  states: ["pending_finality", "settled", "poi_generated", "finalised"]
}];
export function DealPipeline() {
  const {
    user
  } = useAuth();
  const navigate = useNavigate();
  const {
    data,
    isLoading
  } = useQuery({
    queryKey: ["desk-pipeline", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<PipelineLane[]> => {
      const {
        data: profile
      } = await supabase.from("profiles").select("org_id").eq("id", user!.id).maybeSingle();
      if (!profile?.org_id) return LANE_DEFS.map(l => ({
        ...l,
        deals: []
      }));
      const {
        data: matches
      } = await supabase.from("matches").select("id, commodity, quantity_amount, quantity_unit, buyer_name, seller_name, state, buyer_org_id, seller_org_id, created_at").or(`buyer_org_id.eq.${profile.org_id},seller_org_id.eq.${profile.org_id}`).order("created_at", {
        ascending: false
      }).limit(60);
      const cards: DealCard[] = (matches ?? []).map(m => {
        const isBuyer = m.buyer_org_id === profile.org_id;
        return {
          id: m.id,
          commodity: m.commodity ?? "Unspecified commodity",
          counterparty: (isBuyer ? m.seller_name : m.buyer_name) ?? "Counterparty TBD",
          volume: m.quantity_amount && m.quantity_unit ? `${Number(m.quantity_amount).toLocaleString()} ${m.quantity_unit}` : "—",
          state: m.state ?? "draft",
          created_at: m.created_at
        };
      });
      return LANE_DEFS.map(lane => ({
        ...lane,
        deals: cards.filter(c => lane.states.includes(c.state))
      }));
    }
  });
  const lanes = data ?? LANE_DEFS.map(l => ({
    ...l,
    deals: []
  }));
  return <section>
      <div className="mb-8 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold text-slate-900 tracking-tight">
          Active Deal Pipeline
        </h2>
        <p className="text-xs text-slate-400 font-mono tracking-wider uppercase">
          9-Step WaD Workflow
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {lanes.map(lane => <div key={lane.id} className="flex flex-col gap-6">
            {/* Lane header */}
            <div className="px-2">
              <h3 className="text-sm font-medium text-slate-900 mb-1">{lane.title}</h3>
              <p className="text-[11px] font-mono tracking-wider uppercase text-slate-400">
                {lane.subtitle}
              </p>
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-4 min-h-[200px]">
              {isLoading ? <SkeletonCard /> : lane.deals.length === 0 ? <LaneEmptyState /> : lane.deals.map(deal => <DealDocumentCard key={deal.id} deal={deal} onClick={() => navigate(`/desk/deals/${deal.id}`)} />)}
            </div>
          </div>)}
      </div>
    </section>;
}
function DealDocumentCard({
  deal,
  onClick
}: {
  deal: DealCard;
  onClick: () => void;
}) {
  const date = new Date(deal.created_at).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
  return <button onClick={onClick} className="text-left bg-white rounded-md border border-slate-200 hover:border-slate-400 transition-colors p-6 group">
      {/* Top mono row — like a document header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-slate-400">
          {deal.id.slice(0, 8)}
        </span>
        <span className="font-mono text-[10px] tracking-wider text-slate-400">
          {date}
        </span>
      </div>

      {/* Body */}
      <p className="text-[15px] font-medium text-slate-900 leading-snug mb-3">
        {deal.commodity}
      </p>
      <p className="text-xs text-slate-500 leading-relaxed mb-6">
        with <span className="text-slate-700">{deal.counterparty}</span>
      </p>

      {/* Footer mono volume */}
      <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
        <span className="font-mono text-xs text-slate-700 tracking-tight">
          {deal.volume}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400 group-hover:text-primary transition-colors">
          Open →
        </span>
      </div>
    </button>;
}
function SkeletonCard() {
  return <div className="bg-white rounded-md border border-slate-200 p-6 animate-pulse">
      <div className="h-3 w-24 bg-slate-100 rounded mb-6" />
      <div className="h-4 w-3/4 bg-slate-100 rounded mb-3" />
      <div className="h-3 w-1/2 bg-slate-100 rounded" />
    </div>;
}
function LaneEmptyState() {
  return <div className="bg-white rounded-md border border-dashed border-slate-200 p-8 text-center">
      <p className="text-xs text-slate-400 font-mono tracking-wide uppercase">
        No deals
      </p>
    </div>;
}