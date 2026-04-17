/**
 * BillingOverview, Trade User credit vault & burn ledger.
 *
 * Editorial layout: typographic balance hero, three horizontal
 * border-only top-up cards with dark-green Purchase CTAs, and a
 * high-density Usage History audit log.
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

// Dark institutional green, matches the "Sealed" tone used in compliance.
const INK_GREEN = "hsl(155 35% 22%)";
const INK_GREEN_HOVER = "hsl(155 35% 16%)";

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
    toast.info(`${credits} credits: checkout coming online soon.`);
  };

  const displayBalance = balance ?? 0;
  const zarValue = (displayBalance * 10).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

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
            {loading ? "-" : displayBalance.toLocaleString()}
          </span>
          <span className="text-2xl text-slate-400 font-light">Credits</span>
        </div>
        <p className="mt-6 font-mono text-sm text-slate-700 max-w-2xl">
          R{zarValue} ZAR equivalent.
          <span className="text-slate-500">
            {" "}Credits are consumed atomically upon POI generation.
          </span>
        </p>
      </section>

      {/* ── TOP-UP / PROVISIONING ─────────────────────────────── */}
      <section className="mb-20">
        <div className="flex items-baseline justify-between mb-6 pb-4 border-b border-slate-200">
          <h2 className="text-sm font-medium tracking-wider uppercase text-slate-500">
            Provisioning
          </h2>
          <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400">
            ZAR · VAT Inclusive
          </p>
        </div>

        <div className="space-y-3">
          {PACKS.map((pack) => (
            <div
              key={pack.credits}
              className="grid grid-cols-12 gap-6 items-center bg-white border border-slate-200 rounded-sm px-6 py-5 hover:border-slate-400 transition-colors"
            >
              {/* Credits column */}
              <div className="col-span-12 sm:col-span-3 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {pack.credits}
                </span>
                <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
                  Credits
                </span>
              </div>

              {/* Price column */}
              <div className="col-span-6 sm:col-span-3">
                <p className="font-mono text-base text-slate-900 tabular-nums">
                  {pack.price}
                </p>
                <p className="font-mono text-[10px] text-slate-500 mt-0.5">
                  {pack.unit}
                </p>
              </div>

              {/* Saving badge column */}
              <div className="col-span-6 sm:col-span-3">
                {pack.saving ? (
                  <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-600 border border-slate-200 px-2 py-1 rounded-sm">
                    {pack.saving}
                  </span>
                ) : (
                  <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">
                    Standard rate
                  </span>
                )}
              </div>

              {/* Action column */}
              <div className="col-span-12 sm:col-span-3 sm:text-right">
                <button
                  type="button"
                  onClick={() => handlePurchase(pack.credits)}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-sm text-sm font-medium text-white transition-colors w-full sm:w-auto"
                  style={{ backgroundColor: INK_GREEN }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = INK_GREEN_HOVER;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = INK_GREEN;
                  }}
                >
                  Purchase
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── USAGE HISTORY ─────────────────────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between mb-6 pb-4 border-b border-slate-200">
          <h2 className="text-sm font-medium tracking-wider uppercase text-slate-500">
            Usage History
          </h2>
          <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400">
            Append-only · Cryptographically chained
          </p>
        </div>

        <div className="overflow-x-auto bg-white border border-slate-200 rounded-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60">
                <th className="text-left px-5 py-3 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-slate-500">
                  Date
                </th>
                <th className="text-left px-5 py-3 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-slate-500">
                  Action
                </th>
                <th className="text-left px-5 py-3 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-slate-500">
                  Reference ID
                </th>
                <th className="text-right px-5 py-3 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-slate-500">
                  Amount
                </th>
                <th className="text-right px-5 py-3 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-slate-500">
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
                  ? "Credits Purchased"
                  : isBurn
                    ? "POI Generated"
                    : (row.action_type ?? "Activity");

                return (
                  <tr
                    key={row.id}
                    className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50 transition-colors"
                  >
                    <td className="px-5 py-3.5 font-mono text-[12px] text-slate-500 whitespace-nowrap tabular-nums">
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
                    <td className="px-5 py-3.5 text-sm text-slate-900">{action}</td>
                    <td className="px-5 py-3.5 font-mono text-[11px] text-slate-600">
                      {row.id}
                    </td>
                    <td
                      className="px-5 py-3.5 text-right font-mono text-sm tabular-nums font-medium"
                      style={{
                        color: isBurn ? "hsl(0 65% 38%)" : "hsl(155 45% 28%)",
                      }}
                    >
                      {isBurn ? `−${burned}` : `+${burned || 0}`}
                      <span
                        className="ml-1 text-[11px] font-normal"
                        style={{ color: "hsl(215 16% 55%)" }}
                      >
                        {Math.abs(burned) === 1 ? "Credit" : "Credits"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono text-sm text-slate-500 tabular-nums">
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
