import { Link } from "react-router-dom";
import { ArrowRight, Terminal } from "lucide-react";
import { DocsLayout } from "./DocsLayout";
import { DocEyebrow, DocH1, DocH2, DocLede, DocP, InlineCode, CodePanel, Callout } from "./_shared";

const CURL_EXAMPLE = `curl https://api.trade.izenzo.co.za/functions/v1/healthz \\
  -H "X-API-Key: sk_live_..."`;

const RESPONSE_EXAMPLE = `{
  "status": "healthy",
  "timestamp": "2026-04-18T09:42:17.000Z",
  "checks": [
    { "name": "database",       "status": "healthy", "responseTime": 12 },
    { "name": "edge_functions", "status": "healthy", "responseTime":  4 }
  ]
}`;

const CREATE_MATCH = `curl https://api.trade.izenzo.co.za/functions/v1/match \\
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

export default function DocsQuickstart() {
  return (
    <DocsLayout>
      <div className="max-w-3xl">
        <DocEyebrow>Quickstart</DocEyebrow>
        <DocH1>Your first authenticated request</DocH1>
        <DocLede>
          Provision an API key, make an authenticated health check, and then record a bilateral
          trade match. End-to-end in under five minutes.
        </DocLede>

        <DocH2 id="step-1">1. Create an API key</DocH2>
        <DocP>
          Open the Developer Centre and generate a key. Choose a scope that matches what your
          integration needs to read or write - keys default to least privilege. The full secret
          is shown <strong className="text-foreground font-medium">once</strong> at creation; store
          it in your secrets manager immediately.
        </DocP>
        <Link
          to="/developer/keys"
          className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[hsl(var(--emerald))] hover:text-[hsl(var(--emerald))]"
        >
          Open Developer Centre <ArrowRight className="h-4 w-4" />
        </Link>
        <Callout>
          Keys are prefixed <InlineCode>sk_live_</InlineCode> for production and{" "}
          <InlineCode>sk_test_</InlineCode> for the test environment. The prefix is never sensitive
          - log it freely for support and debugging.
        </Callout>

        <DocH2 id="step-2">2. Verify the key with a health check</DocH2>
        <DocP>
          Pass the secret in the <InlineCode>X-API-Key</InlineCode> header. Every endpoint accepts
          and returns JSON.
        </DocP>
        <CodePanel title="Request" language="bash" code={CURL_EXAMPLE} />
        <CodePanel title="Response · 200" language="json" code={RESPONSE_EXAMPLE} />

        <DocH2 id="step-3">3. Record a match</DocH2>
        <DocP>
          A match represents bilateral trade intent between two organisations. Provide an{" "}
          <InlineCode>Idempotency-Key</InlineCode> on every write so retries are safe.
        </DocP>
        <CodePanel title="POST /match" language="bash" code={CREATE_MATCH} />

        <section className="border-t border-border mt-14 pt-10">
          <div className="flex items-start gap-3">
            <Terminal className="h-5 w-5 text-[hsl(var(--emerald))] mt-0.5" strokeWidth={1.75} />
            <div>
              <h3 className="text-[15px] font-semibold text-foreground mb-1.5 tracking-tight">
                Next steps
              </h3>
              <p className="text-[13.5px] text-muted-foreground leading-relaxed mb-3">
                Read{" "}
                <Link to="/docs/authentication" className="text-[hsl(var(--emerald))] hover:text-[hsl(var(--emerald))] font-medium">
                  Authentication
                </Link>{" "}
                for scope reference and rate limits, or jump straight into{" "}
                <Link to="/docs/matches" className="text-[hsl(var(--emerald))] hover:text-[hsl(var(--emerald))] font-medium">
                  Matches
                </Link>{" "}
                for the full state machine.
              </p>
            </div>
          </div>
        </section>
      </div>
    </DocsLayout>
  );
}
