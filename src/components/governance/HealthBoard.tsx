interface Gate {
  id: string;
  name: string;
  status: "operational" | "degraded" | "incident";
  uptime: string;
  p99: string;
  series: number[];
}

const GATES: Gate[] = [
  { id: "G1", name: "Identity Verification",   status: "operational", uptime: "99.998%", p99: "62ms",  series: [88, 90, 87, 91, 89, 92, 90, 93, 91, 92, 90, 91] },
  { id: "G2", name: "UBO Resolution",          status: "operational", uptime: "99.992%", p99: "118ms", series: [80, 82, 79, 84, 83, 85, 82, 86, 84, 85, 83, 86] },
  { id: "G3", name: "Authority Binding",       status: "operational", uptime: "99.991%", p99: "94ms",  series: [85, 87, 86, 88, 87, 89, 86, 90, 88, 89, 87, 89] },
  { id: "G4", name: "Sanctions Screening",     status: "operational", uptime: "99.999%", p99: "44ms",  series: [92, 93, 91, 94, 93, 95, 92, 96, 94, 95, 93, 95] },
  { id: "G5", name: "POI Issuance Engine",     status: "degraded",    uptime: "99.873%", p99: "412ms", series: [70, 75, 68, 72, 65, 78, 60, 82, 55, 70, 58, 65] },
  { id: "G6", name: "Match Sealing Service",   status: "operational", uptime: "99.994%", p99: "184ms", series: [78, 82, 80, 84, 83, 85, 82, 86, 84, 85, 83, 86] },
  { id: "G7", name: "Webhook Delivery",        status: "operational", uptime: "99.987%", p99: "211ms", series: [76, 79, 77, 81, 80, 82, 79, 83, 81, 82, 80, 83] },
  { id: "G8", name: "Audit Log Ledger",        status: "operational", uptime: "100.000%",p99: "28ms",  series: [95, 96, 95, 97, 96, 97, 96, 98, 97, 97, 96, 97] },
  { id: "G9", name: "Regulator Export Bridge", status: "operational", uptime: "99.996%", p99: "76ms",  series: [86, 88, 87, 89, 88, 90, 87, 91, 89, 90, 88, 90] },
];

const INCIDENTS = [
  { id: "INC-2026-0007", at: "2026-04-17 11:42", gate: "G5",  severity: "minor", title: "POI issuance latency p99 > 400ms",     status: "monitoring" },
  { id: "INC-2026-0006", at: "2026-04-15 03:18", gate: "G7",  severity: "minor", title: "Partner webhook backoff (api.partner.io)", status: "resolved" },
  { id: "INC-2026-0005", at: "2026-04-09 22:04", gate: "G2",  severity: "minor", title: "UBO registry slow response",            status: "resolved" },
];

function statusTone(s: Gate["status"]) {
  if (s === "operational") return { dot: "bg-emerald-600", text: "text-emerald-800" };
  if (s === "degraded")    return { dot: "bg-amber-500",   text: "text-amber-800"   };
  return { dot: "bg-rose-600", text: "text-rose-800" };
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
  const operational = GATES.filter(g => g.status === "operational").length;
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
          <p className="font-mono text-[10px] text-slate-500 mt-0.5">1 degraded · 0 incident</p>
        </div>
        <div className="bg-white p-5">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Open Incidents</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900 tracking-tight">1</p>
          <p className="font-mono text-[10px] text-amber-700 mt-0.5">monitoring · INC-2026-0007</p>
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
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">last 30 days</p>
        </div>
        <ul className="divide-y divide-slate-100 border border-slate-200 border-t-0 bg-white">
          {INCIDENTS.map((i) => (
            <li key={i.id} className="grid grid-cols-[170px_120px_60px_1fr_100px] gap-5 items-center px-5 py-3">
              <p className="font-mono text-[11px] tracking-wider text-slate-900">{i.id}</p>
              <p className="font-mono text-[11px] text-slate-500">{i.at}</p>
              <p className="font-mono text-[11px] text-slate-700">{i.gate}</p>
              <p className="text-[13px] text-slate-900 truncate">{i.title}</p>
              <p className={`font-mono text-[10px] tracking-[0.2em] uppercase text-right ${i.status === "resolved" ? "text-emerald-700" : "text-amber-700"}`}>
                {i.status}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
