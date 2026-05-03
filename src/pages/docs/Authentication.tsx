import { DocsLayout } from "./DocsLayout";
import { DocEyebrow, DocH1, DocH2, DocH3, DocLede, DocP, InlineCode, CodePanel, Callout, ParamTable } from "./_shared";

export default function DocsAuthentication() {
  return (
    <DocsLayout>
      <div className="max-w-3xl">
        <DocEyebrow>Authentication</DocEyebrow>
        <DocH1>API keys & access control</DocH1>
        <DocLede>
          The Izenzo API uses API key authentication for machine-to-machine traffic and bearer
          tokens for user-scoped operations originating from your dashboard. Both are bound to a
          single organisation; data is isolated by row-level security on every read and write.
        </DocLede>

        <DocH2 id="api-keys">API keys</DocH2>
        <DocP>
          Pass your secret in the <InlineCode>X-API-Key</InlineCode> header on every request.
          Keys are 64-character secrets prefixed by environment.
        </DocP>
        <CodePanel
          title="Header"
          language="http"
          code={`X-API-Key: sk_live_8f3a9c1e4d2b6f7a0c8e5d3b1a4f9e2c8d6b3a7f1e9c5d2b8a4f7e3c1d6b9a2`}
        />
        <Callout>
          The full secret is shown <strong>once</strong> at creation. Store it in a managed
          secrets vault - never commit keys to version control or paste them into client-side
          code. Compromised keys can be revoked instantly from the Developer Centre.
        </Callout>

        <DocH3>Environments</DocH3>
        <ParamTable
          rows={[
            { name: "sk_live_…", type: "production", desc: "Operates on live data, billed against your token balance." },
            { name: "sk_test_…", type: "sandbox",    desc: "Identical surface, no billing, isolated tenants. Test data is purged after 30 days." },
          ]}
        />

        <DocH2 id="scopes">Scopes</DocH2>
        <DocP>
          Each key carries a list of scopes that gate which endpoints it can call. Apply the
          principle of least privilege: a key that only generates evidence packs should not be
          able to revoke webhooks.
        </DocP>
        <ParamTable
          rows={[
            { name: "matches:read",       type: "scope", desc: "Read matches and their state." },
            { name: "matches:write",      type: "scope", desc: "Create, update, and transition matches." },
            { name: "counterparties:read",type: "scope", desc: "Read counterparty profiles and KYB status." },
            { name: "counterparties:write",type:"scope", desc: "Register and update counterparties." },
            { name: "evidence:read",      type: "scope", desc: "Download evidence packs and WaD certificates." },
            { name: "webhooks:write",     type: "scope", desc: "Manage webhook endpoints." },
            { name: "audit:read",         type: "scope", desc: "Read audit logs scoped to your organisation." },
          ]}
        />

        <DocH2 id="user-tokens">Dashboard-initiated calls</DocH2>
        <DocP>
          Endpoints invoked directly from your signed-in dashboard session (for example:
          provisioning a new API key from the Developer Centre) reuse the same{" "}
          <InlineCode>X-API-Key</InlineCode> contract. Session rotation and refresh are
          transparent to integrators.
        </DocP>
        <CodePanel
          title="Header"
          language="http"
          code={`X-API-Key: sk_live_8f3a9c1e4d2b6f7a0c8e5d3b1a4f9e2c8d6b3a7f1e9c5d2b8a4f7e3c1d6b9a2`}
        />

        <DocH2 id="rate-limits">Rate limits</DocH2>
        <DocP>
          Limits are applied per API key and per source IP. Burst headroom is generous; sustained
          abuse is throttled with a <InlineCode>429 Too Many Requests</InlineCode> response and a{" "}
          <InlineCode>Retry-After</InlineCode> header.
        </DocP>
        <ParamTable
          rows={[
            { name: "Default",         type: "1 000 req/min", desc: "Per API key, rolling window." },
            { name: "Discovery",       type: "60 req/min",    desc: "Per organisation, applies to /search and counterparty discovery." },
            { name: "Auth lockout",    type: "10 failures",   desc: "Per key prefix or source IP within 15 minutes triggers a 30-minute lockout." },
          ]}
        />

        <DocH2 id="key-rotation">Key rotation</DocH2>
        <DocP>
          Rotate keys at least every 90 days, or immediately on any suspicion of compromise. The
          recommended pattern is dual-key: provision a new key, deploy it, verify traffic is
          flowing, then revoke the old key. Both keys are accepted concurrently during rotation.
        </DocP>
      </div>
    </DocsLayout>
  );
}
