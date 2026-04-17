interface Entity {
  id: string;
  legalName: string;
  jurisdiction: string;
  registration: string;
  kyc: "verified" | "pending" | "expired" | "rejected";
  ubo: { resolved: number; required: number };
  authority: "verified" | "pending" | "missing";
  lastReview: string;
  riskScore: number;
}

const ENTITIES: Entity[] = [
  { id: "ent_4Lp2", legalName: "Acme Trading (Pty) Ltd",      jurisdiction: "ZA", registration: "2018/123456/07", kyc: "verified", ubo: { resolved: 4, required: 4 }, authority: "verified", lastReview: "2026-03-22", riskScore: 18 },
  { id: "ent_9Tk6", legalName: "Karoo Mills (Pty) Ltd",       jurisdiction: "ZA", registration: "2019/887541/07", kyc: "verified", ubo: { resolved: 3, required: 3 }, authority: "verified", lastReview: "2026-03-30", riskScore: 24 },
  { id: "ent_2Fz1", legalName: "Veld Commodities NV",         jurisdiction: "NL", registration: "NL-66112233",     kyc: "verified", ubo: { resolved: 5, required: 5 }, authority: "pending",  lastReview: "2026-02-14", riskScore: 41 },
  { id: "ent_8Bm4", legalName: "Harbour Logistics SA",        jurisdiction: "ZA", registration: "2020/445221/07", kyc: "pending",  ubo: { resolved: 2, required: 4 }, authority: "missing",  lastReview: "2026-03-08", riskScore: 67 },
  { id: "ent_5Jb7", legalName: "Sahara Grain Holdings",       jurisdiction: "EG", registration: "EG-CR-998877",    kyc: "expired",  ubo: { resolved: 1, required: 3 }, authority: "missing",  lastReview: "2025-09-12", riskScore: 82 },
  { id: "ent_1Wn3", legalName: "Cape Coastal Shipping",       jurisdiction: "ZA", registration: "2017/553421/07", kyc: "verified", ubo: { resolved: 4, required: 4 }, authority: "verified", lastReview: "2026-04-01", riskScore: 12 },
];

function kycTone(s: Entity["kyc"]) {
  if (s === "verified") return "text-emerald-900 bg-emerald-50 ring-emerald-200";
  if (s === "pending")  return "text-amber-900 bg-amber-50 ring-amber-200";
  if (s === "expired")  return "text-rose-800 bg-rose-50 ring-rose-200";
  return "text-rose-800 bg-rose-50 ring-rose-200";
}
function riskTone(score: number) {
  if (score >= 70) return "text-rose-700";
  if (score >= 40) return "text-amber-700";
  return "text-emerald-700";
}

export function EntityList() {
  return (
    <section>
      <div className="flex items-baseline justify-between pb-3 border-b border-slate-200 mb-0">
        <h2 className="text-base font-medium text-slate-900 tracking-tight">Verified Entities</h2>
        <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">
          {ENTITIES.filter(e => e.kyc === "verified").length} cleared · {ENTITIES.length} total
        </p>
      </div>

      <ul className="divide-y divide-slate-100 border border-slate-200 border-t-0 bg-white">
        {ENTITIES.map((e) => (
          <li key={e.id} className="grid grid-cols-[160px_1fr_120px_120px_120px_90px] gap-5 items-center px-5 py-4 hover:bg-slate-50/60 transition-colors">
            <div>
              <p className="font-mono text-[11px] tracking-wider text-slate-900">{e.id}</p>
              <p className="font-mono text-[10px] text-slate-500 mt-0.5">{e.jurisdiction} · {e.registration}</p>
            </div>
            <div className="min-w-0">
              <p className="text-sm text-slate-900 truncate">{e.legalName}</p>
              <p className="font-mono text-[10px] text-slate-500 mt-0.5">last reviewed {e.lastReview}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">KYC</p>
              <span className={`mt-1 inline-block font-mono text-[9px] tracking-[0.2em] uppercase font-medium px-2 py-1 rounded-sm ring-1 ${kycTone(e.kyc)}`}>
                {e.kyc}
              </span>
            </div>
            <div>
              <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">UBO</p>
              <p className="font-mono text-[12px] text-slate-900 mt-1.5">{e.ubo.resolved}/{e.ubo.required} resolved</p>
            </div>
            <div>
              <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Authority</p>
              <p className="font-mono text-[12px] text-slate-900 mt-1.5 capitalize">{e.authority}</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Risk</p>
              <p className={`font-mono text-base mt-0.5 ${riskTone(e.riskScore)}`}>{e.riskScore}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
