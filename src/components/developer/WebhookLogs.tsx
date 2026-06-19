import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";

interface ApiRequestLog {
  id: string;
  endpoint: string;
  method: string;
  status_code: number;
  response_time_ms: number;
  created_at: string;
  ip_address: string | null;
  request_id: string | null;
  error_message: string | null;
  environment: "sandbox" | "production" | null;
}

interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

type Tab = "requests" | "audit";

function statusColor(code: number): string {
  if (code >= 200 && code < 300) return "text-green-400 border-green-500/40";
  if (code >= 300 && code < 400) return "text-blue-400 border-blue-500/40";
  if (code >= 400 && code < 500) return "text-amber-400 border-amber-500/40";
  return "text-rose-400 border-rose-500/40";
}

function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "text-blue-400";
    case "POST":
      return "text-green-400";
    case "PATCH":
    case "PUT":
      return "text-amber-400";
    case "DELETE":
      return "text-rose-400";
    default:
      return "text-slate-400";
  }
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 border-dashed px-6 py-12 text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">
        ↳ no signal
      </div>
      <p className="font-mono text-[12px] text-slate-400">{label}</p>
    </div>
  );
}

function RequestsTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: ApiRequestLog[];
  selectedId?: string;
  onSelect: (r: ApiRequestLog) => void;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-sm overflow-hidden">
      <div className="grid grid-cols-[110px_60px_1fr_70px_70px] gap-3 px-4 py-2.5 border-b border-slate-800 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400 bg-black/40">
        <div>Time</div>
        <div>Method</div>
        <div>Endpoint</div>
        <div className="text-right">Status</div>
        <div className="text-right">Latency</div>
      </div>
      <div className="divide-y divide-slate-800/70 max-h-[480px] overflow-y-auto">
        {rows.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelect(r)}
            className={[
              "w-full grid grid-cols-[110px_60px_1fr_70px_70px] gap-3 px-4 py-3 font-mono text-[12px] text-left transition-colors",
              selectedId === r.id ? "bg-slate-800/60" : "hover:bg-slate-800/30",
            ].join(" ")}
          >
            <div className="text-slate-400 truncate">
              {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
            </div>
            <div className={methodColor(r.method)}>{r.method}</div>
            <div className="text-slate-100 truncate">{r.endpoint}</div>
            <div className="text-right">
              <span className={`text-[10px] uppercase tracking-[0.16em] px-1.5 py-0.5 border rounded-sm ${statusColor(r.status_code)}`}>
                {r.status_code}
              </span>
            </div>
            <div className="text-right text-slate-400">{r.response_time_ms}ms</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function AuditTable({ rows }: { rows: AuditLog[] }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-sm overflow-hidden">
      <div className="grid grid-cols-[140px_180px_1fr] gap-3 px-4 py-2.5 border-b border-slate-800 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400 bg-black/40">
        <div>Time</div>
        <div>Action</div>
        <div>Entity</div>
      </div>
      <div className="divide-y divide-slate-800/70 max-h-[480px] overflow-y-auto">
        {rows.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[140px_180px_1fr] gap-3 px-4 py-3 font-mono text-[12px]"
          >
            <div className="text-slate-400 truncate">
              {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
            </div>
            <div className="text-amber-300 truncate">{r.action}</div>
            <div className="text-slate-100 truncate">
              <span className="text-slate-500">{r.entity_type}</span>
              {r.entity_id && <> · <span className="text-slate-300">{r.entity_id.slice(0, 12)}…</span></>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RequestInspector({ row }: { row: ApiRequestLog | null }) {
  if (!row) {
    return (
      <aside>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 mb-3">
          §02 / Inspector
        </div>
        <div className="bg-slate-900 border border-slate-800 border-dashed rounded-sm p-6">
          <p className="font-mono text-[11px] text-slate-500">Select a request to inspect.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside>
      <div className="flex items-end justify-between mb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
          §02 / Inspector
        </div>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-sm">
        <div className="px-4 py-3 border-b border-slate-800 space-y-1.5">
          <div className="flex justify-between font-mono text-[11px]">
            <span className="text-slate-400">request_id</span>
            <span className="text-slate-100 truncate ml-2">{row.request_id || row.id.slice(0, 12)}</span>
          </div>
          <div className="flex justify-between font-mono text-[11px]">
            <span className="text-slate-400">endpoint</span>
            <span className="text-slate-100 truncate ml-2">{row.endpoint}</span>
          </div>
          <div className="flex justify-between font-mono text-[11px]">
            <span className="text-slate-400">method</span>
            <span className={methodColor(row.method)}>{row.method}</span>
          </div>
          <div className="flex justify-between font-mono text-[11px]">
            <span className="text-slate-400">status</span>
            <span className={statusColor(row.status_code).split(" ")[0]}>{row.status_code}</span>
          </div>
          <div className="flex justify-between font-mono text-[11px]">
            <span className="text-slate-400">latency</span>
            <span className="text-slate-100">{row.response_time_ms}ms</span>
          </div>
          <div className="flex justify-between font-mono text-[11px]">
            <span className="text-slate-400">ip</span>
            <span className="text-slate-100 truncate ml-2">{row.ip_address || "-"}</span>
          </div>
        </div>
        {row.error_message && (
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-rose-400 mb-1">
              Error
            </div>
            <p className="font-mono text-[11px] text-rose-300 break-words">{row.error_message}</p>
          </div>
        )}
        <pre className="bg-black p-4 font-mono text-[11px] leading-relaxed text-green-400 overflow-x-auto rounded-b-sm">
{`{
  "request_id": "${row.request_id || row.id}",
  "endpoint":   "${row.endpoint}",
  "method":     "${row.method}",
  "status":     ${row.status_code},
  "latency_ms": ${row.response_time_ms},
  "timestamp":  "${row.created_at}"
}`}
        </pre>
      </div>
    </aside>
  );
}

export default function WebhookLogs() {
  const REQ_LIMIT = 100;
  const AUDIT_LIMIT = 100;
  const [tab, setTab] = useState<Tab>("requests");
  const [selected, setSelected] = useState<ApiRequestLog | null>(null);
  const [envFilter, setEnvFilter] = useState<"all" | "sandbox" | "production">("all");

  const requests = useQuery({
    queryKey: ["developer-api-request-logs", envFilter],
    queryFn: async () => {
      let q = supabase
        .from("api_request_logs")
        .select(
          "id, endpoint, method, status_code, response_time_ms, created_at, ip_address, request_id, error_message, environment",
          { count: "exact" },
        )
        .order("created_at", { ascending: false })
        .limit(REQ_LIMIT);
      if (envFilter !== "all") q = q.eq("environment", envFilter);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data || []) as ApiRequestLog[], totalCount: count ?? data?.length ?? 0 };
    },
    enabled: tab === "requests",
  });

  const audit = useQuery({
    queryKey: ["developer-audit-logs"],
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from("audit_logs")
        .select("id, action, entity_type, entity_id, created_at, metadata", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(AUDIT_LIMIT);
      if (error) throw error;
      return { rows: (data || []) as AuditLog[], totalCount: count ?? data?.length ?? 0 };
    },
    enabled: tab === "audit",
  });

  const reqRows = requests.data?.rows || [];
  const auditRows = audit.data?.rows || [];
  const reqTotal = requests.data?.totalCount ?? 0;
  const auditTotal = audit.data?.totalCount ?? 0;

  // Auto-select first row when data loads
  useEffect(() => {
    if (tab === "requests" && reqRows.length > 0 && !selected) {
      setSelected(reqRows[0]);
    }
  }, [tab, reqRows, selected]);

  const counts = {
    success: reqRows.filter((r) => r.status_code >= 200 && r.status_code < 300).length,
    client: reqRows.filter((r) => r.status_code >= 400 && r.status_code < 500).length,
    server: reqRows.filter((r) => r.status_code >= 500).length,
  };

  return (
    <div>
      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-slate-800">
        <button
          onClick={() => setTab("requests")}
          className={[
            "font-mono text-[11px] uppercase tracking-[0.18em] px-4 py-2.5 border-b-2 -mb-px transition-colors",
            tab === "requests"
              ? "text-green-400 border-green-500"
              : "text-slate-400 border-transparent hover:text-slate-100",
          ].join(" ")}
        >
          API Requests
        </button>
        <button
          onClick={() => setTab("audit")}
          className={[
            "font-mono text-[11px] uppercase tracking-[0.18em] px-4 py-2.5 border-b-2 -mb-px transition-colors",
            tab === "audit"
              ? "text-green-400 border-green-500"
              : "text-slate-400 border-transparent hover:text-slate-100",
          ].join(" ")}
        >
          Audit Events
        </button>
      </div>

      {tab === "requests" && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_440px] gap-6">
          <div>
            <div className="flex items-end justify-between mb-5">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
                  §01 / Recent
                </div>
                <h2 className="mt-1 text-lg text-slate-100 tracking-tight">API Request Stream</h2>
              </div>
              {!requests.isLoading && reqRows.length > 0 && (
                <div className="font-mono text-[11px] text-slate-400">
                  <span className="text-green-400">●</span> {counts.success} ok &nbsp;
                  <span className="text-amber-400">●</span> {counts.client} 4xx &nbsp;
                  <span className="text-rose-400">●</span> {counts.server} 5xx
                </div>
              )}
            </div>

            {requests.isLoading && (
              <div className="bg-slate-900 border border-slate-800 px-6 py-8 text-center font-mono text-[12px] text-slate-400">
                Loading requests…
              </div>
            )}

            {requests.error && (
              <div className="bg-rose-950/40 border border-rose-500/40 px-6 py-4 font-mono text-[12px] text-rose-300">
                Failed to load: {(requests.error as Error).message}
              </div>
            )}

            {!requests.isLoading && !requests.error && reqRows.length === 0 && (
              <EmptyState label="No API activity detected. Make a request to see it here." />
            )}

            {!requests.isLoading && reqRows.length > 0 && (
              <>
                {reqTotal > REQ_LIMIT && (
                  <div className="mb-3 font-mono text-[11px] text-amber-300">
                    Showing {REQ_LIMIT} of {reqTotal.toLocaleString()} requests · refine with filters
                  </div>
                )}
                <RequestsTable rows={reqRows} selectedId={selected?.id} onSelect={setSelected} />
              </>
            )}
          </div>

          <RequestInspector row={selected} />
        </div>
      )}

      {tab === "audit" && (
        <div>
          <div className="flex items-end justify-between mb-5">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
                §01 / Audit Trail
              </div>
              <h2 className="mt-1 text-lg text-slate-100 tracking-tight">Organisation Audit Events</h2>
            </div>
          </div>

          {audit.isLoading && (
            <div className="bg-slate-900 border border-slate-800 px-6 py-8 text-center font-mono text-[12px] text-slate-400">
              Loading audit trail…
            </div>
          )}

          {audit.error && (
            <div className="bg-rose-950/40 border border-rose-500/40 px-6 py-4 font-mono text-[12px] text-rose-300">
              Failed to load: {(audit.error as Error).message}
            </div>
          )}

          {!audit.isLoading && !audit.error && auditRows.length === 0 && (
            <EmptyState label="No audit events recorded yet for this organisation." />
          )}

          {!audit.isLoading && auditRows.length > 0 && (
            <>
              {auditTotal > AUDIT_LIMIT && (
                <div className="mb-3 font-mono text-[11px] text-amber-300">
                  Showing {AUDIT_LIMIT} of {auditTotal.toLocaleString()} audit events
                </div>
              )}
              <AuditTable rows={auditRows} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
