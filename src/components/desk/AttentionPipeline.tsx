import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface AttentionItem {
  id: string;
  title: string;
  meta: string;
  href: string;
}

export function AttentionPipeline() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["desk-attention", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<AttentionItem[]> => {
      // Pull profile org first
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user!.id)
        .maybeSingle();
      if (!profile?.org_id) return [];

      // Matches awaiting commitment from this org
      const { data: matches } = await supabase
        .from("matches")
        .select("id, commodity, quantity_amount, quantity_unit, buyer_name, seller_name, state, buyer_org_id, seller_org_id")
        .or(`buyer_org_id.eq.${profile.org_id},seller_org_id.eq.${profile.org_id}`)
        .in("state", ["counterparty_sighted", "buyer_committed", "seller_committed", "pending_finality"])
        .order("created_at", { ascending: false })
        .limit(5);

      if (!matches) return [];

      return matches.map((m) => {
        const isBuyer = m.buyer_org_id === profile.org_id;
        const counterparty = isBuyer ? m.seller_name : m.buyer_name;
        const qty = m.quantity_amount && m.quantity_unit
          ? `${Number(m.quantity_amount).toLocaleString()}${m.quantity_unit}`
          : "Unspecified volume";
        return {
          id: m.id,
          title: `Awaiting your confirmation: ${qty} ${m.commodity ?? "-"}`,
          meta: counterparty ? `Counterparty · ${counterparty}` : "Counterparty pending",
          href: `/desk/deals/${m.id}`,
        };
      });
    },
  });

  return (
    <section className="bg-white rounded-md border border-slate-200 mb-12">
      <div className="px-8 pt-8 pb-6 border-b border-slate-100">
        <h2 className="text-sm font-mono tracking-[0.2em] uppercase text-slate-400">
          Requires Your Attention
        </h2>
      </div>

      <div className="p-2">
        {isLoading ? (
          <div className="p-12 text-center text-sm text-slate-400">Loading…</div>
        ) : !data || data.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-6 p-6 hover:bg-slate-50/60 rounded-md transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] text-slate-900 leading-relaxed mb-1">
                    {item.title}
                  </p>
                  <p className="text-xs text-slate-500 font-mono tracking-wide">
                    {item.meta} · <span className="text-slate-400">{item.id.slice(0, 8)}</span>
                  </p>
                </div>
                <button
                  onClick={() => navigate(item.href)}
                  className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  Review &amp; Seal
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="px-12 py-20 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-50 mb-6">
        <CheckCircle2 className="h-5 w-5 text-slate-400" strokeWidth={1.5} />
      </div>
      <p className="text-base text-slate-700 mb-2 font-medium">You are all caught up.</p>
      <p className="text-sm text-slate-400 leading-relaxed max-w-sm mx-auto">
        No deals require your attention. New activity will surface here automatically.
      </p>
    </div>
  );
}
