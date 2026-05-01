import { useState } from "react";

interface Endpoint {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  summary: string;
  request?: string;
  response: string;
}

const GROUPS: { name: string; endpoints: Endpoint[] }[] = [
  {
    name: "Trade",
    endpoints: [
      {
        method: "POST", path: "/v1/trade.create",
        summary: "Create a unilateral or bilateral trade signal",
        request: `{\n  "side": "buy",\n  "commodity": "maize.yellow.za",\n  "quantity_mt": 5000,\n  "price_zar": 4250,\n  "incoterm": "FOB Durban"\n}`,
        response: `{\n  "trade_id": "trd_77f4",\n  "status": "open",\n  "created_at": "2026-04-17T12:46:11Z"\n}`,
      },
      {
        method: "GET", path: "/v1/trade.search",
        summary: "Search the open order book",
        response: `{\n  "results": [\n    { "trade_id": "trd_77f4", "side": "buy", "commodity": "maize.yellow.za" }\n  ],\n  "next_cursor": null\n}`,
      },
    ],
  },
  {
    name: "POI",
    endpoints: [
      {
        method: "POST", path: "/v1/poi.generate",
        summary: "Generate a Proof of Intent (1 credit / $1.00 USD burn)",
        request: `{\n  "match_id": "mch_77f4a219",\n  "side": "buy"\n}`,
        response: `{\n  "poi_id": "poi_3a21bc",\n  "state": "issued",\n  "burn_tx": "0xabc…123",\n  "issued_at": "2026-04-17T12:45:48Z"\n}`,
      },
      {
        method: "POST", path: "/v1/poi.seal",
        summary: "Seal a POI after counterparty acknowledgement",
        request: `{ "poi_id": "poi_3a21bc" }`,
        response: `{ "poi_id": "poi_3a21bc", "state": "sealed" }`,
      },
    ],
  },
  {
    name: "Entities",
    endpoints: [
      {
        method: "GET", path: "/v1/entities/search",
        summary: "Resolve verified entity by name or registration number",
        response: `{\n  "entity_id": "ent_4Lp2",\n  "legal_name": "Acme Trading (Pty) Ltd",\n  "jurisdiction": "ZA",\n  "kyc_status": "verified"\n}`,
      },
    ],
  },
  {
    name: "Webhooks",
    endpoints: [
      {
        method: "POST", path: "/v1/webhooks.create",
        summary: "Register an HTTPS endpoint for event delivery",
        request: `{\n  "url": "https://erp.acme.co.za/hooks/izenzo",\n  "events": ["match.sealed", "poi.generated"]\n}`,
        response: `{ "webhook_id": "whk_8h2k", "secret": "whsec_…", "active": true }`,
      },
    ],
  },
];

function methodTone(m: Endpoint["method"]) {
  if (m === "GET") return "text-cyan-400 border-cyan-500/40";
  if (m === "POST") return "text-green-400 border-green-500/40";
  if (m === "PUT") return "text-amber-400 border-amber-500/40";
  return "text-rose-400 border-rose-500/40";
}

export default function SchemaExplorer() {
  const [selected, setSelected] = useState<Endpoint>(GROUPS[0].endpoints[0]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr] gap-6">
      {/* Endpoint tree */}
      <aside>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 mb-3">§01 / Endpoints</div>
        <div className="bg-slate-900 border border-slate-800 rounded-sm">
          {GROUPS.map((g, gi) => (
            <div key={g.name} className={gi > 0 ? "border-t border-slate-800" : ""}>
              <div className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 bg-black/30">
                {g.name}
              </div>
              {g.endpoints.map((e) => (
                <button
                  key={e.path + e.method}
                  onClick={() => setSelected(e)}
                  className={[
                    "w-full px-4 py-2.5 flex items-center gap-2 transition-colors text-left",
                    selected.path === e.path && selected.method === e.method
                      ? "bg-slate-800/70"
                      : "hover:bg-slate-800/40",
                  ].join(" ")}
                >
                  <span className={`font-mono text-[9px] uppercase tracking-[0.15em] px-1 py-0.5 border rounded-sm ${methodTone(e.method)}`}>
                    {e.method}
                  </span>
                  <span className="font-mono text-[12px] text-slate-100 truncate">{e.path}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      {/* Detail */}
      <section>
        <div className="flex items-baseline gap-3 mb-2">
          <span className={`font-mono text-[10px] uppercase tracking-[0.18em] px-1.5 py-0.5 border rounded-sm ${methodTone(selected.method)}`}>
            {selected.method}
          </span>
          <h2 className="font-mono text-lg text-slate-100">{selected.path}</h2>
        </div>
        <p className="text-[13px] text-slate-400 mb-6">{selected.summary}</p>

        {selected.request && (
          <div className="mb-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 mb-2">Request body</div>
            <pre className="bg-black border border-slate-800 rounded-sm p-4 font-mono text-[12px] leading-relaxed text-cyan-400 overflow-x-auto">{selected.request}</pre>
          </div>
        )}

        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 mb-2">Response · 200 OK</div>
          <pre className="bg-black border border-slate-800 rounded-sm p-4 font-mono text-[12px] leading-relaxed text-green-400 overflow-x-auto">{selected.response}</pre>
        </div>

        <div className="mt-6 flex gap-2">
          <button className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400 hover:text-green-400 border border-slate-700 hover:border-green-500/50 px-3 py-1.5 rounded-sm transition-colors">
            Copy as cURL
          </button>
          <button className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400 hover:text-cyan-400 border border-slate-700 hover:border-cyan-500/50 px-3 py-1.5 rounded-sm transition-colors">
            Open in Playground
          </button>
        </div>
      </section>
    </div>
  );
}
