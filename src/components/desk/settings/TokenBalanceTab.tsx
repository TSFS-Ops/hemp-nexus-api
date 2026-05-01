import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  startCreditCheckout,
  verifyCreditCheckout,
  type CreditPackageId,
} from "@/lib/credit-checkout";
import { CheckoutErrorNotice } from "@/components/desk/billing/CheckoutErrorNotice";
import { BillingUnavailableNotice } from "@/components/desk/billing/BillingUnavailableNotice";
import { useBillingAvailability } from "@/hooks/use-billing-availability";

interface LedgerEntry {
  id: string;
  endpoint: string | null;
  action_type: string | null;
  outcome: string | null;
  tokens_burned: number;
  remaining_balance: number;
  created_at: string;
}

const PACKS: Array<{
  id: CreditPackageId;
  name: string;
  price: string;
  unit: string;
  credits: number;
  description: string;
  cta: string;
  highlight?: boolean;
}> = [
  // Prices in USD ($1 / credit canonical). Paystack settles natively
  // in USD as of cutover 2026-05-01 — no FX conversion at checkout.
  {
    id: "single",
    name: "Pay-as-you-go",
    price: "$1",
    unit: "per credit",
    credits: 1,
    description: "Buy a single credit on demand. No commitment, no expiry.",
    cta: "Purchase 1 credit",
  },
  {
    id: "pack_50",
    name: "Starter Pack",
    price: "$45",
    unit: "50 credits · 10% saving",
    credits: 50,
    description: "For desks running multiple trades each week.",
    cta: "Purchase Starter",
    highlight: true,
  },
  {
    id: "pack_200",
    name: "Professional Pack",
    price: "$160",
    unit: "200 credits · 20% saving",
    credits: 200,
    description: "For high-volume institutional desks.",
    cta: "Purchase Professional",
  },
];

export function TokenBalanceTab() {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<CreditPackageId | null>(null);
  // Per-pack initiation error — surfaced inline beside the failing
  // Purchase button (with Retry) instead of a transient toast.
  const [packErrors, setPackErrors] = useState<Partial<Record<CreditPackageId, string>>>({});
  const { availability: billingAvailability } = useBillingAvailability();

  const refresh = async () => {
    if (!user) return;
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
      // Read from `token_balances` (canonical wallet mutated by the
      // atomic credit/burn RPCs), not the stale `token_wallets` table.
      supabase
        .from("token_balances")
        .select("balance")
        .eq("org_id", profile.org_id)
        .maybeSingle(),
      supabase
        .from("token_ledger")
        .select("id, endpoint, action_type, outcome, tokens_burned, remaining_balance, created_at")
        .eq("org_id", profile.org_id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setBalance(Number(walletRes.data?.balance ?? 0));
    setLedger((ledgerRes.data ?? []) as unknown as LedgerEntry[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Process Paystack redirect-back ?status=…&reference=…
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const reference =
      params.get("reference") || params.get("trxref") || params.get("tx_ref");
    if (!reference) return;
    (async () => {
      try {
        if (status === "cancelled") {
          toast.info("Payment cancelled. No credits were charged.");
        } else {
          const result = await verifyCreditCheckout(reference);
          if (result.success) {
            toast.success(
              result.alreadyCredited
                ? "Credits already applied to your wallet."
                : `${result.credits ?? ""} credit${result.credits === 1 ? "" : "s"} added. New balance: ${result.newBalance ?? "—"}.`
            );
            await refresh();
          } else {
            toast.error(result.message ?? "Payment was not successful.");
          }
        }
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Could not verify payment. Contact support@izenzo.co.za."
        );
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete("status");
        url.searchParams.delete("reference");
        url.searchParams.delete("trxref");
        url.searchParams.delete("tx_ref");
        window.history.replaceState({}, "", url.toString());
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handlePurchase = async (pack: { id: CreditPackageId; name: string }) => {
    if (purchasing) return;
    if (!billingAvailability.enabled) return;
    setPurchasing(pack.id);
    setPackErrors((prev) => {
      if (!prev[pack.id]) return prev;
      const { [pack.id]: _omit, ...rest } = prev;
      return rest;
    });
    try {
      const { checkoutUrl } = await startCreditCheckout(pack.id);
      window.location.href = checkoutUrl;
    } catch (e) {
      const message =
        e instanceof Error ? e.message : `${pack.name}: could not start checkout.`;
      setPackErrors((prev) => ({ ...prev, [pack.id]: message }));
      setPurchasing(null);
    }
  };

  const dismissPackError = (id: CreditPackageId) => {
    setPackErrors((prev) => {
      if (!prev[id]) return prev;
      const { [id]: _omit, ...rest } = prev;
      return rest;
    });
  };

  return (
    <div>
      {/* Balance */}
      <div className="mb-12 md:mb-16">
        <p className="text-xs font-medium tracking-wider uppercase text-muted-foreground mb-3 md:mb-4">
          Current Balance
        </p>
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="font-mono text-4xl md:text-6xl font-semibold text-foreground tracking-tight">
            {loading ? "-" : balance?.toLocaleString() ?? "0"}
          </span>
          <span className="text-base text-muted-foreground">credits</span>
        </div>
        <p className="mt-3 md:mt-4 text-sm text-muted-foreground leading-relaxed max-w-md">
          Each Proof of Intent costs <span className="font-mono text-foreground">1 credit ($1.00 USD)</span>, charged in USD at checkout. Credits never expire.
        </p>
      </div>

      {/* Pricing tiers */}
      <div className="mb-16">
        <h3 className="text-sm font-medium tracking-wider uppercase text-muted-foreground mb-6">
          Top Up
        </h3>
        {!billingAvailability.enabled && (
          <div className="mb-6">
            <BillingUnavailableNotice message={billingAvailability.message} />
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PACKS.map((pack) => {
            const error = packErrors[pack.id];
            const isPending = purchasing === pack.id;
            return (
              <div
                key={pack.id}
                className="border border-border rounded-md p-8 hover:border-slate-400 transition-colors flex flex-col"
              >
                <p className="text-xs font-medium tracking-wider uppercase text-muted-foreground mb-4">
                  {pack.name}
                </p>
                <div className="mb-2">
                  <span className="font-mono text-3xl font-semibold text-foreground tracking-tight">
                    {pack.price}
                  </span>
                </div>
                <p className="text-xs font-mono text-muted-foreground/70 mb-6">{pack.unit}</p>
                <p className="text-sm text-muted-foreground leading-relaxed mb-8 flex-1">
                  {pack.description}
                </p>
                <button
                  onClick={() => handlePurchase(pack)}
                  disabled={purchasing !== null || !billingAvailability.enabled}
                  aria-describedby={error ? `tbt-pack-error-${pack.id}` : undefined}
                  data-testid={`token-balance-purchase-${pack.id}`}
                  className={[
                    "w-full py-3 rounded-md text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
                    pack.highlight
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "border border-border text-foreground hover:border-slate-900",
                  ].join(" ")}
                >
                  {!billingAvailability.enabled
                    ? "Unavailable"
                    : isPending
                      ? "Redirecting…"
                      : error
                        ? "Try again"
                        : pack.cta}
                </button>
                {error && (
                  <div id={`tbt-pack-error-${pack.id}`} className="mt-4">
                    <CheckoutErrorNotice
                      message={error}
                      retrying={isPending}
                      variant="inline"
                      onRetry={() => handlePurchase(pack)}
                      onDismiss={() => dismissPackError(pack.id)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Ledger */}
      <div>
        <h3 className="text-sm font-medium tracking-wider uppercase text-muted-foreground mb-6">
          Recent Activity
        </h3>

        {/* Mobile: cardified rows */}
        <div className="md:hidden space-y-3">
          {loading && (
            <div className="border border-border rounded-md px-4 py-8 text-sm text-muted-foreground/70 text-center">Loading…</div>
          )}
          {!loading && ledger.length === 0 && (
            <div className="border border-border rounded-md px-4 py-10 text-center">
              <p className="text-sm text-muted-foreground">No activity yet.</p>
              <p className="mt-1 text-xs text-muted-foreground/70">Your first Proof of Intent will appear here.</p>
            </div>
          )}
          {ledger.map((row) => {
            const burned = Number(row.tokens_burned ?? 0);
            const isBurn = burned > 0;
            return (
              <div key={row.id} className="border border-border rounded-md p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-foreground leading-snug">
                    {row.action_type === "purchase"
                      ? "Credits purchased"
                      : isBurn
                        ? "Proof of Intent generated"
                        : (row.action_type ?? "Activity")}
                  </p>
                  <span className={["text-sm font-mono shrink-0", isBurn ? "text-rose-700" : "text-[hsl(var(--emerald))]"].join(" ")}>
                    {isBurn ? `-${burned}` : `+${burned || 0}`}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
                  <span>{new Date(row.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
                  <span className="text-muted-foreground">Bal {Number(row.remaining_balance ?? 0).toLocaleString()}</span>
                </div>
                <p className="text-[10px] text-muted-foreground/70 font-mono">Ref {row.id.slice(0, 8)}</p>
              </div>
            );
          })}
        </div>

        {/* Desktop: full table */}
        <div className="hidden md:block border border-border rounded-md overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted border-b border-border">
              <tr>
                <th className="text-left px-6 py-3 text-[11px] font-medium tracking-wider uppercase text-muted-foreground">Date</th>
                <th className="text-left px-6 py-3 text-[11px] font-medium tracking-wider uppercase text-muted-foreground">Description</th>
                <th className="text-left px-6 py-3 text-[11px] font-medium tracking-wider uppercase text-muted-foreground">Reference</th>
                <th className="text-right px-6 py-3 text-[11px] font-medium tracking-wider uppercase text-muted-foreground">Change</th>
                <th className="text-right px-6 py-3 text-[11px] font-medium tracking-wider uppercase text-muted-foreground">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <tr><td colSpan={5} className="px-6 py-8 text-sm text-muted-foreground/70 text-center">Loading…</td></tr>
              )}
              {!loading && ledger.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <p className="text-sm text-muted-foreground">No activity yet.</p>
                    <p className="mt-1 text-xs text-muted-foreground/70">Your first Proof of Intent will appear here.</p>
                  </td>
                </tr>
              )}
              {ledger.map((row) => {
                const burned = Number(row.tokens_burned ?? 0);
                const isBurn = burned > 0;
                return (
                  <tr key={row.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-4 text-sm text-muted-foreground font-mono">
                      {new Date(row.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground">
                      {row.action_type === "purchase"
                        ? "Credits purchased"
                        : isBurn
                          ? "Proof of Intent generated"
                          : (row.action_type ?? "Activity")}
                    </td>
                    <td className="px-6 py-4 text-xs text-muted-foreground/70 font-mono">
                      {row.id.slice(0, 8)}
                    </td>
                    <td className={["px-6 py-4 text-sm text-right font-mono", isBurn ? "text-rose-700" : "text-[hsl(var(--emerald))]"].join(" ")}>
                      {isBurn ? `-${burned}` : `+${burned || 0}`}
                    </td>
                    <td className="px-6 py-4 text-sm text-right font-mono text-muted-foreground">
                      {Number(row.remaining_balance ?? 0).toLocaleString()}
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
