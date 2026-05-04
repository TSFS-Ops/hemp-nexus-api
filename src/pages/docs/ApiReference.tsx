import { Link } from "react-router-dom";
import { DocsLayout } from "./DocsLayout";
import { DocEyebrow, DocH1, DocH2, DocLede, DocP, CodePanel, EndpointBadge, InlineCode } from "./_shared";

const CREATE_MATCH_CURL = `curl https://api.trade.izenzo.co.za/functions/v1/match \\
  -H "X-API-Key: sk_live_..." \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 9f86d081-884c-7d65-9a2f-eaa0c55ad015" \\
  -d '{
    "buyer":  { "id": "B001", "name": "Aurubis AG" },
    "seller": { "id": "S001", "name": "Glencore Singapore Pte Ltd" },
    "commodity": "Copper Cathode · LME Grade A",
    "quantity": { "amount": 500, "unit": "MT" },
    "price":    { "amount": 9420, "currency": "USD" }
  }'`;

const CREATE_MATCH_RESPONSE = `{
  "id": "match_01HX7Z9K3M2P4Q6R8T0V2X4Y6A",
  "status": "matched",
  "state":  "discovery",
  "hash":   "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "created_at": "2026-04-18T09:14:22.000Z"
}`;

const ENDPOINTS: { section: string; href: string; items: { method: string; path: string; desc: string }[] }[] = [
  {
    section: "Matches",
    href: "/docs/matches",
    items: [
      { method: "POST",   path: "/match",            desc: "Record bilateral trade intent." },
      { method: "GET",    path: "/match/:id",        desc: "Retrieve a match by ID." },
      { method: "POST",   path: "/match/:id/settle", desc: "Confirm intent and seal the collapse ledger." },
      { method: "GET",    path: "/matches",          desc: "List matches scoped to your organisation." },
    ],
  },
  {
    section: "Counterparties",
    href: "/docs/counterparties",
    items: [
      { method: "POST",   path: "/entities",        desc: "Register a legal entity." },
      { method: "GET",    path: "/entities",        desc: "List or fetch entities." },
      { method: "POST",   path: "/authority-bind",  desc: "Manage UBO and Authority-to-Bind records." },
      { method: "POST",   path: "/trade-approval",  desc: "Issue, renew, or revoke a trade approval." },
      { method: "GET",    path: "/trade-status",    desc: "Read current trade-approval status." },
    ],
  },
  {
    section: "Discovery & signals",
    href: "/docs/api",
    items: [
      { method: "POST",   path: "/signals",            desc: "Create a buyer or seller signal." },
      { method: "GET",    path: "/signals/:id",        desc: "Retrieve a signal with its option set." },
      { method: "POST",   path: "/signals/:id/select", desc: "Select an option to advance into engagement." },
      { method: "POST",   path: "/search",             desc: "Discover counterparties matching a query." },
    ],
  },
  {
    section: "Settlement & evidence",
    href: "/docs/evidence",
    items: [
      { method: "POST",   path: "/p3-wad",                desc: "Issue a Without-a-Doubt certificate (9 hard-gates)." },
      { method: "GET",    path: "/evidence-pack/:matchId",desc: "Download the sealed evidence pack." },
      { method: "POST",   path: "/pods",                  desc: "Open a Proof-of-Delivery with milestones." },
    ],
  },
  {
    section: "Webhooks",
    href: "/docs/webhooks",
    items: [
      { method: "POST",   path: "/webhooks",     desc: "Register a webhook endpoint." },
      { method: "GET",    path: "/webhooks",     desc: "List registered endpoints." },
      { method: "DELETE", path: "/webhooks/:id", desc: "Remove an endpoint." },
    ],
  },
  {
    section: "Operational",
    href: "/docs/authentication",
    items: [
      { method: "GET",    path: "/healthz",   desc: "Service health check (unauthenticated)." },
      { method: "POST",   path: "/api-keys",  desc: "Provision an API key (JWT auth)." },
      { method: "GET",    path: "/api-keys",  desc: "List API keys for your organisation." },
      { method: "DELETE", path: "/api-keys/:id", desc: "Revoke an API key." },
      { method: "GET",    path: "/audit-logs",   desc: "Read audit log entries scoped to your org." },
    ],
  },
];

export default function ApiReference() {
  return (
    <DocsLayout>
      <div className="max-w-5xl">
        <DocEyebrow>Reference</DocEyebrow>
        <DocH1>API Reference</DocH1>
        <DocLede>
          The Izenzo API is REST over HTTPS. All requests authenticate with an{" "}
          <InlineCode>X-API-Key</InlineCode> header, all bodies are JSON, and every state-changing
          response carries a deterministic SHA-256 hash for offline verification.
        </DocLede>

        <section className="grid lg:grid-cols-2 gap-10 mb-16">
          <div>
            <DocH2 id="example">Worked example: create a match</DocH2>
            <DocP>
              Records bilateral intent between two registered counterparties. Returns the
              canonical match record with its content hash. Pass an{" "}
              <InlineCode>Idempotency-Key</InlineCode> on every write so retries are safe.
            </DocP>
            <p className="text-[13px] text-muted-foreground mt-4">
              Full parameter reference and lifecycle:{" "}
              <Link to="/docs/matches" className="text-[hsl(var(--emerald))] hover:text-[hsl(var(--emerald))] font-medium">
                Matches
              </Link>
              .
            </p>
          </div>
          <div className="space-y-4">
            <CodePanel title="Request" language="bash" code={CREATE_MATCH_CURL} />
            <CodePanel title="Response · 200" language="json" code={CREATE_MATCH_RESPONSE} />
          </div>
        </section>

        <section className="border-t border-border pt-12">
          <DocH2 id="all-endpoints">All endpoints</DocH2>
          <p className="text-[13.5px] text-muted-foreground mb-6">
            Base URL: <InlineCode>https://api.trade.izenzo.co.za/functions/v1</InlineCode>. Endpoints
            in the discovery, settlement, and webhook groups have dedicated guides linked above.
          </p>
          <div className="space-y-8">
            {ENDPOINTS.map((group) => (
              <div key={group.section}>
                <div className="flex items-baseline justify-between mb-3">
                  <h3 className="text-[13px] uppercase tracking-wider font-semibold text-muted-foreground/70">
                    {group.section}
                  </h3>
                  <Link to={group.href} className="text-[12px] font-medium text-[hsl(var(--emerald))] hover:text-[hsl(var(--emerald))]">
                    Guide →
                  </Link>
                </div>
                <div className="border border-border rounded-xl divide-y divide-border">
                  {group.items.map((ep) => (
                    <div key={`${ep.method}-${ep.path}`} className="flex items-center gap-4 px-4 py-3">
                      <EndpointBadge method={ep.method} />
                      <code className="text-[13px] font-mono text-foreground">{ep.path}</code>
                      <span className="text-[13px] text-muted-foreground ml-auto text-right">{ep.desc}</span>
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
