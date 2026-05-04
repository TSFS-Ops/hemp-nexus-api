const QUICKSTART = `# 1. Issue an API key from /developer/keys
export IZENZO_KEY="sk_live_..."

# 2. Authenticate every call with the X-API-Key header
curl https://api.izenzo.co.za/functions/v1/healthz \\
  -H "X-API-Key: $IZENZO_KEY"

# 3. Record bilateral trade intent
curl https://api.izenzo.co.za/functions/v1/match \\
  -H "X-API-Key: $IZENZO_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{
    "buyer":  { "id": "B001", "name": "Aurubis AG" },
    "seller": { "id": "S001", "name": "Glencore Singapore Pte Ltd" },
    "commodity": "Copper Cathode · LME Grade A",
    "quantity": { "amount": 500, "unit": "MT" },
    "price":    { "amount": 9420, "currency": "USD" }
  }'`;

const FETCH_SAMPLE = `const res = await fetch("https://api.izenzo.co.za/functions/v1/match", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.IZENZO_KEY,
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
  },
  body: JSON.stringify({
    buyer:  { id: "B001", name: "Aurubis AG" },
    seller: { id: "S001", name: "Glencore Singapore Pte Ltd" },
    commodity: "Copper Cathode · LME Grade A",
    quantity:  { amount: 500,  unit: "MT" },
    price:     { amount: 9420, currency: "USD" },
  }),
});

if (!res.ok) throw new Error(\`Izenzo \${res.status}\`);
const match = await res.json();`;

const CONNECTORS = [
  { name: "SAP S/4HANA",  status: "GA",       lang: "ABAP / OData",   ver: "v2.4" },
  { name: "Oracle NetSuite", status: "GA",    lang: "SuiteScript 2.x", ver: "v1.9" },
  { name: "Microsoft Dynamics 365", status: "GA", lang: "C# / REST",  ver: "v1.6" },
  { name: "Sage X3",      status: "Beta",     lang: "REST",            ver: "v0.8" },
  { name: "Custom Webhook", status: "GA",     lang: "HTTPS / JSON",    ver: "v1.0" },
  { name: "Apache Kafka", status: "Preview",  lang: "Avro / Schema R", ver: "v0.3" },
];

function statusTone(s: string) {
  if (s === "GA")     return "text-green-400 border-green-500/40";
  if (s === "Beta")   return "text-amber-400 border-amber-500/40";
  return "text-cyan-400 border-cyan-500/40";
}

import { downloadIntegrationGuidePdf } from "./IntegrationGuidePdf";

export default function IntegrationDocs() {
  return (
    <div className="space-y-12 max-w-5xl">
      {/* PDF download for client-team circulation */}
      <section className="rounded-sm border border-slate-800 bg-slate-900/40 px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div style={{ fontFamily: "Inter, sans-serif" }}>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400">
            // downloadable reference
          </div>
          <p className="mt-1 text-[13px] text-slate-200 leading-snug max-w-2xl">
            Need to circulate this internally? Download a clean PDF of the integration guide. The Developer Centre stays the authoritative source; the PDF is a snapshot.
          </p>
        </div>
        <button
          onClick={() => {
            try { downloadIntegrationGuidePdf(); } catch (e) { console.error(e); }
          }}
          className="shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-100 border border-emerald-500/50 hover:border-emerald-400 hover:bg-emerald-500/10 px-3 py-1.5 rounded-sm transition-colors"
        >
          ↓ Integration guide (PDF)
        </button>
      </section>

      {/* Quickstart */}
      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">§01 / Quickstart</div>
        <h2 className="mt-1 text-lg text-slate-100 tracking-tight mb-5">Five-minute integration · REST</h2>
        <pre className="bg-black border border-slate-800 rounded-sm p-5 font-mono text-[12px] leading-relaxed text-slate-100 overflow-x-auto">{QUICKSTART}</pre>
      </section>

      {/* fetch example */}
      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">§02 / Browser & Node · fetch</div>
        <h2 className="mt-1 text-lg text-slate-100 tracking-tight mb-5">Call the API directly</h2>
        <p className="text-[13px] text-slate-400 leading-relaxed mb-4 max-w-2xl">
          The API surface is intentionally small. Any HTTP client - <span className="font-mono text-slate-300">fetch</span>,{" "}
          <span className="font-mono text-slate-300">requests</span>, <span className="font-mono text-slate-300">curl</span>,{" "}
          <span className="font-mono text-slate-300">HttpClient</span> - works without ceremony.
        </p>
        <pre className="bg-black border border-slate-800 rounded-sm p-5 font-mono text-[12px] leading-relaxed text-slate-100 overflow-x-auto">{FETCH_SAMPLE}</pre>
        <p className="mt-4 font-mono text-[11px] text-slate-500">
          Generating clients from the OpenAPI spec at <span className="text-slate-300">/openapi.yaml</span> is supported via{" "}
          <a href="https://openapi-generator.tech/" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300">openapi-generator</a>{" "}
          for 50+ languages.
        </p>
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
