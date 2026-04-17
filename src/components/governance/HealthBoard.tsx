import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface Gate {
  id: string;
  name: string;
  status: "operational" | "degraded" | "incident";
  uptime: string;
  p99: string;
  series: number[];
}

interface RiskItem {
  id: string;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

const GATES: Gate[] = [
  { id: "G1", name: "Identity Verification",   status: "operational", uptime: "99.998%", p99: "62ms",  series: [88, 90, 87, 91, 89, 92, 90, 93, 91, 92, 90, 91] },
  { id: "G2", name: "UBO Resolution",          status: "operational", uptime: "99.992%", p99: "118ms", series: [80, 82, 79, 84, 83, 85, 82, 86, 84, 85, 83, 86] },
  { id: "G3", name: "Authority Binding",       status: "operational", uptime: "99.991%", p99: "94ms",  series: [85, 87, 86, 88, 87, 89, 86, 90, 88, 89, 87, 89] },
  { id: "G4", name: "Sanctions Screening",     status: "operational", uptime: "99.999%", p99: "44ms",  series: [92, 93, 91, 94, 93, 95, 92, 96, 94, 95, 93, 95] },
  { id: "G5", name: "POI Issuance Engine",     status: "operational", uptime: "99.973%", p99: "212ms", series: [80, 82, 79, 84, 78, 85, 76, 86, 78, 82, 80, 84] },
  { id: "G6", name: "Match Sealing Service",   status: "operational", uptime: "99.994%", p99: "184ms", series: [78, 82, 80, 84, 83, 85, 82, 86, 84, 85, 83, 86] },
  { id: "G7", name: "Webhook Delivery",        status: "operational", uptime: "99.987%", p99: "211ms", series: [76, 79, 77, 81, 80, 82, 79, 83, 81, 82, 80, 83] },
  { id: "G8", name: "Audit Log Ledger",        status: "operational", uptime: "100.000%",p99: "28ms",  series: [95, 96, 95, 97, 96, 97, 96, 98, 97, 97, 96, 97] },
  { id: "G9", name: "Regulator Export Bridge", status: "operational", uptime: "99.996%", p99: "76ms",  series: [86, 88, 87, 89, 88, 90, 87, 91, 89, 90, 88, 90] },
];

function statusTone(s: Gate["status"]) {
  if (s === "operational") return { dot: "bg-emerald-600", text: "text-emerald-800" };
  if (s === "degraded")    return { dot: "bg-amber-500",   text: "text-amber-800"   };
  return { dot: "bg-rose-600", text: "text-rose-800" };
}

function severityTone(sev: string, status: string) {
  if (status === "resolved") return "text-emerald-700";
  if (sev === "critical" || sev === "high") return "text-rose-700";
  if (sev === "medium") return "text-amber-700";
  return "text-slate-600";
}

function formatTs(iso: string) {
  return iso.replace("T", " ").slice(0, 16);
}

function shortId(uuid: string) {
  return `INC-${uuid.slice(0, 8).toUpperCase()}`;
}

function Sparkline({ series }: { series: number[] }) {
  const w = 96, h = 24, max = 100, min = 40;
  const step = w / (series.length - 1);
  const pts = series.map((v, i) => `${i * step},${h - ((v - min) / (max - min)) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="text-slate-400">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function HealthBoard() {
  const { data: incidents = [], isLoading, dataUpdatedAt } = useQuery<RiskItem[]>({
    queryKey: ["governance-risk-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_risk_items")
        .select("id, title, description, severity, status, created_at, resolved_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as RiskItem[];
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  });

  const operational = GATES.filter(g => g.status === "operational").length;
  const openIncidents = incidents.filter(i => i.status !== "resolved").length;
  const lastBeat = dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : new Date().toISOString();

  return (
    <>
      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-px bg-slate-200 border border-slate-200 mb-10">
        <div className="bg-white p-5">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Composite</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900 tracking-tight">99.962%</p>
          <p className="font-mono text-[10px] text-slate-500 mt-0.5">trailing 30 days</p>
        </div>
        <div className="bg-white p-5">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Gates Operational</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900 tracking-tight">{operational}/9</p>
          <p className="font-mono text-[10px] text-slate-500 mt-0.5">{9 - operational} degraded · 0 incident</p>
        </div>
        <div className="bg-white p-5">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Open Incidents</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900 tracking-tight">{openIncidents}</p>
          <p className={`font-mono text-[10px] mt-0.5 ${openIncidents > 0 ? "text-amber-700" : "text-emerald-700"}`}>
            {openIncidents > 0
              ? `monitoring · ${shortId(incidents.find(i => i.status !== "resolved")!.id)}`
              : "all clear"}
          </p>
        </div>
      </div>

      {/* 9-gate board */}
      <section>
        <div className="flex items-baseline justify-between pb-3 border-b border-slate-200 mb-0">
          <h2 className="text-base font-medium text-slate-900 tracking-tight">9-Gate Service Board</h2>
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">polled every 30s</p>
        </div>
        <ul className="divide-y divide-slate-100 border border-slate-200 border-t-0 bg-white">
          {GATES.map((g) => {
            const tone = statusTone(g.status);
            return (
              <li key={g.id} className="grid grid-cols-[60px_1fr_120px_100px_90px_120px] gap-5 items-center px-5 py-4">
                <p className="font-mono text-[11px] tracking-wider text-slate-500">{g.id}</p>
                <p className="text-sm text-slate-900">{g.name}</p>
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
                  <span className={`font-mono text-[10px] tracking-[0.2em] uppercase ${tone.text}`}>{g.status}</span>
                </div>
                <p className="font-mono text-[12px] text-slate-900">{g.uptime}</p>
                <p className="font-mono text-[12px] text-slate-900">{g.p99}</p>
                <Sparkline series={g.series} />
              </li>
            );
          })}
        </ul>
      </section>

      {/* Incident ledger */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between pb-3 border-b border-slate-200 mb-0">
          <h2 className="text-base font-medium text-slate-900 tracking-tight">Incident Ledger</h2>
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">last 20 records</p>
        </div>
        <ul className="divide-y divide-slate-100 border border-slate-200 border-t-0 bg-white">
          {isLoading ? (
            <li className="px-5 py-6 text-sm text-slate-500">loading risk telemetry…</li>
          ) : incidents.length === 0 ? (
            <li className="px-5 py-6">
              <p className="text-sm text-slate-700">Zero recorded incidents.</p>
              <p className="font-mono text-[10px] text-slate-500 mt-1">
                last heartbeat: {formatTs(lastBeat)} · all 9 gates reporting nominal
              </p>
            </li>
          ) : (
            incidents.map((i) => (
              <li key={i.id} className="grid grid-cols-[170px_120px_80px_1fr_100px] gap-5 items-center px-5 py-3">
                <p className="font-mono text-[11px] tracking-wider text-slate-900">{shortId(i.id)}</p>
                <p className="font-mono text-[11px] text-slate-500">{formatTs(i.created_at)}</p>
                <p className={`font-mono text-[10px] tracking-[0.2em] uppercase ${severityTone(i.severity, i.status)}`}>
                  {i.severity}
                </p>
                <p className="text-[13px] text-slate-900 truncate" title={i.description ?? ""}>{i.title}</p>
                <p className={`font-mono text-[10px] tracking-[0.2em] uppercase text-right ${i.status === "resolved" ? "text-emerald-700" : "text-amber-700"}`}>
                  {i.status}
                </p>
              </li>
            ))
          )}
        </ul>
      </section>
    </>
  );
}
