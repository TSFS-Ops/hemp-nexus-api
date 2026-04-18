import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { DocsLayout } from "./DocsLayout";
import { DocEyebrow, DocH1, DocH2, DocLede, DocP, CodePanel, Callout, InlineCode } from "./_shared";

const NODE_INSTALL = `npm install @izenzo/sdk`;

const NODE_SAMPLE = `import { IzenzoClient } from "@izenzo/sdk";

const client = new IzenzoClient({
  apiKey: process.env.IZENZO_KEY!,
});

const match = await client.matches.create({
  buyer:  { id: "B001", name: "Aurubis AG" },
  seller: { id: "S001", name: "Glencore Singapore Pte Ltd" },
  commodity: "Copper Cathode · LME Grade A",
  quantity:  { amount: 500,  unit: "MT" },
  price:     { amount: 9420, currency: "USD" },
});`;

const CURL_SAMPLE = `curl https://api.izenzo.co.za/functions/v1/match \\
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
    "X-API-Key": process.env.IZENZO_KEY!,
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

const PYTHON_SAMPLE = `import os, uuid, requests

resp = requests.post(
    "https://api.izenzo.co.za/functions/v1/match",
    headers={
        "X-API-Key":        os.environ["IZENZO_KEY"],
        "Content-Type":     "application/json",
        "Idempotency-Key":  str(uuid.uuid4()),
    },
    json={
        "buyer":  {"id": "B001", "name": "Aurubis AG"},
        "seller": {"id": "S001", "name": "Glencore Singapore Pte Ltd"},
        "commodity": "Copper Cathode · LME Grade A",
        "quantity": {"amount": 500,  "unit": "MT"},
        "price":    {"amount": 9420, "currency": "USD"},
    },
    timeout=30,
)
resp.raise_for_status()
match = resp.json()`;

export default function Sdks() {
  return (
    <DocsLayout>
      <div className="max-w-4xl">
        <DocEyebrow>Reference</DocEyebrow>
        <DocH1>Client libraries</DocH1>
        <DocLede>
          A first-class TypeScript SDK ships with the platform. For other runtimes, the API is
          designed to be straightforward to call directly — every example below produces an
          identical signed request.
        </DocLede>

        <DocH2 id="node">@izenzo/sdk · Node & TypeScript</DocH2>
        <DocP>
          Type-safe request builders, automatic retries with exponential backoff, and webhook
          signature helpers. Targets Node 18+ and any modern bundler.
        </DocP>
        <CodePanel title="Install" language="bash" code={NODE_INSTALL} />
        <CodePanel title="Usage" language="typescript" code={NODE_SAMPLE} />
        <p className="text-[13px] text-slate-500 -mt-2">
          Source on{" "}
          <a
            href="https://www.npmjs.com/package/@izenzo/sdk"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 font-medium"
          >
            npm <ExternalLink className="h-3 w-3" />
          </a>
          .
        </p>

        <DocH2 id="other-runtimes">Other runtimes</DocH2>
        <DocP>
          The HTTP surface is small enough that a hand-rolled client is usually the right call.
          Each snippet below is a complete, copy-pasteable example.
        </DocP>

        <h3 className="text-[14px] font-semibold text-slate-900 mt-8 mb-2">curl</h3>
        <CodePanel language="bash" code={CURL_SAMPLE} />

        <h3 className="text-[14px] font-semibold text-slate-900 mt-8 mb-2">Browser / Deno · fetch</h3>
        <CodePanel language="javascript" code={FETCH_SAMPLE} />

        <h3 className="text-[14px] font-semibold text-slate-900 mt-8 mb-2">Python · requests</h3>
        <CodePanel language="python" code={PYTHON_SAMPLE} />

        <Callout>
          Building in Go, Ruby, .NET, or Rust? The OpenAPI spec at{" "}
          <InlineCode>/openapi.yaml</InlineCode> generates idiomatic clients via{" "}
          <a
            href="https://openapi-generator.tech/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-600 hover:text-emerald-700 font-medium"
          >
            openapi-generator
          </a>{" "}
          for 50+ targets. We're happy to review the result before you deploy.
        </Callout>

        <DocH2 id="next">Next</DocH2>
        <DocP>
          Wire up signed callbacks (
          <Link to="/docs/webhooks" className="text-emerald-600 hover:text-emerald-700 font-medium">
            Webhooks
          </Link>
          ), or browse the full surface in the{" "}
          <Link to="/docs/api" className="text-emerald-600 hover:text-emerald-700 font-medium">
            API Reference
          </Link>
          .
        </DocP>
      </div>
    </DocsLayout>
  );
}
