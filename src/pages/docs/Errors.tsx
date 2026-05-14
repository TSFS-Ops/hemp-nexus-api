import { DocsLayout } from "./DocsLayout";
import { DocEyebrow, DocH1, DocH2, DocH3, DocLede, DocP, InlineCode, CodePanel, ParamTable, Callout } from "./_shared";

const ERROR_SHAPE = `{
  "code":      "ENGAGEMENT_PENDING",
  "message":   "Counterparty has not yet acknowledged this match. The engagement hold-point is still in effect.",
  "requestId": "req_01HX7Z9K3M2P4Q6R8T0V2X4Y6A",
  "details":   { "matchId": "match_01HX7Z..." }
}`;

export default function DocsErrors() {
  return (
    <DocsLayout>
      <div className="max-w-3xl">
        <DocEyebrow>Reference</DocEyebrow>
        <DocH1>Errors</DocH1>
        <DocLede>
          The Izenzo API uses conventional HTTP status codes and a stable JSON error envelope.
          Every error includes a machine-readable code, a human message, and the request ID
          you'll need when contacting support.
        </DocLede>

        <DocH2 id="envelope">Error envelope</DocH2>
        <DocP>
          All non-2xx responses share the same shape. The <InlineCode>code</InlineCode> field
          is stable and safe to switch on; the <InlineCode>message</InlineCode> field is
          human-readable and may change wording.
        </DocP>
        <CodePanel title="Shape" language="json" code={ERROR_SHAPE} />

        <DocH2 id="status-codes">HTTP status codes</DocH2>
        <ParamTable
          rows={[
            { name: "200", type: "OK",                    desc: "Request succeeded." },
            { name: "201", type: "Created",               desc: "Resource created. Returned by POST endpoints that create durable records." },
            { name: "204", type: "No Content",            desc: "Success with no body. Returned by DELETE." },
            { name: "400", type: "Bad Request",           desc: "Validation failed. Inspect details for the offending field." },
            { name: "401", type: "Unauthorized",          desc: "Missing or invalid API key." },
            { name: "403", type: "Forbidden",             desc: "Authenticated, but the key lacks the scope for this endpoint." },
            { name: "404", type: "Not Found",             desc: "Resource doesn't exist or isn't visible to your organisation." },
            { name: "409", type: "Conflict",              desc: "State-machine violation (e.g. attempting to settle a match still pending engagement)." },
            { name: "422", type: "Unprocessable",         desc: "Business-rule failure (e.g. WaD gate denial, insufficient credits)." },
            { name: "429", type: "Too Many Requests",     desc: "Rate limit hit. Honour the Retry-After header." },
            { name: "500", type: "Internal Server Error", desc: "Transient platform failure. Safe to retry with the same Idempotency-Key." },
            { name: "503", type: "Service Unavailable",   desc: "Maintenance or upstream dependency outage. Retry with backoff." },
          ]}
        />

        <DocH2 id="codes">Common error codes</DocH2>
        <ParamTable
          rows={[
            { name: "VALIDATION_ERROR",         type: "400", desc: "Request body failed schema validation. details.fieldErrors lists each violation." },
            { name: "UNAUTHORIZED",             type: "401", desc: "API key missing, malformed, or revoked." },
            { name: "INVALID_API_KEY",          type: "401", desc: "Key is correctly formatted but does not match any active record." },
            { name: "FORBIDDEN",                type: "403", desc: "Key lacks the required scope. details.requiredScope names what's needed." },
            { name: "NOT_FOUND",                type: "404", desc: "Referenced resource doesn't exist or isn't accessible to your org." },
            { name: "ENGAGEMENT_PENDING",       type: "409", desc: "Settlement attempted before counterparty acknowledged the match." },
            { name: "DISPUTE_ACTIVE",           type: "409", desc: "Mutation attempted on a match with an open dispute. Resolve the dispute first." },
            { name: "STATE_TRANSITION_INVALID", type: "409", desc: "Tried to advance a match to a state it can't reach from its current state." },
            { name: "TRADE_APPROVAL_MISSING",   type: "422", desc: "Counterparty has no active trade approval. Issue one or renew." },
            { name: "WAD_GATE_FAILURE",         type: "422", desc: "One or more WaD hard-gates failed. details.failedGates lists each." },
            { name: "INSUFFICIENT_TOKENS",      type: "422", desc: "Credit balance below the minimum required for this action. Top up at /desk/settings/balance. (Wire code remains INSUFFICIENT_TOKENS for API contract stability; user-facing wording is Credits.)" },
            { name: "RATE_LIMIT_EXCEEDED",      type: "429", desc: "Too many requests. The Retry-After header tells you when to try again." },
          ]}
        />

        <Callout>
          Every error response carries a <InlineCode>requestId</InlineCode>. Always include it
          in support requests - it lets the team retrieve the exact log line and audit context
          for your call without searching.
        </Callout>

        <DocH2 id="retries">Retries & idempotency</DocH2>
        <DocP>
          5xx responses and network failures are safe to retry. Always pass an{" "}
          <InlineCode>Idempotency-Key</InlineCode> header on POST requests so retries don't
          create duplicate resources. The platform stores the key for 24 hours and returns the
          original response on subsequent calls with the same key.
        </DocP>

        <DocH3>Recommended backoff</DocH3>
        <DocP>
          Exponential backoff with jitter: <InlineCode>1s, 2s, 4s, 8s, 16s</InlineCode> with
          ±20% randomisation, capped at five attempts. Stop retrying immediately on 4xx
          responses other than 429 - they will not become successful by being repeated.
        </DocP>
      </div>
    </DocsLayout>
  );
}
