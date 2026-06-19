const QUICKSTART = `# 1. Issue an approved API key from /developer/keys.
#    Sandbox and production keys are separate. The raw secret is shown once only.
export IZENZO_SANDBOX_KEY="sk_sandbox_..."
export IZENZO_PRODUCTION_KEY="sk_live_..."

# 2. Sandbox base URL — fictional test records, non-billable.
curl https://api-sandbox.trade.izenzo.co.za/v1/health \\
  -H "X-API-Key: $IZENZO_SANDBOX_KEY" \\
  -H "X-Izenzo-Environment: sandbox"

# 3. Sandbox counterparty lookup against a deterministic test record.
curl https://api-sandbox.trade.izenzo.co.za/v1/counterparty/lookup \\
  -H "X-API-Key: $IZENZO_SANDBOX_KEY" \\
  -H "X-Izenzo-Environment: sandbox" \\
  -H "Content-Type: application/json" \\
  -d '{
    "legal_name": "TEST Verified Energy (Pty) Ltd",
    "registration_number": "TEST-2019-000001",
    "country": "ZA"
  }'

# 4. Production base URL — read-only in V1, production access requires approval.
#    Host-derived environment wins over any header.
curl https://api.trade.izenzo.co.za/v1/health \\
  -H "X-API-Key: $IZENZO_PRODUCTION_KEY" \\
  -H "X-Izenzo-Environment: production"`;

const FETCH_SAMPLE = `const res = await fetch(
  "https://api-sandbox.trade.izenzo.co.za/v1/counterparty/lookup",
  {
    method: "POST",
    headers: {
      "X-API-Key": process.env.IZENZO_SANDBOX_KEY,
      "X-Izenzo-Environment": "sandbox",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      legal_name: "TEST Verified Energy (Pty) Ltd",
      registration_number: "TEST-2019-000001",
      country: "ZA",
    }),
  },
);

if (!res.ok) throw new Error(\`Izenzo \${res.status}\`);
const lookup = await res.json();
// Sandbox responses carry test_data: true and may include test_record /
// sandbox_case_id / simulated_provider. Those fields never appear in production.`;

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

      {/* Warnings */}
      <section className="rounded-sm border border-emerald-700/40 bg-emerald-900/10 px-5 py-4 space-y-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400">// sandbox warning</div>
          <p className="mt-1 text-[13px] text-slate-200 leading-snug">
            Sandbox records are fictional test records. Sandbox responses, statuses, errors, webhooks and usage reports must not be used for live business decisions, compliance decisions, payment decisions or counterparty approvals.
          </p>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400">// production warning</div>
          <p className="mt-1 text-[13px] text-slate-200 leading-snug">
            Production API responses provide Izenzo status and risk signals based on available records and approved response fields. They are not legal advice, not a payment guarantee, not a compliance clearance, not a bank-account verification guarantee and not a substitute for the client's own approval process unless separately agreed in writing. No API response automatically creates a POI, issues a WaD, clears a compliance block or approves a transaction.
          </p>
        </div>
      </section>

      {/* Base URLs */}
      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">§00 / Base URLs</div>
        <h2 className="mt-1 text-lg text-slate-100 tracking-tight mb-3">Environment-specific base URLs</h2>
        <ul className="text-[13px] text-slate-300 leading-relaxed list-disc pl-5 space-y-1">
          <li>Sandbox: <span className="font-mono text-slate-100">https://api-sandbox.trade.izenzo.co.za/v1</span> — fictional records, non-billable.</li>
          <li>Production: <span className="font-mono text-slate-100">https://api.trade.izenzo.co.za/v1</span> — read-only in V1, production access requires approval.</li>
          <li><strong>Host-derived environment wins over any header.</strong> Sandbox keys do not work in production; production keys do not work on sandbox-only routes.</li>
        </ul>
      </section>

      {/* Quickstart */}
      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">§01 / Quickstart</div>
        <h2 className="mt-1 text-lg text-slate-100 tracking-tight mb-5">Five-minute integration · REST · V1</h2>
        <pre className="bg-black border border-slate-800 rounded-sm p-5 font-mono text-[12px] leading-relaxed text-slate-100 overflow-x-auto">{QUICKSTART}</pre>
      </section>

      {/* fetch example */}
      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">§02 / Browser & Node · fetch</div>
        <h2 className="mt-1 text-lg text-slate-100 tracking-tight mb-5">Call the API directly</h2>
        <p className="text-[13px] text-slate-400 leading-relaxed mb-4 max-w-2xl">
          The V1 surface is intentionally small. Any HTTP client - <span className="font-mono text-slate-300">fetch</span>,{" "}
          <span className="font-mono text-slate-300">requests</span>, <span className="font-mono text-slate-300">curl</span>,{" "}
          <span className="font-mono text-slate-300">HttpClient</span> - works without ceremony. V1 is server-to-server only; no browser or mobile direct use.
        </p>
        <pre className="bg-black border border-slate-800 rounded-sm p-5 font-mono text-[12px] leading-relaxed text-slate-100 overflow-x-auto">{FETCH_SAMPLE}</pre>
        <p className="mt-4 font-mono text-[11px] text-slate-500">
          Machine-readable spec: <span className="text-slate-300">GET /v1/docs/openapi.json</span>. Generate clients via{" "}
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
