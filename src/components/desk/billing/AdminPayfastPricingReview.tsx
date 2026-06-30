/**
 * AdminPayfastPricingReview — admin-only review + editor panel.
 *
 * Shows:
 *   • the live PayFast availability probe;
 *   • the current admin-managed USD/ZAR rate from
 *     `admin_settings.payfast_usd_zar_rate`;
 *   • the USD price table and the ZAR amounts PayFast will charge
 *     given the current rate;
 *   • a small inline editor (platform admin only) to update the rate.
 *
 * Pricing/crediting logic is untouched. The flag exports below stay
 * read-only so reviewers can see the customer-surface state at a
 * glance.
 *
 * Caller MUST gate on `isAdmin`. The component itself does not do
 * authentication, but the underlying RLS on `admin_settings` only
 * allows platform admins to write.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  PAYFAST_USD_PRICES,
  type PayfastCustomerPackageId,
} from "@/lib/credit-checkout-payfast";
import { usePayfastPublicAvailability } from "@/hooks/use-payfast-public-availability";
import {
  PAYFAST_PUBLIC_PRICING_CONFIRMED,
  PAYSTACK_PUBLIC_ENABLED,
} from "./PaymentMethodPicker";

interface Row {
  id: PayfastCustomerPackageId;
  credits: number;
  usd: number;
}

const ROWS: Row[] = [
  { id: "single",   credits: 1,   usd: PAYFAST_USD_PRICES.single },
  { id: "pack_10",  credits: 10,  usd: PAYFAST_USD_PRICES.pack_10 },
  { id: "pack_50",  credits: 50,  usd: PAYFAST_USD_PRICES.pack_50 },
  { id: "pack_200", credits: 200, usd: PAYFAST_USD_PRICES.pack_200 },
];

function fmtZar(n: number): string {
  return `R${n.toLocaleString("en-ZA", { maximumFractionDigits: 2 })}`;
}
function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export function AdminPayfastPricingReview() {
  const probe = usePayfastPublicAvailability();
  const liveRate = probe.usdZarRate;

  const [draftRate, setDraftRate] = useState<string>("");
  const [savedMeta, setSavedMeta] = useState<{
    rate: number | null;
    set_at: string | null;
    note: string | null;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("admin_settings")
          .select("value, updated_at")
          .eq("key", "payfast_usd_zar_rate")
          .maybeSingle();
        if (cancelled) return;
        const v = (data as { value?: Record<string, unknown> } | null)?.value ?? null;
        const rate = v && typeof v.rate !== "undefined" ? Number(v.rate) : null;
        const set_at = v && typeof v.set_at === "string" ? (v.set_at as string) : null;
        const note = v && typeof v.note === "string" ? (v.note as string) : null;
        setSavedMeta({
          rate: Number.isFinite(rate as number) ? (rate as number) : null,
          set_at,
          note,
        });
        if (rate && Number.isFinite(rate)) setDraftRate(String(rate));
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    const parsed = Number(draftRate);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error("Rate must be a positive number.");
      return;
    }
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const value = {
        rate: parsed,
        note: "Manual USD->ZAR rate used by payfast-checkout-public to compute the ZAR amount sent to PayFast.",
        source: "admin_manual",
        set_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("admin_settings")
        .upsert(
          { key: "payfast_usd_zar_rate", value, updated_by: userData?.user?.id ?? null },
          { onConflict: "key" },
        );
      if (error) throw error;
      setSavedMeta({ rate: parsed, set_at: value.set_at, note: value.note });
      toast.success(`USD/ZAR rate set to ${parsed}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save rate.");
    } finally {
      setSaving(false);
    }
  };

  const rateForDisplay = liveRate ?? savedMeta?.rate ?? null;

  return (
    <section
      data-testid="admin-payfast-pricing-review"
      className="rounded-sm border border-amber-300/60 bg-amber-50/60 p-4 sm:p-5 space-y-3"
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-800">
          Admin · PayFast pricing &amp; FX
        </span>
        <span
          data-testid="admin-payfast-flag-state"
          className={`font-mono text-[10px] uppercase tracking-[0.14em] rounded-sm px-2 py-0.5 border ${
            probe.available
              ? "border-emerald-400 text-emerald-800 bg-emerald-50"
              : "border-amber-400 text-amber-900 bg-amber-100"
          }`}
        >
          Customer PayFast = {probe.available ? "VISIBLE" : "HIDDEN"}
        </span>
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.14em] rounded-sm px-2 py-0.5 border ${
            PAYSTACK_PUBLIC_ENABLED
              ? "border-emerald-400 text-emerald-800 bg-emerald-50"
              : "border-slate-300 text-slate-700 bg-slate-50"
          }`}
        >
          Paystack public = {String(PAYSTACK_PUBLIC_ENABLED)}
        </span>
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.14em] rounded-sm px-2 py-0.5 border ${
            PAYFAST_PUBLIC_PRICING_CONFIRMED
              ? "border-emerald-400 text-emerald-800 bg-emerald-50"
              : "border-amber-400 text-amber-900 bg-amber-100"
          }`}
        >
          Pricing confirmed = {String(PAYFAST_PUBLIC_PRICING_CONFIRMED)}
        </span>
      </header>

      <p className="text-xs text-amber-900/90 leading-relaxed">
        Credits are priced in USD ($10/credit). PayFast charges the
        computed ZAR amount using the rate below. The rate is locked
        into purchase metadata when a customer starts checkout; later
        rate changes do not affect in-flight purchases. ITN crediting
        and Paystack are unchanged.
      </p>

      {/* FX rate editor */}
      <div className="rounded-sm border border-amber-300/70 bg-white/70 p-3 space-y-2">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="admin-payfast-fx-rate"
              className="block font-mono text-[10px] uppercase tracking-[0.16em] text-amber-900/80"
            >
              USD → ZAR rate
            </label>
            <input
              id="admin-payfast-fx-rate"
              data-testid="admin-payfast-fx-rate-input"
              type="number"
              step="0.01"
              min="0"
              value={draftRate}
              onChange={(e) => setDraftRate(e.target.value)}
              className="mt-1 w-32 rounded-sm border border-amber-300 bg-white px-2 py-1 font-mono text-sm"
              disabled={saving || loadingMeta}
            />
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loadingMeta}
            data-testid="admin-payfast-fx-rate-save"
            className="inline-flex items-center gap-2 rounded-sm border border-amber-700 bg-amber-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save rate
          </button>
          <div className="text-[11px] font-mono text-amber-900/80">
            {loadingMeta ? (
              <>Loading…</>
            ) : savedMeta?.rate ? (
              <>
                Live: <span className="text-amber-950">$1 = R{savedMeta.rate}</span>
                {savedMeta.set_at && (
                  <> · set {new Date(savedMeta.set_at).toLocaleString()}</>
                )}
              </>
            ) : (
              <>No rate set — PayFast customer checkout is blocked.</>
            )}
          </div>
        </div>
        <p className="text-[11px] text-amber-900/70">
          Only platform admins can change this (enforced by RLS on
          <code className="mx-1">admin_settings</code>). Changes are
          audited automatically.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-left text-amber-900/80 border-b border-amber-300/60">
              <th className="py-1.5 pr-3">Pack</th>
              <th className="py-1.5 pr-3">Credits</th>
              <th className="py-1.5 pr-3">USD (live)</th>
              <th className="py-1.5 pr-3">Rate</th>
              <th className="py-1.5 pr-3">PayFast ZAR</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const zar = rateForDisplay
                ? Math.round(r.usd * rateForDisplay * 100) / 100
                : null;
              return (
                <tr
                  key={r.id}
                  data-testid={`admin-payfast-pricing-row-${r.id}`}
                  className="border-b border-amber-200/60 last:border-0"
                >
                  <td className="py-1.5 pr-3">{r.id}</td>
                  <td className="py-1.5 pr-3">{r.credits}</td>
                  <td className="py-1.5 pr-3">{fmtUsd(r.usd)}</td>
                  <td className="py-1.5 pr-3">
                    {rateForDisplay ? `$1 = R${rateForDisplay}` : "—"}
                  </td>
                  <td className="py-1.5 pr-3 font-semibold text-amber-950">
                    {zar !== null ? fmtZar(zar) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-amber-900/80">
        Source of truth on apply: USD list lives in
        <code className="mx-1">src/lib/credit-checkout-payfast.ts</code>
        and
        <code className="mx-1">
          supabase/functions/_shared/payments/payfast-customer-packages.ts
        </code>
        . The FX rate lives in
        <code className="mx-1">admin_settings.payfast_usd_zar_rate</code>
        and is resolved by
        <code className="mx-1">payfast-checkout-public</code>.
      </p>
    </section>
  );
}
