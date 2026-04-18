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

      // Matches awaiting commitment from this org.
      // Include creator slot (`org_id`) — buyer/seller_org_id are often null until counterparty resolves.
      const { data: matches } = await supabase
        .from("matches")
        .select("id, commodity, quantity_amount, quantity_unit, buyer_name, seller_name, state, buyer_org_id, seller_org_id, org_id")
        .or(`buyer_org_id.eq.${profile.org_id},seller_org_id.eq.${profile.org_id},org_id.eq.${profile.org_id}`)
        .in("state", ["counterparty_sighted", "buyer_committed", "seller_committed", "pending_finality", "terms_pending", "committed"])
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
    <section className="bg-white rounded-md border border-slate-200 mb-8">
      <div className="px-6 pt-4 pb-3 border-b border-slate-100">
        <h2 className="text-xs font-mono tracking-[0.2em] uppercase text-slate-400">
          Requires Your Attention
        </h2>
      </div>

      <div className="p-2">
        {isLoading ? (
          <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
        ) : !data || data.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-4 p-4 hover:bg-slate-50/60 rounded-md transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-900 leading-snug mb-0.5">
                    {item.title}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono tracking-wide">
                    {item.meta} · <span className="text-slate-400">{item.id.slice(0, 8)}</span>
                  </p>
                </div>
                <button
                  onClick={() => navigate(item.href)}
                  className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
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
    <div className="px-6 py-6 flex items-center gap-3">
      <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-slate-50 shrink-0">
        <CheckCircle2 className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-slate-700 font-medium leading-tight">You are all caught up.</p>
        <p className="text-xs text-slate-400 leading-snug">
          New activity will surface here automatically.
        </p>
      </div>
    </div>
  );
}
