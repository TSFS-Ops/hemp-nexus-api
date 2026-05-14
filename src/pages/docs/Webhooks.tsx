import { DocsLayout } from "./DocsLayout";
import { DocEyebrow, DocH1, DocH2, DocH3, DocLede, DocP, InlineCode, CodePanel, Callout, ParamTable, EndpointBadge } from "./_shared";

const REGISTER = `POST /webhooks
X-API-Key: sk_live_...
Content-Type: application/json

{
  "url": "https://example.com/hooks/izenzo",
  "events": ["match.created", "intent.confirmed", "poi.generated"]
}`;

const VERIFY_NODE = `import crypto from "node:crypto";
import express from "express";

const app = express();

app.post("/hooks/izenzo", express.raw({ type: "application/json" }), (req, res) => {
  const signature = req.header("X-Webhook-Signature");
  const expected  = crypto
    .createHmac("sha256", process.env.IZENZO_WEBHOOK_SECRET)
    .update(req.body)
    .digest("hex");

  if (signature !== expected) return res.status(401).end();

  const event = JSON.parse(req.body.toString("utf8"));
  // ... handle event ...
  res.status(200).end();
});`;

const SAMPLE_PAYLOAD = `{
  "event": "intent.confirmed",
  "timestamp": "2026-04-18T09:41:58.000Z",
  "orgId": "org_8f3a9c1e4d2b6f7a0c8e5d3b1a4f9e2c",
  "data": {
    "matchId":   "match_01HX7Z9K3M2P4Q6R8T0V2X4Y6A",
    "hash":      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "settledAt": "2026-04-18T09:41:58.000Z",
    "commodity": "Copper Cathode · LME Grade A",
    "quantity":  500
  }
}`;

export default function DocsWebhooks() {
  return (
    <DocsLayout>
      <div className="max-w-3xl">
        <DocEyebrow>Core resources</DocEyebrow>
        <DocH1>Webhooks</DocH1>
        <DocLede>
          Webhooks are signed HTTP POST callbacks delivered to your endpoint when state changes
          on the platform. Every payload is HMAC-SHA256 signed with a secret you control and
          retried with exponential backoff for up to 24 hours on transient failure.
        </DocLede>

        <DocH2 id="register">Register an endpoint</DocH2>
        <div className="flex items-center gap-3 mb-3">
          <EndpointBadge method="POST" />
          <code className="text-[13.5px] font-mono text-foreground">/webhooks</code>
        </div>
        <CodePanel title="Request" language="http" code={REGISTER} />
        <DocP>
          The response includes the signing secret. It is shown <strong>once</strong>; store it
          alongside your API keys. If you lose it, rotate the endpoint to generate a new secret.
        </DocP>

        <DocH2 id="events">Events</DocH2>
        <DocP>
          Subscribe only to the events you need. Unrecognised events in the array are rejected
          at registration with <InlineCode>400 INVALID_EVENT</InlineCode>.
        </DocP>
        <ParamTable
          rows={[
            { name: "signal.created",            type: "event", desc: "A buyer or seller signal was created." },
            { name: "option.selected",           type: "event", desc: "A counterparty selected one of your options." },
            { name: "match.created",             type: "event", desc: "A bilateral match was recorded against a Trade Request." },
            { name: "engagement.accepted",       type: "event", desc: "Counterparty accepted the engagement; hold-point cleared and POI mint is now reachable." },
            { name: "counterparty.sighted",      type: "event", desc: "Counterparty has acknowledged a match they are party to (single-side)." },
            { name: "poi.generated",             type: "event", desc: "Proof of Intent has been minted for a match." },
            { name: "intent.confirmed",          type: "event", desc: "Both parties' Proof of Intent recorded; collapse ledger entry sealed." },
            { name: "transaction.committed",     type: "event", desc: "Match advanced to committed; terms are now immutable." },
            { name: "wad.sealed",                type: "event", desc: "Without a Doubt certificate sealed; evidence pack available for download." },
            { name: "dispute.opened",            type: "event", desc: "A dispute was raised against a match; commercial mutations are blocked until resolved." },
          ]}
        />

        <DocH2 id="payload">Payload shape</DocH2>
        <DocP>
          Every webhook delivery has the same envelope. The <InlineCode>data</InlineCode>{" "}
          object varies by event.
        </DocP>
        <Callout>
          <strong className="text-foreground font-medium">Perspective.</strong> Webhook
          payloads are scoped to the <strong className="text-foreground font-medium">subscribing org</strong>.
          Any field prefixed <InlineCode>counterparty_</InlineCode> describes the org sitting in
          the slot <em>opposite</em> to the subscribing org — never an absolute buyer or
          seller. The same match emits one delivery per subscribed org and the
          <InlineCode>counterparty_*</InlineCode> values flip accordingly.
        </Callout>
        <CodePanel title="Sample · intent.confirmed" language="json" code={SAMPLE_PAYLOAD} />

        <DocH2 id="signature">Signature verification</DocH2>
        <DocP>
          Verify the <InlineCode>X-Webhook-Signature</InlineCode> header on every delivery. It
          is the lowercase hex HMAC-SHA256 of the raw request body, keyed by your endpoint
          secret. Discard requests that fail verification.
        </DocP>
        <CodePanel title="Node.js + Express" language="javascript" code={VERIFY_NODE} />
        <Callout variant="warning">
          Always verify against the <strong>raw</strong> request body, before any JSON parsing
          or middleware mutation. Most signature mismatches in production are caused by a
          framework re-serialising the body in between.
        </Callout>

        <DocH2 id="delivery">Delivery & retries</DocH2>
        <DocP>
          A delivery is considered successful if your endpoint returns a 2xx within 10 seconds.
          On any other response (or no response at all), the platform retries with exponential
          backoff: <InlineCode>5m, 15m, 1h, 6h, 24h</InlineCode>. After the final retry the
          delivery is moved to the dead-letter queue, visible in the Developer Centre.
        </DocP>

        <DocH3>Headers on every delivery</DocH3>
        <ParamTable
          rows={[
            { name: "X-Webhook-Signature", type: "hex sha256", desc: "HMAC-SHA256 of the raw body, keyed by your endpoint secret." },
            { name: "X-Webhook-Event",     type: "string",     desc: "Event name, e.g. intent.confirmed. Mirrors the payload's event field." },
            { name: "X-Webhook-Timestamp", type: "ISO-8601",   desc: "Server time at which the event was emitted." },
            { name: "Content-Type",        type: "string",     desc: "Always application/json." },
          ]}
        />

        <DocH2 id="best-practices">Best practices</DocH2>
        <DocP>
          Make your handler idempotent - the platform may retry a delivery you've already
          processed. Key your processing on <InlineCode>data.matchId</InlineCode> (or the most
          specific identifier in the payload) and skip duplicates. Respond 2xx as soon as the
          payload is persisted; do downstream work asynchronously.
        </DocP>
      </div>
    </DocsLayout>
  );
}
