import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface LedgerEntry {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  created_at: string;
}

const PACKS = [
  {
    name: "Pay-as-you-go",
    price: "R10",
    unit: "per credit",
    credits: 1,
    description: "Buy credits on demand. No commitment, no expiry.",
    cta: "Purchase 1 credit",
  },
  {
    name: "Starter Pack",
    price: "R1,799",
    unit: "200 credits",
    credits: 200,
    description: "For desks running multiple trades each week. Roughly 10% saving.",
    cta: "Purchase Starter",
    highlight: true,
  },
  {
    name: "Professional Pack",
    price: "R6,299",
    unit: "750 credits",
    credits: 750,
    description: "For high-volume institutional desks. Roughly 16% saving.",
    cta: "Purchase Professional",
  },
];

export function TokenBalanceTab() {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .maybeSingle();
      if (!profile?.org_id) {
        setLoading(false);
        return;
      }
      const [walletRes, ledgerRes] = await Promise.all([
        supabase
          .from("token_wallets")
          .select("balance")
          .eq("org_id", profile.org_id)
          .maybeSingle(),
        supabase
          .from("token_ledger")
          .select("id, type, amount, balance_after, created_at")
          .eq("org_id", profile.org_id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      setBalance(Number(walletRes.data?.balance ?? 0));
      setLedger((ledgerRes.data ?? []) as LedgerEntry[]);
      setLoading(false);
    })();
  }, [user]);

  const handlePurchase = (pack: string) => {
    toast.info(`${pack} — checkout coming online soon.`);
  };

  return (
    <div>
      {/* Balance */}
      <div className="mb-16">
        <p className="text-xs font-medium tracking-wider uppercase text-slate-500 mb-4">
          Current Balance
        </p>
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-6xl font-semibold text-slate-900 tracking-tight">
            {loading ? "—" : balance?.toLocaleString() ?? "0"}
          </span>
          <span className="text-base text-slate-500">credits</span>
        </div>
        <p className="mt-4 text-sm text-slate-500 leading-relaxed max-w-md">
          Each Proof of Intent costs <span className="font-mono text-slate-900">1 credit (R10)</span>. Credits never expire.
        </p>
      </div>

      {/* Pricing tiers */}
      <div className="mb-16">
        <h3 className="text-sm font-medium tracking-wider uppercase text-slate-500 mb-6">
          Top Up
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PACKS.map((pack) => (
            <div
              key={pack.name}
              className="border border-slate-200 rounded-md p-8 hover:border-slate-400 transition-colors flex flex-col"
            >
              <p className="text-xs font-medium tracking-wider uppercase text-slate-500 mb-4">
                {pack.name}
              </p>
              <div className="mb-2">
                <span className="font-mono text-3xl font-semibold text-slate-900 tracking-tight">
                  {pack.price}
                </span>
              </div>
              <p className="text-xs font-mono text-slate-400 mb-6">{pack.unit}</p>
              <p className="text-sm text-slate-500 leading-relaxed mb-8 flex-1">
                {pack.description}
              </p>
              <button
                onClick={() => handlePurchase(pack.name)}
                className={[
                  "w-full py-3 rounded-md text-sm font-medium transition-colors",
                  pack.highlight
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border border-slate-300 text-slate-900 hover:border-slate-900",
                ].join(" ")}
              >
                {pack.cta}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Ledger */}
      <div>
        <h3 className="text-sm font-medium tracking-wider uppercase text-slate-500 mb-6">
          Recent Activity
        </h3>
        <div className="border border-slate-200 rounded-md overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-6 py-3 text-[11px] font-medium tracking-wider uppercase text-slate-500">Date</th>
                <th className="text-left px-6 py-3 text-[11px] font-medium tracking-wider uppercase text-slate-500">Description</th>
                <th className="text-left px-6 py-3 text-[11px] font-medium tracking-wider uppercase text-slate-500">Reference</th>
                <th className="text-right px-6 py-3 text-[11px] font-medium tracking-wider uppercase text-slate-500">Change</th>
                <th className="text-right px-6 py-3 text-[11px] font-medium tracking-wider uppercase text-slate-500">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr><td colSpan={5} className="px-6 py-8 text-sm text-slate-400 text-center">Loading…</td></tr>
              )}
              {!loading && ledger.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <p className="text-sm text-slate-500">No activity yet.</p>
                    <p className="mt-1 text-xs text-slate-400">Your first Proof of Intent will appear here.</p>
                  </td>
                </tr>
              )}
              {ledger.map((row) => {
                const isBurn = Number(row.amount) < 0 || row.type === "burn" || row.type === "debit";
                return (
                  <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 text-sm text-slate-500 font-mono">
                      {new Date(row.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-900">
                      {isBurn ? "Proof of Intent generated" : "Credits purchased"}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-400 font-mono">
                      {row.id.slice(0, 8)}
                    </td>
                    <td className={["px-6 py-4 text-sm text-right font-mono", isBurn ? "text-rose-700" : "text-emerald-700"].join(" ")}>
                      {isBurn ? "" : "+"}{Number(row.amount).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-right font-mono text-slate-700">
                      {Number(row.balance_after).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
