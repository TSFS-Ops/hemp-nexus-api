/**
 * AdminRevenuePanel
 * ─────────────────────────────────────────────────────────────────────
 * HQ → Revenue dashboard.
 *
 * SOURCE OF TRUTH (USD-native, cutover 2026-05-01)
 * ────────────────────────────────────────────────
 * Revenue is sourced primarily from `public.audit_logs` rows where
 * `action = 'credits.purchased'`. This is the canonical, server-authored
 * settlement event written by the Paystack webhook handler.
 *
 * As of the 2026-05-01 cutover, Paystack charges customers natively in
 * USD. The dashboard reads `metadata.price_usd` as the canonical
 * settlement amount and renders all totals in USD. Pre-cutover rows
 * that only carry the legacy `price_zar` field are still surfaced (so
 * historical totals remain reconcilable) but flagged as legacy ZAR in
 * the per-org timeline.
 *
 * As a safety-net we also pull `token_ledger` rows with
 * `action_type = 'credit_purchase'` and merge by `payment_reference`,
 * so any manual reconciliation (which writes to the ledger but not to
 * audit_logs) still surfaces. Audit-log rows always win on conflict.
 *
 * PAPER-CUT VISIBILITY
 * ────────────────────
 * `credits.purchase_initiated` rows without a matching `credits.purchased`
 * are surfaced in a dedicated "Pending settlement" panel so any future
 * webhook silently failing to write the settlement row is immediately
 * visible to the operations team.
 *
 * RLS
 * ───
 * `audit_logs` and `token_ledger` both restrict reads to platform_admin /
 * auditor; the panel sits behind /hq's admin guard and returns nothing
 * for non-admin sessions.
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
import { TruncationBanner } from "@/components/ui/truncation-banner";
import {
  Loader2,
  RefreshCw,
  TrendingUp,
  Coins,
  Users,
  Receipt,
  Download,
  AlertTriangle,
} from "lucide-react";
import { format, formatDistanceToNow, subDays } from "date-fns";
import { auditedDownloadCSVRaw } from "@/lib/download-utils";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PurchaseEnriched {
  id: string;                    // synthetic: prefer audit_log id, fallback ledger id
  org_id: string | null;
  org_name: string;
  credits: number;               // positive integer of credits granted
  amount_usd: number;            // gross revenue in USD (canonical, post-cutover)
  // Settlement currency for this row: "USD" (post-cutover, native) or
  // "ZAR" (pre-cutover legacy). Drives the badge in the per-org timeline.
  settlement_currency: "USD" | "ZAR";
  // Pre-cutover ZAR settlement preserved verbatim for historical
  // reconciliation. Null for native-USD rows.
  legacy_amount_zar: number | null;
  legacy_fx_rate: number | null;
  package_id: string | null;
  payment_reference: string | null;
  created_at: string;
  source: "audit_log" | "ledger" | "ledger:manual";
  backfilled: boolean;
  // raw rows for the detail dialog / CSV export
  audit_log_id: string | null;
  ledger_id: string | null;
  request_id: string | null;
  raw_metadata: Record<string, any> | null;
}

interface PendingSettlement {
  id: string;
  reference: string;
  actor_user_id: string | null;
  org_id: string | null;
  org_name: string;
  amount_usd: number;
  credits: number;
  package_id: string | null;
  initiated_at: string;
}

interface AuditLogRow {
  id: string;
  org_id: string | null;
  entity_id: string | null;
  actor_user_id: string | null;
  action: string;
  metadata: Record<string, any> | null;
  created_at: string;
}

interface LedgerRow {
  id: string;
  org_id: string | null;
  endpoint: string | null;
  action_type: string;
  tokens_burned: number;
  metadata: Record<string, any> | null;
  created_at: string;
  request_id: string | null;
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

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat("en-ZA");

function bucketKey(iso: string, granularity: "day" | "month"): string {
  const d = new Date(iso);
  if (granularity === "month") {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function num(x: unknown): number {
  if (typeof x === "number") return x;
  if (typeof x === "string") {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function str(x: unknown): string | null {
  return typeof x === "string" && x.length > 0 ? x : null;
}

function resolveOrgName(id: string | null, orgNameById: Map<string, string>): string {
  if (!id) return "—";
  return orgNameById.get(id) ?? id.slice(0, 8) + "…";
}

/**
 * Convert a `credits.purchased` audit log row into a normalised purchase.
 *
 * USD-native (post-cutover 2026-05-01): prefer `metadata.price_usd`.
 * Pre-cutover rows that only carry `price_zar` / `zar_amount_charged`
 * are surfaced with `settlement_currency: "ZAR"` so historical totals
 * remain reconcilable. We never invent a USD figure for legacy ZAR
 * rows — `amount_usd` is left at 0 in that case to avoid double-counting
 * against the new native-USD totals.
 */
function purchaseFromAuditLog(
  row: AuditLogRow,
  orgNameById: Map<string, string>,
): PurchaseEnriched | null {
  const meta = row.metadata ?? {};
  const price_usd = num(meta.price_usd);
  const legacy_zar = num(meta.zar_amount_charged) || num(meta.price_zar) || num(meta.legacy_price_zar);
  if (price_usd <= 0 && legacy_zar <= 0) return null;
  const credits = num(meta.credits_added) || num(meta.credits);
  const orgId = row.org_id ?? row.entity_id ?? null;
  const isNativeUsd = price_usd > 0 && (
    meta.currency === "USD" || meta.fx_basis === "native_usd" || legacy_zar === 0
  );
  return {
    id: `audit:${row.id}`,
    org_id: orgId,
    org_name: resolveOrgName(orgId, orgNameById),
    credits,
    amount_usd: isNativeUsd ? price_usd : 0,
    settlement_currency: isNativeUsd ? "USD" : "ZAR",
    legacy_amount_zar: legacy_zar > 0 ? legacy_zar : null,
    legacy_fx_rate: typeof meta.fx_rate === "number" ? meta.fx_rate : (typeof meta.legacy_fx_rate === "number" ? meta.legacy_fx_rate : null),
    package_id: str(meta.package_id),
    payment_reference: str(meta.payment_reference) ?? str(meta.reference),
    created_at: row.created_at,
    source: "audit_log",
    backfilled: meta.backfilled === true,
    audit_log_id: row.id,
    ledger_id: str(meta.source_ledger_id),
    request_id: null,
    raw_metadata: meta,
  };
}

/**
 * Convert a `credit_purchase` ledger row into a normalised purchase. Used as
 * a safety-net for manual reconciliations that bypass the webhook + audit
 * log path (e.g. endpoint = 'payment:paystack:manual').
 */
function purchaseFromLedger(
  row: LedgerRow,
  orgNameById: Map<string, string>,
): PurchaseEnriched | null {
  const meta = row.metadata ?? {};
  const price_usd = num(meta.price_usd);
  const legacy_zar = num(meta.zar_amount_charged) || num(meta.price_zar) || num(meta.legacy_price_zar);
  if (price_usd <= 0 && legacy_zar <= 0) return null;
  const credits = num(meta.credits) || Math.abs(row.tokens_burned || 0);
  const isManual = (row.endpoint ?? "").includes("manual");
  const isNativeUsd = price_usd > 0 && (
    meta.currency === "USD" || meta.fx_basis === "native_usd" || legacy_zar === 0
  );
  return {
    id: `ledger:${row.id}`,
    org_id: row.org_id,
    org_name: resolveOrgName(row.org_id, orgNameById),
    credits,
    amount_usd: isNativeUsd ? price_usd : 0,
    settlement_currency: isNativeUsd ? "USD" : "ZAR",
    legacy_amount_zar: legacy_zar > 0 ? legacy_zar : null,
    legacy_fx_rate: typeof meta.fx_rate === "number" ? meta.fx_rate : (typeof meta.legacy_fx_rate === "number" ? meta.legacy_fx_rate : null),
    package_id: str(meta.package_id),
    payment_reference: str(meta.payment_reference),
    created_at: row.created_at,
    source: isManual ? "ledger:manual" : "ledger",
    backfilled: false,
    audit_log_id: null,
    ledger_id: row.id,
    request_id: row.request_id,
    raw_metadata: meta,
  };
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
      // ── 1) Canonical settled revenue from audit_logs ─────────────────────
      let auditQ = supabase
        .from("audit_logs")
        .select("id, org_id, entity_id, actor_user_id, action, metadata, created_at")
        .eq("action", "credits.purchased")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (sinceIso) auditQ = auditQ.gte("created_at", sinceIso);
      const { data: auditRows, error: auditErr } = await auditQ;
      if (auditErr) throw auditErr;

      // ── 2) Safety-net: ledger rows tagged as credit_purchase (manual recon) ─
      let ledgerQ = supabase
        .from("token_ledger")
        .select("id, org_id, endpoint, action_type, tokens_burned, metadata, created_at, request_id")
        .eq("action_type", "credit_purchase")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (sinceIso) ledgerQ = ledgerQ.gte("created_at", sinceIso);
      const { data: ledgerRows, error: ledgerErr } = await ledgerQ;
      if (ledgerErr) throw ledgerErr;

      // ── 3) Initiations (for the paper-cut panel) ─────────────────────────
      let initQ = supabase
        .from("audit_logs")
        .select("id, org_id, entity_id, actor_user_id, action, metadata, created_at")
        .eq("action", "credits.purchase_initiated")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (sinceIso) initQ = initQ.gte("created_at", sinceIso);
      const { data: initRows, error: initErr } = await initQ;
      if (initErr) throw initErr;

      // ── 4) Resolve org names in one round-trip ───────────────────────────
      const orgIds = new Set<string>();
      for (const r of (auditRows ?? []) as AuditLogRow[]) {
        const id = r.org_id ?? r.entity_id;
        if (id) orgIds.add(id);
      }
      for (const r of (ledgerRows ?? []) as LedgerRow[]) {
        if (r.org_id) orgIds.add(r.org_id);
      }
      for (const r of (initRows ?? []) as AuditLogRow[]) {
        const id = r.org_id ?? r.entity_id;
        if (id) orgIds.add(id);
      }
      const orgNameById = new Map<string, string>();
      if (orgIds.size > 0) {
        const { data: orgs, error: orgErr } = await supabase
          .from("organizations")
          .select("id, name, legal_name, trading_name")
          .in("id", Array.from(orgIds));
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

      // ── 5) Normalise + dedup. Audit-log rows always win on payment_reference.
      const byRef = new Map<string, PurchaseEnriched>();
      const noRef: PurchaseEnriched[] = [];
      for (const r of (auditRows ?? []) as AuditLogRow[]) {
        const p = purchaseFromAuditLog(r, orgNameById);
        if (!p) continue;
        if (p.payment_reference) byRef.set(p.payment_reference, p);
        else noRef.push(p);
      }
      for (const r of (ledgerRows ?? []) as LedgerRow[]) {
        const p = purchaseFromLedger(r, orgNameById);
        if (!p) continue;
        if (p.payment_reference) {
          if (!byRef.has(p.payment_reference)) byRef.set(p.payment_reference, p);
          // else: audit_log row already counts this revenue, skip ledger duplicate.
        } else {
          noRef.push(p);
        }
      }
      const purchases = [...byRef.values(), ...noRef].sort(
        (a, b) => (a.created_at < b.created_at ? 1 : -1),
      );

      // ── 6) Pending settlements: initiated but no matching purchased row.
      const settledRefs = new Set(
        purchases.map((p) => p.payment_reference).filter((x): x is string => !!x),
      );
      const pending: PendingSettlement[] = [];
      for (const r of (initRows ?? []) as AuditLogRow[]) {
        const meta = r.metadata ?? {};
        const ref = str(meta.reference) ?? str(meta.payment_reference);
        if (!ref || settledRefs.has(ref)) continue;
        const orgId = r.org_id ?? r.entity_id ?? null;
        pending.push({
          id: r.id,
          reference: ref,
          actor_user_id: r.actor_user_id,
          org_id: orgId,
          org_name: resolveOrgName(orgId, orgNameById),
          amount_usd: num(meta.amount_usd) || num(meta.price_usd),
          credits: num(meta.credits),
          package_id: str(meta.package_id),
          initiated_at: r.created_at,
        });
      }

      return {
        rows: purchases,
        pending,
        auditCount: (auditRows ?? []).length,
        ledgerCount: (ledgerRows ?? []).length,
        initCount: (initRows ?? []).length,
      };
    },
    staleTime: 30_000,
  });

  const rows = data?.rows ?? [];
  const pending = data?.pending ?? [];

  // ─── Aggregations ─────────────────────────────────────────────────────────

  const totals = useMemo(() => {
    const out = {
      revenue: 0,
      credits: 0,
      purchases: rows.length,
      buyers: new Set<string>(),
      paid: 0,         // settled via Paystack webhook (audit_log row)
      manual: 0,       // manual reconciliation written direct to ledger
      backfilled: 0,   // reconstructed from evidence; flagged for auditors
    };
    for (const r of rows) {
      out.revenue += r.amount_usd;
      out.credits += r.credits;
      if (r.org_id) out.buyers.add(r.org_id);
      if (r.source === "ledger:manual") out.manual += 1;
      else out.paid += 1;
      if (r.backfilled) out.backfilled += 1;
    }
    return out;
  }, [rows]);

  const series = useMemo(() => {
    const byBucket = new Map<string, { revenue: number; credits: number; count: number }>();
    for (const r of rows) {
      const k = bucketKey(r.created_at, granularity);
      const cur = byBucket.get(k) ?? { revenue: 0, credits: 0, count: 0 };
      cur.revenue += r.amount_usd;
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
      cur.revenue += r.amount_usd;
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
      "amount_usd",
      "settlement_currency",
      "legacy_amount_zar",
      "legacy_fx_rate",
      "package_id",
      "payment_reference",
      "source",
      "backfilled",
      "audit_log_id",
      "ledger_id",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      const cells = [
        r.created_at,
        r.org_id ?? "",
        `"${(r.org_name ?? "").replace(/"/g, '""')}"`,
        String(r.credits),
        String(r.amount_usd),
        r.settlement_currency,
        r.legacy_amount_zar != null ? String(r.legacy_amount_zar) : "",
        r.legacy_fx_rate != null ? String(r.legacy_fx_rate) : "",
        r.package_id ?? "",
        r.payment_reference ?? "",
        r.source,
        r.backfilled ? "true" : "false",
        r.audit_log_id ?? "",
        r.ledger_id ?? "",
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
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>Revenue & sales</CardTitle>
              <CardDescription>
                Paid credit purchases recorded in the token ledger, joined to
                organisation names. Data is read-only and reflects real bank-cleared
                revenue (Paystack) plus any auditor-grade manual reconciliations.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              asChild
              className="shrink-0"
            >
              <a href="/hq/settings?sub=tokens">
                <Coins className="h-4 w-4 mr-2" />
                Issue manual credits
              </a>
            </Button>
          </div>
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

          {/* Truncation disclosure — three source queries each cap at 2000 rows.
              If any returned exactly 2000 rows the totals shown above understate
              true revenue and an admin must narrow the time window. */}
          {(data?.auditCount === 2000 || data?.ledgerCount === 2000 || data?.initCount === 2000) && (
            <TruncationBanner
              data={Array(2000).fill(null)}
              limit={2000}
            />
          )}

          {/* Totals strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat
              icon={TrendingUp}
              label="Revenue"
              value={USD.format(totals.revenue)}
              hint={`${totals.paid} paid · ${totals.manual} manual${totals.backfilled > 0 ? ` · ${totals.backfilled} backfilled` : ""}`}
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
                        {USD.format(b.revenue)}
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
                    <TableHead className="text-right">USD</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">Legacy ZAR</TableHead>
                    <TableHead className="text-right">Legacy FX</TableHead>
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
                        <Badge variant="secondary" className="font-mono text-[10px] w-fit">
                          {r.source === "audit_log" ? "audit_log" : r.source === "ledger:manual" ? "manual" : "ledger"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.package_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {NUM.format(r.credits)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {r.amount_usd > 0 ? USD.format(r.amount_usd) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={r.settlement_currency === "USD" ? "secondary" : "outline"}
                          className="font-mono text-[10px] w-fit"
                        >
                          {r.settlement_currency}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] text-muted-foreground">
                        {r.legacy_amount_zar != null ? ZAR.format(r.legacy_amount_zar) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] text-muted-foreground">
                        {r.legacy_fx_rate != null ? r.legacy_fx_rate.toFixed(4) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] max-w-[180px] truncate">
                        {r.payment_reference ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending settlement / paper-cuts */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
            <div>
              <CardTitle>Pending settlement</CardTitle>
              <CardDescription>
                Purchases where the user clicked pay (
                <span className="font-mono">credits.purchase_initiated</span>) but no
                matching settlement (<span className="font-mono">credits.purchased</span>)
                was ever recorded. Each row is either an abandoned checkout or a
                webhook paper-cut worth investigating against Paystack.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <EmptyState
              title="No pending settlements in this window"
              message="Every initiated purchase has a matching settlement record. Revenue is fully reconciled."
            />
          ) : (
            <div className="border border-border rounded-sm overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Initiated</TableHead>
                    <TableHead>Organisation</TableHead>
                    <TableHead>Package</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Paystack reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        <div>{format(new Date(p.initiated_at), "yyyy-MM-dd HH:mm")}</div>
                        <div className="text-muted-foreground">
                          {formatDistanceToNow(new Date(p.initiated_at), { addSuffix: true })}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{p.org_name}</TableCell>
                      <TableCell className="font-mono text-xs">{p.package_id ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">
                        {p.credits > 0 ? NUM.format(p.credits) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {p.amount_usd > 0 ? USD.format(p.amount_usd) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-[11px]">
                        {p.reference}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {pending.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              {pending.length} initiation{pending.length === 1 ? "" : "s"} without a
              recorded settlement. Cross-check against Paystack: if money cleared,
              backfill an audit log row with{" "}
              <span className="font-mono">action='credits.purchased'</span> +{" "}
              <span className="font-mono">metadata.backfilled = true</span>.
            </p>
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
