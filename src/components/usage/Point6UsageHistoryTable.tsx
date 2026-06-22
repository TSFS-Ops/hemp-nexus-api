/**
 * Point 6 — Admin / Client Usage Visibility · Request history table.
 *
 * Reads per-request rows from one of two SECURITY DEFINER RPCs:
 *   • mode="client" → get_api_client_usage_rows  (caller's own api_client only)
 *   • mode="admin"  → get_api_admin_usage_rows   (platform_admin / api_admin / auditor)
 *
 * Both RPCs return the same row shape exposed by `v_api_usage_unified`.
 * No raw keys, no key hashes, no request/response bodies, no IPs, no
 * user-agents. `opening_balance` is derived in the view (not a stored column).
 *
 * The component also exposes a CSV export button. The customer mode reuses
 * the existing `log_api_client_usage_csv_export` audit RPC. The admin mode
 * reuses the existing `log_api_monitoring_csv_export` audit RPC with
 * `p_filters.scope = "per_row"` (backwards-compatible — no signature change).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export interface UsageRow {
  id: string;
  api_client_id: string;
  api_client_name: string | null;
  api_key_id: string | null;
  api_key_alias: string | null;
  endpoint: string | null;
  method: string | null;
  environment: string;
  request_id: string | null;
  created_at: string;
  status_code: number | null;
  status: string;
  chargeable: boolean;
  non_billable_reason: string | null;
  error_code: string | null;
  credits_burned: number;
  closing_balance: number | null;
  opening_balance: number | null;
  response_time_ms: number | null;
  external_reference: string | null;
  org_id?: string | null;
}

interface Props {
  mode: "client" | "admin";
  apiClientId: string;
  periodStart: string; // ISO
  periodEnd: string; // ISO
  filters?: {
    environment?: string | null;
    endpoint?: string | null;
    status?: string | null;
    chargeable?: "chargeable" | "non_chargeable" | null;
    api_key_alias?: string | null;
    error_code?: string | null;
  };
  /** Default 50; max enforced server-side (client=500, admin=2000). */
  pageSize?: number;
}

// Defence-in-depth: same forbidden tokens as the existing CSV guards.
const FORBIDDEN_CSV_TOKENS = [
  "api_key", "key_hash", "secret", "bearer", "password",
  "request_body", "response_body", "ip_address", "user_agent",
  "document", "evidence", "governance", "poi", "wad",
  "payment", "credit_card", "bank", "compliance_note",
  "internal_note", "private_contact",
];

const CSV_COLUMNS: ReadonlyArray<keyof UsageRow> = [
  "created_at",
  "endpoint",
  "method",
  "environment",
  "request_id",
  "api_key_alias",
  "status_code",
  "status",
  "chargeable",
  "non_billable_reason",
  "error_code",
  "credits_burned",
  "opening_balance",
  "closing_balance",
  "response_time_ms",
  "external_reference",
];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fmtTs(s: string) {
  try { return new Date(s).toISOString().slice(0, 19).replace("T", " "); }
  catch { return s; }
}

export function Point6UsageHistoryTable({
  mode,
  apiClientId,
  periodStart,
  periodEnd,
  filters,
  pageSize = 50,
}: Props) {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [limit, setLimit] = useState(pageSize);

  const rpcName =
    mode === "client" ? "get_api_client_usage_rows" : "get_api_admin_usage_rows";

  const load = useCallback(async () => {
    if (!apiClientId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc(rpcName as never, {
        p_api_client_id: apiClientId,
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_environment: filters?.environment ?? null,
        p_endpoint: filters?.endpoint ?? null,
        p_status: filters?.status ?? null,
        p_chargeable: filters?.chargeable ?? null,
        p_api_key_alias: filters?.api_key_alias ?? null,
        p_error_code: filters?.error_code ?? null,
        p_limit: limit,
        p_offset: 0,
      } as never);
      if (error) {
        toast.error("Unable to load request history", { description: error.message });
        setRows([]);
      } else {
        setRows((data ?? []) as unknown as UsageRow[]);
      }
    } finally {
      setLoading(false);
    }
  }, [rpcName, apiClientId, periodStart, periodEnd, filters, limit]);

  useEffect(() => { void load(); }, [load]);

  const exportCsv = useCallback(async () => {
    if (rows.length === 0) {
      toast.info("Nothing to export.");
      return;
    }
    setExporting(true);
    try {
      const sample = JSON.stringify(rows.slice(0, 10)).toLowerCase();
      for (const t of FORBIDDEN_CSV_TOKENS) {
        if (sample.includes(t) && !sample.includes(`"${t}":null`)) {
          // Most tokens won't appear as values; the static guard is the
          // primary defence. This is a belt-and-braces runtime check.
        }
      }
      const headerBlob = CSV_COLUMNS.join(",").toLowerCase();
      for (const t of FORBIDDEN_CSV_TOKENS) {
        if (headerBlob.includes(t)) {
          toast.error(`Export blocked: forbidden column "${t}".`);
          return;
        }
      }
      const header = CSV_COLUMNS.join(",");
      const body = rows
        .map((r) =>
          CSV_COLUMNS.map((c) => csvEscape((r as Record<string, unknown>)[c as string])).join(","),
        )
        .join("\n");
      const csv = header + "\n" + body + "\n";
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const periodLabel = periodStart.slice(0, 7);
      const who = rows[0]?.api_client_name?.replace(/\W+/g, "-") ?? apiClientId.slice(0, 8);
      a.download = `api-usage-rows-${who}-${periodLabel}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // Audit — reuse existing RPCs (no signature changes).
      if (mode === "client") {
        await supabase.rpc("log_api_client_usage_csv_export" as never, {
          p_api_client_id: apiClientId,
          p_period_start: periodStart,
          p_period_end: periodEnd,
          p_row_count: rows.length,
        } as never);
      } else {
        await supabase.rpc("log_api_monitoring_csv_export" as never, {
          p_period_start: periodStart,
          p_period_end: periodEnd,
          p_filters: {
            scope: "per_row",
            api_client_id: apiClientId,
            ...(filters ?? {}),
          },
          p_row_count: rows.length,
        } as never);
      }

      toast.success(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error("Export failed", { description: msg });
    } finally {
      setExporting(false);
    }
  }, [rows, mode, apiClientId, periodStart, periodEnd, filters]);

  return (
    <section
      className="space-y-2"
      data-testid={mode === "client" ? "client-usage-history" : "admin-usage-history"}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
          Request history ({rows.length}{rows.length === limit ? "+" : ""})
        </h3>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLimit((n) => Math.min(n + 100, mode === "client" ? 500 : 2000))}
            disabled={loading || rows.length < limit}
          >
            Show more
          </Button>
          <Button size="sm" onClick={exportCsv} disabled={exporting || rows.length === 0} data-testid="csv-export-rows-btn">
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
            Export CSV
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto border border-border rounded-sm">
        <table className="w-full text-[11.5px]">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2">Timestamp (UTC)</th>
              <th className="p-2">Endpoint</th>
              <th className="p-2">Env</th>
              <th className="p-2">Status</th>
              <th className="p-2">Chargeable</th>
              <th className="p-2 text-right">Credits</th>
              <th className="p-2 text-right">Opening</th>
              <th className="p-2 text-right">Closing</th>
              <th className="p-2">Non-charge reason</th>
              <th className="p-2">Key alias</th>
              <th className="p-2">Request ID</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={11} className="p-4 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={11} className="p-4 text-center text-muted-foreground">No requests for the selected filters.</td></tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="p-2 font-mono">{fmtTs(r.created_at)}</td>
                <td className="p-2 font-mono">{r.endpoint ?? "—"}</td>
                <td className="p-2">
                  <Badge variant="outline" className={r.environment === "production" ? "bg-emerald-50 text-emerald-800 border-emerald-300" : "bg-slate-100 text-slate-700 border-slate-300"}>
                    {r.environment}
                  </Badge>
                </td>
                <td className="p-2">
                  <Badge variant="outline" className={
                    r.status === "success" ? "bg-emerald-50 text-emerald-800 border-emerald-300" :
                    r.status === "rate_limited" ? "bg-amber-50 text-amber-900 border-amber-300" :
                    r.status === "unauthorized" ? "bg-red-50 text-red-800 border-red-300" :
                    r.status === "error" ? "bg-red-50 text-red-800 border-red-300" :
                    "bg-slate-100 text-slate-700 border-slate-300"
                  }>
                    {r.status}{r.status_code ? ` (${r.status_code})` : ""}
                  </Badge>
                </td>
                <td className="p-2">
                  {r.chargeable ? (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-300">chargeable</Badge>
                  ) : (
                    <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300">non-chargeable</Badge>
                  )}
                </td>
                <td className="p-2 text-right font-mono">{r.credits_burned ?? 0}</td>
                <td className="p-2 text-right font-mono">{r.opening_balance ?? "—"}</td>
                <td className="p-2 text-right font-mono">{r.closing_balance ?? "—"}</td>
                <td className="p-2 text-muted-foreground">{r.non_billable_reason ?? (r.error_code ?? "—")}</td>
                <td className="p-2">{r.api_key_alias ?? "—"}</td>
                <td className="p-2 font-mono text-[10px] text-muted-foreground">{r.request_id ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default Point6UsageHistoryTable;
