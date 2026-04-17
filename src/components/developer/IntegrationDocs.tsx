const QUICKSTART = `# 1. Install the SDK
npm install @izenzo/sdk

# 2. Authenticate
import { Izenzo } from "@izenzo/sdk";
const iz = new Izenzo({ apiKey: process.env.IZENZO_KEY });

# 3. First call
const trade = await iz.trade.create({
  side: "buy",
  commodity: "maize.yellow.za",
  quantity_mt: 5000,
  price_zar: 4250,
});

console.log(trade.trade_id); // trd_77f4`;

const CONNECTORS = [
  { name: "SAP S/4HANA",  status: "GA",       lang: "ABAP / OData",   ver: "v2.4" },
  { name: "Oracle NetSuite", status: "GA",    lang: "SuiteScript 2.x", ver: "v1.9" },
  { name: "Microsoft Dynamics 365", status: "GA", lang: "C# / REST",  ver: "v1.6" },
  { name: "Sage X3",      status: "Beta",     lang: "REST",            ver: "v0.8" },
  { name: "Custom Webhook", status: "GA",     lang: "HTTPS / JSON",    ver: "v1.0" },
  { name: "Apache Kafka", status: "Preview",  lang: "Avro / Schema R", ver: "v0.3" },
];

const SDKS = [
  { lang: "TypeScript", pkg: "@izenzo/sdk",    install: "npm install @izenzo/sdk" },
  { lang: "Python",     pkg: "izenzo",         install: "pip install izenzo" },
  { lang: "Go",         pkg: "github.com/izenzo/go-sdk", install: "go get github.com/izenzo/go-sdk" },
  { lang: "Java",       pkg: "co.za.izenzo:sdk", install: "implementation 'co.za.izenzo:sdk:1.4.2'" },
];

function statusTone(s: string) {
  if (s === "GA")     return "text-green-400 border-green-500/40";
  if (s === "Beta")   return "text-amber-400 border-amber-500/40";
  return "text-cyan-400 border-cyan-500/40";
}

export default function IntegrationDocs() {
  return (
    <div className="space-y-12 max-w-5xl">
      {/* Quickstart */}
      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">§01 / Quickstart</div>
        <h2 className="mt-1 text-lg text-slate-100 tracking-tight mb-5">Five-minute integration</h2>
        <pre className="bg-black border border-slate-800 rounded-sm p-5 font-mono text-[12px] leading-relaxed text-slate-100 overflow-x-auto">{QUICKSTART}</pre>
      </section>

      {/* SDKs */}
      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">§02 / SDKs</div>
        <h2 className="mt-1 text-lg text-slate-100 tracking-tight mb-5">Official client libraries</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SDKS.map((s) => (
            <div key={s.lang} className="bg-slate-900 border border-slate-800 rounded-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] text-slate-100">{s.lang}</span>
                <span className="font-mono text-[10px] text-slate-400">{s.pkg}</span>
              </div>
              <pre className="bg-black border border-slate-800 rounded-sm px-3 py-2 font-mono text-[11px] text-green-400 overflow-x-auto">{s.install}</pre>
            </div>
          ))}
        </div>
      </section>

      {/* ERP connectors */}
      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">§03 / ERP Connectors</div>
        <h2 className="mt-1 text-lg text-slate-100 tracking-tight mb-5">Pre-built integrations</h2>
        <div className="bg-slate-900 border border-slate-800 rounded-sm overflow-hidden">
          <div className="grid grid-cols-[1fr_90px_1fr_80px] gap-3 px-4 py-2.5 border-b border-slate-800 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400 bg-black/40">
            <div>Connector</div>
            <div>Status</div>
            <div>Language</div>
            <div className="text-right">Version</div>
          </div>
          <div className="divide-y divide-slate-800/70">
            {CONNECTORS.map((c) => (
              <div key={c.name} className="grid grid-cols-[1fr_90px_1fr_80px] gap-3 px-4 py-3 font-mono text-[12px]">
                <div className="text-slate-100">{c.name}</div>
                <div>
                  <span className={`text-[10px] uppercase tracking-[0.16em] px-1.5 py-0.5 border rounded-sm ${statusTone(c.status)}`}>
                    {c.status}
                  </span>
                </div>
                <div className="text-slate-400">{c.lang}</div>
                <div className="text-right text-slate-400">{c.ver}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <section className="pt-2 border-t border-slate-800">
        <p className="font-mono text-[11px] text-slate-400">
          Engineering support · <span className="text-slate-100">api@izenzo.co.za</span> · SLA: 4h business hours · 24h weekends
        </p>
      </section>
    </div>
  );
}
