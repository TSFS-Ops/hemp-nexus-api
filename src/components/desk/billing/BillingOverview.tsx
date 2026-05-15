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
import {
  startCreditCheckout,
  verifyCreditCheckout,
  type CreditPackageId,
} from "@/lib/credit-checkout";
import { CheckoutErrorNotice } from "./CheckoutErrorNotice";
import { PaymentReferenceStatus } from "./PaymentReferenceStatus";
import { BillingUnavailableNotice } from "./BillingUnavailableNotice";
import { useBillingAvailability } from "@/hooks/use-billing-availability";
import { TruncationBanner } from "@/components/ui/truncation-banner";

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
  credits: number;
  price: string;
  unit: string;
  saving?: string;
}> = [
  // USD-native settlement (cutover 2026-05-01). Paystack charges
  // Izenzo customers directly in USD — no FX conversion at checkout.
  // Display only USD here — drift between this list and the backend
  // `TOKEN_PACKAGES` registry will charge the wrong amount.
  { id: "single", credits: 1, price: "$1", unit: "$1.00 / credit" },
  { id: "pack_10", credits: 10, price: "$10", unit: "$1.00 / credit" },
  { id: "pack_50", credits: 50, price: "$45", unit: "$0.90 / credit", saving: "10% saving" },
  { id: "pack_200", credits: 200, price: "$160", unit: "$0.80 / credit", saving: "20% saving" },
];

// Dark institutional green, matches the "Sealed" tone used in compliance.
const INK_GREEN = "hsl(155 35% 22%)";
const INK_GREEN_HOVER = "hsl(155 35% 16%)";

export function BillingOverview() {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerTotalCount, setLedgerTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<CreditPackageId | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  // Reference picked up from the Paystack redirect query string — passed
  // down to PaymentReferenceStatus so it can prioritise polling that ref.
  const [activeReference, setActiveReference] = useState<string | null>(null);
  // Per-pack error message — when the Paystack initialisation fails we
  // surface the backend's reason inline beside the failing Purchase
  // button (with a Retry control), instead of just a transient toast.
  const [packErrors, setPackErrors] = useState<Partial<Record<CreditPackageId, string>>>({});
  const { availability: billingAvailability } = useBillingAvailability();

  // Stable refresh that re-reads the wallet + recent ledger so we can
  // call it both on mount and after a successful Paystack verify.
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
    setOrgId(profile.org_id);
    const [walletRes, ledgerRes] = await Promise.all([
      // `token_balances` is the canonical wallet — it is what
      // `atomic_token_credit` (purchase) and `atomic_token_burn` (POI
      // mint) mutate. Reading from `token_wallets` here previously
      // caused a phantom-zero balance after a real top-up.
      supabase
        .from("token_balances")
        .select("balance")
        .eq("org_id", profile.org_id)
        .maybeSingle(),
      supabase
        .from("token_ledger")
        .select("id, endpoint, action_type, outcome, tokens_burned, remaining_balance, created_at", { count: "exact" })
        .eq("org_id", profile.org_id)
        .order("created_at", { ascending: false })
        .limit(40),
    ]);
    setBalance(Number(walletRes.data?.balance ?? 0));
    setLedger((ledgerRes.data ?? []) as unknown as LedgerEntry[]);
    setLedgerTotalCount(ledgerRes.count ?? ledgerRes.data?.length ?? 0);
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
    setActiveReference(reference);
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

  const handlePurchase = async (pack: { id: CreditPackageId }) => {
    if (purchasing) return;
    // Defence-in-depth: even if the disabled button is bypassed, never
    // call the token-purchase edge function while billing is unavailable.
    if (!billingAvailability.enabled) return;
    setPurchasing(pack.id);
    // Clear any prior error for this pack on a fresh attempt so the
    // user sees the spinner state rather than the stale message.
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
        e instanceof Error ? e.message : "Could not start checkout. Please try again.";
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

  const displayBalance = balance ?? 0;
  // 1 credit = $1 USD. Paystack charges natively in USD (cutover 2026-05-01).
  const usdValue = displayBalance.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <>
      {/* ── HEADER ────────────────────────────────────────────── */}
      <header className="mb-16">
        <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-muted-foreground/70 mb-3">
          Treasury & Settlement
        </p>
        <h1 className="text-4xl lg:text-5xl font-semibold text-foreground tracking-tight leading-tight">
          Billing
        </h1>
      </header>

      {/* ── BALANCE HERO ──────────────────────────────────────── */}
      <section className="mb-20">
        <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted-foreground/70 mb-6">
          Available Balance
        </p>
        <div className="flex items-baseline gap-5 flex-wrap">
          <span className="font-semibold text-foreground tracking-tight tabular-nums leading-none text-7xl lg:text-8xl">
            {loading ? "-" : displayBalance.toLocaleString()}
          </span>
          <span className="text-2xl text-muted-foreground/70 font-light">Credits</span>
        </div>
        <p className="mt-6 font-mono text-sm text-muted-foreground max-w-2xl">
          ${usdValue} USD equivalent.
          <span className="text-muted-foreground">
            {" "}Credits are consumed atomically upon POI generation. 1 credit = $1.00 USD, charged in USD at checkout.
          </span>
        </p>
      </section>

      {/* ── PAYSTACK REFERENCE STATUS ─────────────────────────── */}
      <PaymentReferenceStatus
        orgId={orgId}
        activeReference={activeReference}
        onCredited={() => void refresh()}
      />

      {/* ── TOP-UP / PROVISIONING ─────────────────────────────── */}
      <section className="mb-20">
        <div className="flex items-baseline justify-between mb-6 pb-4 border-b border-border">
          <h2 className="text-sm font-medium tracking-wider uppercase text-muted-foreground">
            Provisioning
          </h2>
          <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground/70">
            USD · Native settlement
          </p>
        </div>

        {!billingAvailability.enabled && (
          <div className="mb-6">
            <BillingUnavailableNotice message={billingAvailability.message} />
          </div>
        )}

        <div className="space-y-3">
          {PACKS.map((pack) => {
            const error = packErrors[pack.id];
            const isPending = purchasing === pack.id;
            return (
              <div key={pack.id} className="space-y-2">
                <div className="grid grid-cols-12 gap-6 items-center bg-card border border-slate-200 rounded-md px-6 py-5 hover:border-slate-300 hover:bg-slate-50/40 transition-colors">
                  {/* Credits column */}
                  <div className="col-span-12 sm:col-span-3 flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-semibold text-foreground tabular-nums">
                      {pack.credits}
                    </span>
                    <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                      Credits
                    </span>
                  </div>

                  {/* Price column */}
                  <div className="col-span-6 sm:col-span-3">
                    <p className="font-mono text-base text-foreground tabular-nums">
                      {pack.price}
                    </p>
                    <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
                      {pack.unit}
                    </p>
                  </div>

                  {/* Saving badge column */}
                  <div className="col-span-6 sm:col-span-3">
                    {pack.saving ? (
                      <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground border border-border px-2 py-1 rounded-sm">
                        {pack.saving}
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground/70">
                        Standard rate
                      </span>
                    )}
                  </div>

                  {/* Action column */}
                  <div className="col-span-12 sm:col-span-3 sm:text-right">
                    <button
                      type="button"
                      onClick={() => handlePurchase(pack)}
                      disabled={purchasing !== null || !billingAvailability.enabled}
                      aria-describedby={error ? `pack-error-${pack.id}` : undefined}
                      data-testid={`billing-overview-purchase-${pack.id}`}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-sm text-sm font-medium text-white transition-colors w-full sm:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{ backgroundColor: INK_GREEN }}
                      onMouseEnter={(e) => {
                        if (purchasing === null && billingAvailability.enabled)
                          e.currentTarget.style.backgroundColor = INK_GREEN_HOVER;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = INK_GREEN;
                      }}
                    >
                      {!billingAvailability.enabled
                        ? "Unavailable"
                        : isPending
                          ? "Redirecting…"
                          : error
                            ? "Try again"
                            : "Purchase"}
                    </button>
                  </div>
                </div>

                {error && (
                  <div id={`pack-error-${pack.id}`}>
                    <CheckoutErrorNotice
                      message={error}
                      retrying={isPending}
                      onRetry={() => handlePurchase(pack)}
                      onDismiss={() => dismissPackError(pack.id)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── USAGE HISTORY ─────────────────────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between mb-6 pb-4 border-b border-border">
          <h2 className="text-sm font-medium tracking-wider uppercase text-muted-foreground">
            Usage History
          </h2>
          <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground/70">
            Append-only · Tamper-Proofally chained
          </p>
        </div>

        <div className="mb-3">
          <TruncationBanner data={ledger} totalCount={ledgerTotalCount ?? undefined} limit={40} />
        </div>

        <div className="overflow-x-auto bg-card border border-border rounded-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/60">
                <th className="text-left px-5 py-3 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-muted-foreground">
                  Date
                </th>
                <th className="text-left px-5 py-3 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-muted-foreground">
                  Action
                </th>
                <th className="text-left px-5 py-3 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-muted-foreground">
                  Reference ID
                </th>
                <th className="text-right px-5 py-3 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-muted-foreground">
                  Amount
                </th>
                <th className="text-right px-5 py-3 font-mono text-[10px] font-medium tracking-[0.2em] uppercase text-muted-foreground">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-sm text-muted-foreground/70 font-mono">
                    Loading ledger…
                  </td>
                </tr>
              )}

              {!loading && ledger.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-16 text-center">
                    <p className="text-sm text-muted-foreground">No ledger entries yet.</p>
                    <p className="mt-2 font-mono text-[11px] text-muted-foreground/70">
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
                // Semantic badge palette - matches the "Institutional Premium" pill
                // language used across the desk (slate = neutral, emerald = sealed,
                // amber = burn / spend).
                const badgeClasses = isPurchase
                  ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                  : isBurn
                    ? "bg-amber-100 text-amber-800 border border-amber-200"
                    : "bg-slate-100 text-slate-600 border border-slate-200";

                return (
                  <tr
                    key={row.id}
                    className="border-b border-border last:border-b-0 hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-5 py-3.5 font-mono text-[12px] text-muted-foreground whitespace-nowrap tabular-nums">
                      {new Date(row.created_at).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                      <span className="text-muted-foreground/50 mx-1.5">·</span>
                      {new Date(row.created_at).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-5 py-3.5 text-sm">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium tracking-wide ${badgeClasses}`}
                      >
                        {action}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[11px] text-muted-foreground">
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
                    <td className="px-5 py-3.5 text-right font-mono text-sm text-muted-foreground tabular-nums">
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
            <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground/70">
              Showing last {ledger.length} entries
            </p>
            <button
              type="button"
              className="font-mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground hover:text-foreground transition-colors"
            >
              Export Full Ledger ↓
            </button>
          </div>
        )}
      </section>
    </>
  );
}
