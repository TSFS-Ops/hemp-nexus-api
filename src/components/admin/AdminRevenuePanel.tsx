/**
 * AdminRevenuePanel
 * ─────────────────────────────────────────────────────────────────────
 * HQ → Revenue dashboard. Reads `public.token_ledger` rows that represent
 * paid credit purchases (endpoint = 'payment:*' OR action_type = 'credit_purchase'
 * with metadata.price_zar present) and joins them against organisation names.
 *
 * Surfaces:
 *   • Totals strip — revenue ZAR, credits sold, purchases, unique buyers.
 *   • Time-series — daily and monthly revenue (selectable window).
 *   • Top buyers — leaderboard with totals and last purchase.
 *   • Per-org timeline — pick an org, see every purchase ever.
 *
 * RLS: token_ledger has "Admins can view all token ledger entries" so this
 * panel only returns data when the current user is platform_admin.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/error-state";
import {
  Loader2,
  RefreshCw,
  TrendingUp,
  Coins,
  Users,
  Receipt,
  Download,
} from "lucide-react";
import { format, formatDistanceToNow, subDays } from "date-fns";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PurchaseRow {
  id: string;
  org_id: string | null;
  endpoint: string | null;
  action_type: string;
  tokens_burned: number;
  remaining_balance: number | null;
  metadata: Record<string, any> | null;
  created_at: string;
  request_id: string | null;
}

interface PurchaseEnriched extends PurchaseRow {
  org_name: string;
  credits: number;       // positive integer of credits granted
  amount_zar: number;    // gross revenue in ZAR
  package_id: string | null;
  payment_reference: string | null;
  customer_email: string | null;
  source: string;        // payment:paystack, payment:paystack:manual, etc.
}

// ─── Window options ──────────────────────────────────────────────────────────

const WINDOWS = [
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "180d", label: "Last 180 days", days: 180 },
  { value: "365d", label: "Last 12 months", days: 365 },
  { value: "all", label: "All time", days: 0 },
] as const;

type WindowValue = typeof WINDOWS[number]["value"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ZAR = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});

const NUM = new Intl.NumberFormat("en-ZA");

/**
 * A real revenue row in `token_ledger` is identified by:
 *   • action_type = 'credit_purchase'  — the canonical, server-authored marker
 *     written by the Paystack webhook + manual reconciliation paths, AND
 *   • metadata.price_zar present and > 0 — guarantees an amount was paid
 *     (filters out promotional credits, system grants, and reconciliation
 *     adjustments that share the action_type).
 *
 * We deliberately do NOT filter on endpoint LIKE 'payment:%' because that
 * pattern also matches non-revenue rows (e.g. action_type='credit' with
 * endpoint='credit_purchase' is a free grant, not a sale).
 *
 * Credits granted are read from metadata.credits when present; otherwise
 * we fall back to abs(tokens_burned) (Paystack writes a negative burn to
 * represent a credit grant in the ledger).
 */
function enrichPurchase(
  row: PurchaseRow,
  orgNameById: Map<string, string>,
): PurchaseEnriched {
  const meta = row.metadata ?? {};
  const credits =
    typeof meta.credits === "number"
      ? meta.credits
      : Math.abs(row.tokens_burned || 0);
  const amount_zar =
    typeof meta.price_zar === "number" ? meta.price_zar : 0;

  return {
    ...row,
    org_name: row.org_id ? orgNameById.get(row.org_id) ?? row.org_id.slice(0, 8) + "…" : "—",
    credits,
    amount_zar,
    package_id: typeof meta.package_id === "string" ? meta.package_id : null,
    payment_reference: typeof meta.payment_reference === "string" ? meta.payment_reference : null,
    customer_email: typeof meta.customer_email === "string" ? meta.customer_email : null,
    source: row.endpoint ?? row.action_type,
  };
}

/**
 * Server-side filter: `action_type = 'credit_purchase'`.
 * Client-side filter: `metadata.price_zar` > 0 (PostgREST cannot reliably
 * compare jsonb numerics without a typed view, so we narrow in JS).
 */
function isRevenueRow(row: PurchaseRow): boolean {
  if (row.action_type !== "credit_purchase") return false;
  const price = row.metadata?.price_zar;
  return typeof price === "number" && price > 0;
}

function bucketKey(iso: string, granularity: "day" | "month"): string {
  const d = new Date(iso);
  if (granularity === "month") {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AdminRevenuePanel() {
  const [timeWindow, setTimeWindow] = useState<WindowValue>("90d");
  const [granularity, setGranularity] = useState<"day" | "month">("day");
  const [selectedOrg, setSelectedOrg] = useState<string>("all");

  const sinceIso = useMemo(() => {
    const w = WINDOWS.find((x) => x.value === timeWindow);
    if (!w || w.days === 0) return null;
    return subDays(new Date(), w.days).toISOString();
  }, [timeWindow]);

  const { data, isLoading, isFetching, refetch, isError, error } = useQuery({
    queryKey: ["admin-revenue", timeWindow],
    queryFn: async () => {
      // 1) Pull canonical credit-purchase rows. action_type='credit_purchase'
      //    is the only marker the Paystack webhook + manual reconciliation
      //    write; we then narrow client-side to rows that actually carry a
      //    paid amount (metadata.price_zar > 0) so promotional grants and
      //    reconciliation adjustments never inflate revenue totals.
      let q = supabase
        .from("token_ledger")
        .select("id, org_id, endpoint, action_type, tokens_burned, remaining_balance, metadata, created_at, request_id")
        .eq("action_type", "credit_purchase")
        .order("created_at", { ascending: false })
        .limit(2000);

      if (sinceIso) q = q.gte("created_at", sinceIso);

      const { data: ledger, error: ledgerErr } = await q;
      if (ledgerErr) throw ledgerErr;

      const rows = ((ledger ?? []) as PurchaseRow[]).filter(isRevenueRow);
      const orgIds = Array.from(
        new Set(rows.map((r) => r.org_id).filter((x): x is string => !!x)),
      );

      // 2) Resolve org names in one round-trip.
      let orgNameById = new Map<string, string>();
      if (orgIds.length > 0) {
        const { data: orgs, error: orgErr } = await supabase
          .from("organizations")
          .select("id, name, legal_name, trading_name")
          .in("id", orgIds);
        if (orgErr) throw orgErr;
        for (const o of orgs ?? []) {
          const display =
            (o as any).legal_name ||
            (o as any).trading_name ||
            (o as any).name ||
            (o as any).id;
          orgNameById.set((o as any).id, display);
        }
      }

      const enriched = rows.map((r) => enrichPurchase(r, orgNameById));
      return { rows: enriched, orgNameById };
    },
    staleTime: 30_000,
  });

  const rows = data?.rows ?? [];

  // ─── Aggregations ─────────────────────────────────────────────────────────

  const totals = useMemo(() => {
    const out = {
      revenue: 0,
      credits: 0,
      purchases: rows.length,
      buyers: new Set<string>(),
      paid: 0,
      manual: 0,
    };
    for (const r of rows) {
      out.revenue += r.amount_zar;
      out.credits += r.credits;
      if (r.org_id) out.buyers.add(r.org_id);
      if ((r.endpoint ?? "").includes("manual")) out.manual += 1;
      else if ((r.endpoint ?? "").startsWith("payment:")) out.paid += 1;
    }
    return out;
  }, [rows]);

  const series = useMemo(() => {
    const byBucket = new Map<string, { revenue: number; credits: number; count: number }>();
    for (const r of rows) {
      const k = bucketKey(r.created_at, granularity);
      const cur = byBucket.get(k) ?? { revenue: 0, credits: 0, count: 0 };
      cur.revenue += r.amount_zar;
      cur.credits += r.credits;
      cur.count += 1;
      byBucket.set(k, cur);
    }
    const entries = Array.from(byBucket.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));
    const max = entries.reduce((m, [, v]) => Math.max(m, v.revenue), 0);
    return { entries, max };
  }, [rows, granularity]);

  const topBuyers = useMemo(() => {
    const map = new Map<
      string,
      { org_id: string; org_name: string; revenue: number; credits: number; count: number; last: string }
    >();
    for (const r of rows) {
      if (!r.org_id) continue;
      const cur = map.get(r.org_id) ?? {
        org_id: r.org_id,
        org_name: r.org_name,
        revenue: 0,
        credits: 0,
        count: 0,
        last: r.created_at,
      };
      cur.revenue += r.amount_zar;
      cur.credits += r.credits;
      cur.count += 1;
      if (r.created_at > cur.last) cur.last = r.created_at;
      map.set(r.org_id, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [rows]);

  const orgOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (r.org_id && !seen.has(r.org_id)) seen.set(r.org_id, r.org_name);
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const orgTimeline = useMemo(() => {
    if (selectedOrg === "all") return rows;
    return rows.filter((r) => r.org_id === selectedOrg);
  }, [rows, selectedOrg]);

  // ─── CSV export ───────────────────────────────────────────────────────────

  const exportCsv = () => {
    const header = [
      "created_at",
      "org_id",
      "org_name",
      "credits",
      "amount_zar",
      "package_id",
      "payment_reference",
      "customer_email",
      "source",
      "request_id",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      const cells = [
        r.created_at,
        r.org_id ?? "",
        `"${(r.org_name ?? "").replace(/"/g, '""')}"`,
        String(r.credits),
        String(r.amount_zar),
        r.package_id ?? "",
        r.payment_reference ?? "",
        r.customer_email ?? "",
        r.source ?? "",
        r.request_id ?? "",
      ];
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `revenue-${timeWindow}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header card with filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Revenue & sales</CardTitle>
          <CardDescription>
            Paid credit purchases recorded in the token ledger, joined to
            organisation names. Data is read-only and reflects real bank-cleared
            revenue (Paystack) plus any auditor-grade manual reconciliations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-3">
              <Select value={timeWindow} onValueChange={(v) => setTimeWindow(v as WindowValue)}>
                <SelectTrigger><SelectValue placeholder="Window" /></SelectTrigger>
                <SelectContent>
                  {WINDOWS.map((w) => (
                    <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3">
              <Select value={granularity} onValueChange={(v) => setGranularity(v as "day" | "month")}>
                <SelectTrigger><SelectValue placeholder="Granularity" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Daily</SelectItem>
                  <SelectItem value="month">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-4 flex gap-2">
              <Button
                variant="outline"
                onClick={exportCsv}
                disabled={rows.length === 0}
                className="gap-2"
              >
                <Download className="h-4 w-4" /> Export CSV
              </Button>
              <Button
                variant="outline"
                onClick={() => refetch()}
                disabled={isFetching}
                className="gap-2"
              >
                {isFetching
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            </div>
          </div>

          {/* Totals strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat
              icon={TrendingUp}
              label="Revenue"
              value={ZAR.format(totals.revenue)}
              hint={`${totals.paid} paid · ${totals.manual} manual`}
              tone="success"
            />
            <Stat
              icon={Coins}
              label="Credits sold"
              value={NUM.format(totals.credits)}
            />
            <Stat
              icon={Receipt}
              label="Purchases"
              value={NUM.format(totals.purchases)}
            />
            <Stat
              icon={Users}
              label="Unique buyers"
              value={NUM.format(totals.buyers.size)}
            />
          </div>

          {/* Time series */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : isError ? (
            <EmptyState
              title="Could not load revenue data"
              message={(error as Error)?.message ?? "Unknown error."}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No purchases in this window"
              message="Widen the time window to surface earlier credit purchases."
            />
          ) : (
            <RevenueChart series={series} granularity={granularity} />
          )}
        </CardContent>
      </Card>

      {/* Top buyers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Top buyers</CardTitle>
          <CardDescription>
            Organisations ranked by gross revenue in the selected window.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {topBuyers.length === 0 ? (
            <EmptyState
              title="No buyers yet"
              message="Once an organisation completes a Paystack purchase, they appear here."
            />
          ) : (
            <div className="border border-border rounded-sm overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Organisation</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                    <TableHead className="text-right">Purchases</TableHead>
                    <TableHead>Last purchase</TableHead>
                    <TableHead className="w-[120px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topBuyers.slice(0, 25).map((b, i) => (
                    <TableRow key={b.org_id}>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {i + 1}
                      </TableCell>
                      <TableCell className="font-medium">{b.org_name}</TableCell>
                      <TableCell className="text-right font-mono">
                        {ZAR.format(b.revenue)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {NUM.format(b.credits)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {NUM.format(b.count)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>{format(new Date(b.last), "yyyy-MM-dd")}</div>
                        <div className="text-muted-foreground">
                          {formatDistanceToNow(new Date(b.last), { addSuffix: true })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedOrg(b.org_id)}
                        >
                          View timeline
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-org timeline */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Per-org purchase timeline</CardTitle>
          <CardDescription>
            Every credit purchase recorded for the selected organisation, newest
            first. Use this to reconcile a specific account against Paystack.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="md:max-w-md">
            <Select value={selectedOrg} onValueChange={setSelectedOrg}>
              <SelectTrigger>
                <SelectValue placeholder="Choose organisation" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All organisations</SelectItem>
                {orgOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {orgTimeline.length === 0 ? (
            <EmptyState
              title="No purchases for this organisation"
              message="Try selecting a different organisation or widening the window."
            />
          ) : (
            <div className="border border-border rounded-sm overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    {selectedOrg === "all" && <TableHead>Organisation</TableHead>}
                    <TableHead>Source</TableHead>
                    <TableHead>Package</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgTimeline.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        <div>{format(new Date(r.created_at), "yyyy-MM-dd HH:mm")}</div>
                        <div className="text-muted-foreground">
                          {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                        </div>
                      </TableCell>
                      {selectedOrg === "all" && (
                        <TableCell className="text-sm">{r.org_name}</TableCell>
                      )}
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {r.source}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.package_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {NUM.format(r.credits)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {r.amount_zar > 0 ? ZAR.format(r.amount_zar) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] max-w-[180px] truncate">
                        {r.payment_reference ?? r.request_id ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone?: "success";
}) {
  const valueClass = tone === "success"
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-foreground";
  return (
    <div className="border border-border rounded-sm p-3 bg-card">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={`text-2xl font-semibold mt-1 ${valueClass}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function RevenueChart({
  series,
  granularity,
}: {
  series: { entries: [string, { revenue: number; credits: number; count: number }][]; max: number };
  granularity: "day" | "month";
}) {
  const { entries, max } = series;
  if (entries.length === 0) return null;

  // Simple grid bar chart — no chart library, fully themed.
  return (
    <div className="border border-border rounded-sm p-4 bg-card">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {granularity === "day" ? "Daily revenue" : "Monthly revenue"}
        </div>
        <div className="text-[11px] text-muted-foreground font-mono">
          peak {ZAR.format(max)}
        </div>
      </div>
      <div className="flex items-end gap-1 h-40 overflow-x-auto">
        {entries.map(([key, v]) => {
          const h = max > 0 ? Math.max(2, Math.round((v.revenue / max) * 100)) : 2;
          return (
            <div
              key={key}
              className="flex flex-col items-center justify-end shrink-0 group"
              style={{ width: granularity === "day" ? 14 : 28 }}
              title={`${key} · ${ZAR.format(v.revenue)} · ${v.count} purchases`}
            >
              <div
                className="w-full bg-emerald-600/80 hover:bg-emerald-600 transition-colors rounded-t-sm"
                style={{ height: `${h}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-2 text-[10px] font-mono text-muted-foreground">
        <span>{entries[0][0]}</span>
        <span>{entries[entries.length - 1][0]}</span>
      </div>
    </div>
  );
}
