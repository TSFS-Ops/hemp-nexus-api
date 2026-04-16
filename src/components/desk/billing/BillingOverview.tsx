/**
 * BillingOverview — Trade User credit vault & burn ledger.
 *
 * Editorial layout: typographic balance hero, three outline
 * purchase cards, and a high-density recent activity table.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface LedgerEntry {
  id: string;
  endpoint: string | null;
  action_type: string | null;
  outcome: string | null;
  tokens_burned: number;
  remaining_balance: number;
  created_at: string;
}

const PACKS = [
  { credits: 10, price: "R100", unit: "R10.00 / credit" },
  { credits: 50, price: "R450", unit: "R9.00 / credit", saving: "10% saving" },
  { credits: 200, price: "R1,600", unit: "R8.00 / credit", saving: "20% saving" },
];

export function BillingOverview() {
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
          .select("id, endpoint, action_type, outcome, tokens_burned, remaining_balance, created_at")
          .eq("org_id", profile.org_id)
          .order("created_at", { ascending: false })
          .limit(40),
      ]);
      setBalance(Number(walletRes.data?.balance ?? 0));
      setLedger((ledgerRes.data ?? []) as unknown as LedgerEntry[]);
      setLoading(false);
    })();
  }, [user]);

  const handlePurchase = (credits: number) => {
    toast.info(`${credits} credits — checkout coming online soon.`);
  };

  const displayBalance = balance ?? 0;
  const zarValue = (displayBalance * 10).toLocaleString("en-ZA");

  return (
    <>
      {/* ── HEADER ────────────────────────────────────────────── */}
      <header className="mb-16">
        <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-400 mb-3">
          Treasury & Settlement
        </p>
        <h1 className="text-4xl lg:text-5xl font-semibold text-slate-900 tracking-tight leading-tight">
          Billing
        </h1>
      </header>

      {/* ── BALANCE HERO ──────────────────────────────────────── */}
      <section className="mb-20">
        <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-400 mb-6">
          Available Balance
        </p>
        <div className="flex items-baseline gap-5 flex-wrap">
          <span className="font-semibold text-slate-900 tracking-tight tabular-nums leading-none text-7xl lg:text-8xl">
            {loading ? "—" : displayBalance.toLocaleString()}
          </span>
          <span className="text-2xl text-slate-400 font-light">Credits</span>
        </div>
        <p className="mt-6 font-mono text-sm text-slate-500">
          Approx. R{zarValue} ZAR available for trade actions.
        </p>
        <p className="mt-2 font-mono text-[11px] text-slate-400">
          1 credit = 1 Proof of Intent · Credits never expire
        </p>
      </section>

      {/* ── TOP-UP GRID ───────────────────────────────────────── */}
      <section className="mb-20">
        <div className="flex items-baseline justify-between mb-6 pb-4 border-b border-slate-200">
          <h2 className="text-sm font-medium tracking-wider uppercase text-slate-500">
            Purchase Credits
          </h2>
          <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400">
            ZAR · Inclusive
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PACKS.map((pack) => (
            <button
              key={pack.credits}
              onClick={() => handlePurchase(pack.credits)}
              className="group text-left border border-slate-300 rounded-sm p-8 hover:border-slate-900 transition-colors flex flex-col"
            >
              <div className="flex items-baseline justify-between mb-8">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400">
                  Pack
                </p>
                {pack.saving && (
                  <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500">
                    {pack.saving}
                  </p>
                )}
              </div>

              <p className="font-semibold text-slate-900 tracking-tight tabular-nums text-4xl">
                {pack.credits}
              </p>
              <p className="mt-1 font-mono text-[11px] tracking-[0.2em] uppercase text-slate-500">
                Credits
              </p>

              <div className="mt-8 pt-6 border-t border-slate-100 flex items-baseline justify-between">
                <span className="font-mono text-xl text-slate-900 tabular-nums">
                  {pack.price}
                </span>
                <span className="font-mono text-[10px] text-slate-500">
                  {pack.unit}
                </span>
              </div>

              <span className="mt-6 inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.2em] uppercase text-slate-500 group-hover:text-slate-900 transition-colors">
                Purchase →
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* ── BURN LEDGER ───────────────────────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between mb-6 pb-4 border-b border-slate-200">
          <h2 className="text-sm font-medium tracking-wider uppercase text-slate-500">
            Recent Activity
          </h2>
          <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400">
            Append-only · Cryptographically chained
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 pr-6 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-slate-500">
                  Date
                </th>
                <th className="text-left py-3 pr-6 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-slate-500">
                  Action
                </th>
                <th className="text-left py-3 pr-6 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-slate-500">
                  Reference ID
                </th>
                <th className="text-right py-3 pr-6 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-slate-500">
                  Amount
                </th>
                <th className="text-right py-3 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-slate-500">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-sm text-slate-400 font-mono">
                    Loading ledger…
                  </td>
                </tr>
              )}

              {!loading && ledger.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-16 text-center">
                    <p className="text-sm text-slate-500">No ledger entries yet.</p>
                    <p className="mt-2 font-mono text-[11px] text-slate-400">
                      Your first Proof of Intent burn will be recorded here.
                    </p>
                  </td>
                </tr>
              )}

              {ledger.map((row) => {
                const burned = Number(row.tokens_burned ?? 0);
                const isBurn = burned > 0;
                const isPurchase = row.action_type === "purchase";
                const action = isPurchase
                  ? "Credits purchased"
                  : isBurn
                    ? "Proof of Intent generated"
                    : (row.action_type ?? "Activity");

                return (
                  <tr
                    key={row.id}
                    className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors"
                  >
                    <td className="py-4 pr-6 font-mono text-[12px] text-slate-500 whitespace-nowrap">
                      {new Date(row.created_at).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                      <span className="text-slate-300 mx-1.5">·</span>
                      {new Date(row.created_at).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-4 pr-6 text-sm text-slate-900">
                      {action}
                    </td>
                    <td className="py-4 pr-6 font-mono text-[11px] text-slate-500">
                      {row.id.slice(0, 8).toUpperCase()}
                      <span className="text-slate-300">…</span>
                      {row.id.slice(-4).toUpperCase()}
                    </td>
                    <td
                      className={`py-4 pr-6 text-right font-mono text-sm tabular-nums ${
                        isBurn ? "text-slate-900" : "text-emerald-700"
                      }`}
                    >
                      {isBurn ? `−${burned}` : `+${burned || 0}`}
                      <span className="text-slate-400 ml-1 text-[11px]">
                        {Math.abs(burned) === 1 ? "Credit" : "Credits"}
                      </span>
                    </td>
                    <td className="py-4 text-right font-mono text-sm text-slate-500 tabular-nums">
                      {Number(row.remaining_balance ?? 0).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && ledger.length > 0 && (
          <div className="mt-6 flex items-center justify-between">
            <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400">
              Showing last {ledger.length} entries
            </p>
            <button
              type="button"
              className="font-mono text-[11px] tracking-[0.2em] uppercase text-slate-500 hover:text-slate-900 transition-colors"
            >
              Export Full Ledger ↓
            </button>
          </div>
        )}
      </section>
    </>
  );
}
