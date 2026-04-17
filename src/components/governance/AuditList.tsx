interface Audit {
  id: string;
  subject: string;
  jurisdiction: string;
  trigger: string;
  opened: string;
  officer: string;
  gates: { passed: number; total: number };
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "evidence" | "review" | "sealed";
}

const AUDITS: Audit[] = [
  { id: "AUD-2026-0042", subject: "Acme Trading (Pty) Ltd",  jurisdiction: "ZA", trigger: "Threshold breach · ZAR 18m",   opened: "2026-04-12", officer: "GOV-A77F4219", gates: { passed: 7, total: 9 }, severity: "high",     status: "evidence" },
  { id: "AUD-2026-0041", subject: "Harbour Logistics SA",     jurisdiction: "ZA", trigger: "Sanctions watchlist hit",       opened: "2026-04-10", officer: "GOV-A77F4219", gates: { passed: 4, total: 9 }, severity: "critical", status: "open" },
  { id: "AUD-2026-0040", subject: "Veld Commodities NV",      jurisdiction: "NL", trigger: "FIC information request",       opened: "2026-04-08", officer: "GOV-B3A21BC0", gates: { passed: 9, total: 9 }, severity: "medium",   status: "review" },
  { id: "AUD-2026-0039", subject: "Karoo Mills (Pty) Ltd",    jurisdiction: "ZA", trigger: "Counterparty dispute · evt_8h2",opened: "2026-04-05", officer: "GOV-A77F4219", gates: { passed: 9, total: 9 }, severity: "low",      status: "sealed"   },
  { id: "AUD-2026-0038", subject: "Sahara Grain Holdings",    jurisdiction: "EG", trigger: "UBO chain incomplete",          opened: "2026-04-03", officer: "GOV-C9TK4M6Y", gates: { passed: 6, total: 9 }, severity: "high",     status: "evidence" },
  { id: "AUD-2026-0037", subject: "Cape Coastal Shipping",    jurisdiction: "ZA", trigger: "Periodic re-certification",     opened: "2026-04-01", officer: "GOV-B3A21BC0", gates: { passed: 8, total: 9 }, severity: "low",      status: "review"   },
];

function severityTone(s: Audit["severity"]) {
  if (s === "critical") return "text-rose-800 bg-rose-50 ring-rose-200";
  if (s === "high")     return "text-amber-900 bg-amber-50 ring-amber-200";
  if (s === "medium")   return "text-slate-900 bg-slate-50 ring-slate-300";
  return "text-emerald-900 bg-emerald-50 ring-emerald-200";
}
function statusTone(s: Audit["status"]) {
  if (s === "sealed")   return "text-emerald-800 bg-emerald-50 ring-emerald-200";
  if (s === "review")   return "text-slate-900 bg-slate-50 ring-slate-300";
  if (s === "evidence") return "text-amber-900 bg-amber-50 ring-amber-200";
  return "text-rose-800 bg-rose-50 ring-rose-200";
}

export function AuditList() {
  return (
    <section>
      <div className="flex items-baseline justify-between pb-3 border-b border-slate-200 mb-0">
        <h2 className="text-base font-medium text-slate-900 tracking-tight">Open Investigations</h2>
        <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">
          {AUDITS.filter(a => a.status !== "sealed").length} active · {AUDITS.length} total
        </p>
      </div>

      <ul className="divide-y divide-slate-100 border border-slate-200 border-t-0 bg-white">
        {AUDITS.map((a) => (
          <li key={a.id} className="grid grid-cols-[180px_1fr_140px_140px_120px_90px] gap-5 items-center px-5 py-4 hover:bg-slate-50/60 transition-colors">
            <div>
              <p className="font-mono text-[11px] tracking-wider text-slate-900">{a.id}</p>
              <p className="font-mono text-[10px] text-slate-500 mt-0.5">opened {a.opened}</p>
            </div>
            <div className="min-w-0">
              <p className="text-sm text-slate-900 truncate">{a.subject}</p>
              <p className="text-[12px] text-slate-600 truncate mt-0.5">{a.trigger}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Jurisdiction</p>
              <p className="font-mono text-[12px] text-slate-900 mt-0.5">{a.jurisdiction}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Officer</p>
              <p className="font-mono text-[11px] text-slate-900 mt-0.5 tracking-wider">{a.officer}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Gates</p>
              <p className="font-mono text-[12px] text-slate-900 mt-0.5">{a.gates.passed}/{a.gates.total}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={`font-mono text-[9px] tracking-[0.2em] uppercase font-medium px-2 py-1 rounded-sm ring-1 ${severityTone(a.severity)}`}>
                {a.severity}
              </span>
              <span className={`font-mono text-[9px] tracking-[0.2em] uppercase font-medium px-2 py-1 rounded-sm ring-1 ${statusTone(a.status)}`}>
                {a.status}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
