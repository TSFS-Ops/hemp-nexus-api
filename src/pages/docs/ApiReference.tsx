import { DocsLayout } from "./DocsLayout";

const CREATE_MATCH_CURL = `curl https://api.izenzo.co.za/v1/matches \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "counterparty_id": "cp_8f3a...",
    "commodity": "iron_ore_62fe",
    "side": "bid",
    "quantity": 50000,
    "unit": "MT",
    "price_usd": 102.50,
    "incoterms": "CFR",
    "delivery_port": "Qingdao"
  }'`;

const CREATE_MATCH_RESPONSE = `{
  "id": "match_01HX7Z...",
  "status": "pending_poi",
  "counterparty": {
    "id": "cp_8f3a...",
    "verified": true,
    "jurisdiction": "ZA"
  },
  "evidence_pack_url": null,
  "created_at": "2026-04-17T09:14:22Z",
  "signature": "sha256:9e1c...a7"
}`;

function CodeBlock({ code, title }: { code: string; title: string }) {
  return (
    <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden shadow-2xl">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
        <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{title}</span>
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
          <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
        </div>
      </div>
      <pre className="p-5 text-[12.5px] leading-relaxed text-slate-100 font-mono overflow-x-auto">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const ENDPOINTS = [
  {
    section: "Matches",
    items: [
      { method: "POST", path: "/v1/matches", desc: "Create a bilateral trade intent." },
      { method: "GET", path: "/v1/matches/:id", desc: "Retrieve a match by ID." },
      { method: "POST", path: "/v1/matches/:id/poi", desc: "Generate Proof of Intent." },
    ],
  },
  {
    section: "Counterparties",
    items: [
      { method: "POST", path: "/v1/counterparties", desc: "Register and verify a counterparty." },
      { method: "GET", path: "/v1/counterparties/:id", desc: "Retrieve KYB status." },
    ],
  },
  {
    section: "Evidence",
    items: [
      { method: "GET", path: "/v1/matches/:id/evidence", desc: "Download the signed evidence pack." },
    ],
  },
];

const METHOD_COLORS: Record<string, string> = {
  GET: "text-emerald-600 bg-emerald-50",
  POST: "text-blue-600 bg-blue-50",
};

export default function ApiReference() {
  return (
    <DocsLayout>
      <div className="max-w-5xl">
        <p className="text-[13px] font-medium text-emerald-600 tracking-wider uppercase mb-3">
          Reference
        </p>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tighter text-slate-900 mb-5">
          API Reference
        </h1>
        <p className="text-lg text-slate-500 leading-relaxed mb-12 max-w-2xl">
          The Izenzo API is organised around REST. All requests are authenticated with bearer tokens
          and responses are JSON-encoded with deterministic SHA-256 signatures.
        </p>

        {/* Two-column: text + code */}
        <section className="grid lg:grid-cols-2 gap-10 mb-16">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900 mb-3">
              Create a match
            </h2>
            <p className="text-slate-500 leading-relaxed mb-4">
              Creates a new bilateral trade intent between your organisation and a verified
              counterparty. The match enters a <code className="text-[12.5px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">pending_poi</code> state until both
              sides confirm intent.
            </p>
            <h3 className="text-[13px] font-semibold text-slate-900 mb-2 mt-6">Parameters</h3>
            <ul className="space-y-2 text-[13.5px] text-slate-600">
              <li><code className="font-mono text-slate-900">counterparty_id</code> <span className="text-slate-400">string · required</span></li>
              <li><code className="font-mono text-slate-900">commodity</code> <span className="text-slate-400">string · required</span></li>
              <li><code className="font-mono text-slate-900">side</code> <span className="text-slate-400">enum · bid | offer</span></li>
              <li><code className="font-mono text-slate-900">quantity</code> <span className="text-slate-400">number · required</span></li>
              <li><code className="font-mono text-slate-900">price_usd</code> <span className="text-slate-400">number · optional</span></li>
            </ul>
          </div>
          <div className="space-y-4">
            <CodeBlock code={CREATE_MATCH_CURL} title="Request" />
            <CodeBlock code={CREATE_MATCH_RESPONSE} title="Response · 200" />
          </div>
        </section>

        {/* Endpoint index */}
        <section className="border-t border-slate-100 pt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 mb-6">
            All endpoints
          </h2>
          <div className="space-y-8">
            {ENDPOINTS.map((group) => (
              <div key={group.section}>
                <h3 className="text-[13px] uppercase tracking-wider font-semibold text-slate-400 mb-3">
                  {group.section}
                </h3>
                <div className="border border-slate-100 rounded-xl divide-y divide-slate-100">
                  {group.items.map((ep) => (
                    <div key={ep.path} className="flex items-center gap-4 px-4 py-3">
                      <span
                        className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded ${
                          METHOD_COLORS[ep.method] || "text-slate-600 bg-slate-100"
                        }`}
                      >
                        {ep.method}
                      </span>
                      <code className="text-[13px] font-mono text-slate-900">{ep.path}</code>
                      <span className="text-[13px] text-slate-500 ml-auto">{ep.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </DocsLayout>
  );
}
