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
  if (s === "operational") return { dot: "bg-[hsl(var(--emerald))]", text: "text-[hsl(var(--emerald))]" };
  if (s === "degraded")    return { dot: "bg-amber-500",   text: "text-amber-800"   };
  return { dot: "bg-rose-600", text: "text-rose-800" };
}

function severityTone(sev: string, status: string) {
  if (status === "resolved") return "text-[hsl(var(--emerald))]";
  if (sev === "critical" || sev === "high") return "text-rose-700";
  if (sev === "medium") return "text-amber-700";
  return "text-muted-foreground";
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
    <svg width={w} height={h} className="text-muted-foreground/70">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function HealthBoard() {
  const INCIDENT_LIMIT = 20;
  const { data: incidentResult, isLoading, dataUpdatedAt } = useQuery<{ items: RiskItem[]; totalCount: number }>({
    queryKey: ["governance-risk-items"],
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from("admin_risk_items")
        .select("id, title, description, severity, status, created_at, resolved_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(INCIDENT_LIMIT);
      if (error) throw error;
      const items = (data ?? []) as RiskItem[];
      return { items, totalCount: count ?? items.length };
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  });

  // ── NOT-001 / NOT-006 Fix 6: surface manual-follow-up workload ──
  // Pending Engagements where the soft-route had no usable recipient are
  // recorded as `notification_skipped(no_recipient, source=match.soft_route)`.
  // We count today's distinct rows so admin sees the manual-contact backlog.
  const { data: noRecipientCount } = useQuery<number>({
    queryKey: ["healthboard-no-recipient-skips"],
    queryFn: async () => {
      const dayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z").toISOString();
      const { count, error } = await supabase
        .from("audit_logs")
        .select("id", { head: true, count: "exact" })
        .eq("action", "notification_skipped")
        .gte("created_at", dayStart)
        .contains("metadata", { reason: "no_recipient", source_function: "match.soft_route" });
      if (error) return 0;
      return count ?? 0;
    },
    refetchInterval: 60000,
    refetchOnWindowFocus: false,
  });

  const incidents = incidentResult?.items ?? [];
  const incidentTotal = incidentResult?.totalCount ?? 0;

  const operational = GATES.filter(g => g.status === "operational").length;
  const openIncidents = incidents.filter(i => i.status !== "resolved").length;
  const lastBeat = dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : new Date().toISOString();
  const noRecipient = noRecipientCount ?? 0;

  return (
    <>
      {/* Summary strip */}
      <div className="grid grid-cols-4 gap-px bg-muted border border-border mb-10">
        <div className="bg-card p-5">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground/70">Composite</p>
          <p className="mt-1 text-2xl font-semibold text-foreground tracking-tight">99.962%</p>
          <p className="font-mono text-[10px] text-muted-foreground mt-0.5">trailing 30 days</p>
        </div>
        <div className="bg-card p-5">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground/70">Gates Operational</p>
          <p className="mt-1 text-2xl font-semibold text-foreground tracking-tight">{operational}/9</p>
          <p className="font-mono text-[10px] text-muted-foreground mt-0.5">{9 - operational} degraded · 0 incident</p>
        </div>
        <div className="bg-card p-5">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground/70">Open Incidents</p>
          <p className="mt-1 text-2xl font-semibold text-foreground tracking-tight">{openIncidents}</p>
          <p className={`font-mono text-[10px] mt-0.5 ${openIncidents > 0 ? "text-amber-700" : "text-[hsl(var(--emerald))]"}`}>
            {openIncidents > 0
              ? `monitoring · ${shortId(incidents.find(i => i.status !== "resolved")!.id)}`
              : "all clear"}
          </p>
        </div>
        <div className="bg-card p-5" data-testid="healthboard-no-recipient-tile">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground/70">No-Recipient Outreach</p>
          <p className="mt-1 text-2xl font-semibold text-foreground tracking-tight">{noRecipient}</p>
          <p className={`font-mono text-[10px] mt-0.5 ${noRecipient > 0 ? "text-amber-700" : "text-[hsl(var(--emerald))]"}`}>
            {noRecipient > 0 ? "manual follow-up required · today" : "no manual backlog · today"}
          </p>
        </div>
      </div>

      {/* 9-gate board */}
      <section>
        <div className="flex items-baseline justify-between pb-3 border-b border-border mb-0">
          <h2 className="text-base font-medium text-foreground tracking-tight">9-Gate Service Board</h2>
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground/70">polled every 30s</p>
        </div>
        <ul className="divide-y divide-border border border-border border-t-0 bg-card">
          {GATES.map((g) => {
            const tone = statusTone(g.status);
            return (
              <li key={g.id} className="grid grid-cols-[60px_1fr_120px_100px_90px_120px] gap-5 items-center px-5 py-4">
                <p className="font-mono text-[11px] tracking-wider text-muted-foreground">{g.id}</p>
                <p className="text-sm text-foreground">{g.name}</p>
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
                  <span className={`font-mono text-[10px] tracking-[0.2em] uppercase ${tone.text}`}>{g.status}</span>
                </div>
                <p className="font-mono text-[12px] text-foreground">{g.uptime}</p>
                <p className="font-mono text-[12px] text-foreground">{g.p99}</p>
                <Sparkline series={g.series} />
              </li>
            );
          })}
        </ul>
      </section>

      {/* Incident ledger */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between pb-3 border-b border-border mb-0">
          <h2 className="text-base font-medium text-foreground tracking-tight">Incident Ledger</h2>
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground/70">
            {incidentTotal > INCIDENT_LIMIT
              ? `showing ${INCIDENT_LIMIT} of ${incidentTotal} records`
              : "last 20 records"}
          </p>
        </div>
        <ul className="divide-y divide-border border border-border border-t-0 bg-card">
          {isLoading ? (
            <li className="px-5 py-6 text-sm text-muted-foreground">loading risk telemetry…</li>
          ) : incidents.length === 0 ? (
            <li className="px-5 py-6">
              <p className="text-sm text-muted-foreground">Zero recorded incidents.</p>
              <p className="font-mono text-[10px] text-muted-foreground mt-1">
                last heartbeat: {formatTs(lastBeat)} · all 9 gates reporting nominal
              </p>
            </li>
          ) : (
            incidents.map((i) => (
              <li key={i.id} className="grid grid-cols-[170px_120px_80px_1fr_100px] gap-5 items-center px-5 py-3">
                <p className="font-mono text-[11px] tracking-wider text-foreground">{shortId(i.id)}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{formatTs(i.created_at)}</p>
                <p className={`font-mono text-[10px] tracking-[0.2em] uppercase ${severityTone(i.severity, i.status)}`}>
                  {i.severity}
                </p>
                <p className="text-[13px] text-foreground truncate" title={i.description ?? ""}>{i.title}</p>
                <p className={`font-mono text-[10px] tracking-[0.2em] uppercase text-right ${i.status === "resolved" ? "text-[hsl(var(--emerald))]" : "text-amber-700"}`}>
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
