import { DocsLayout } from "./DocsLayout";
import { DocEyebrow, DocH1, DocH2, DocH3, DocLede, DocP, InlineCode, CodePanel, Callout, ParamTable, EndpointBadge } from "./_shared";

const FETCH_PACK = `GET /evidence-pack/:matchId
X-API-Key: sk_live_...`;

const PACK_RESPONSE = `{
  "metadata": {
    "packId":      "pack_2025_04_18_glencore_iz_004",
    "generatedAt": "2026-04-18T09:42:17.000Z",
    "format":      "WaD/A v1.2"
  },
  "packHash":      "a3f5b8d2c4e7f1a9b6d8e2c5f7a4b1d9e6c3f8a2b5d7e1c4f9a6b3d8e2c5f7a4",
  "hashAlgorithm": "SHA-256",
  "signatureValidation": {
    "hasCollapseRecord": true,
    "signatureValid":    true,
    "signatureKeyId":    "izenzo-gov-key-2025-q2-01"
  },
  "chainVerification": { "valid": true, "eventCount": 12 },
  "canonical": {
    "match":     { "...": "..." },
    "documents": [ { "sha256_hash": "...", "filename": "Sale_Contract.pdf" } ],
    "events":    [ { "event_type": "match_created", "payload_hash": "...", "created_at": "..." } ]
  }
}`;

const VERIFY_OFFLINE = `# 1. Compute the SHA-256 of the canonical block
echo -n '{"match":{...},"documents":[...],"events":[...]}' | sha256sum

# 2. Compare to packHash. If they match, the pack hasn't been tampered with.

# 3. Verify the signature using the published public key.
#    Public keys are rotated quarterly; signatureKeyId tells you which to use.`;

export default function DocsEvidence() {
  return (
    <DocsLayout>
      <div className="max-w-3xl">
        <DocEyebrow>Core resources</DocEyebrow>
        <DocH1>Evidence Packs</DocH1>
        <DocLede>
          Every settled match produces an evidence pack: an append-only, SHA-256-sealed record
          of the deal, every supporting document, every event in the lifecycle, and the
          collapse ledger entry that ends it. Packs are designed to be verifiable offline by an
          auditor without any access to Izenzo infrastructure.
        </DocLede>

        <DocH2 id="anatomy">Anatomy of a pack</DocH2>
        <ParamTable
          rows={[
            { name: "metadata",            type: "object", desc: "Pack ID, generation timestamp, format version (WaD/A v1.2)." },
            { name: "packHash",            type: "sha256", desc: "Deterministic hash of the canonical block. Recompute locally to verify integrity." },
            { name: "signatureValidation", type: "object", desc: "Whether a collapse-ledger row exists, whether the signature verifies, and the signing key ID." },
            { name: "timestampMetadata",   type: "object", desc: "Server, NTP source, drift in ms, client and server timestamps." },
            { name: "chainVerification",   type: "object", desc: "Hash-chain integrity result and the count of events sealed into the pack." },
            { name: "canonical.match",     type: "object", desc: "The frozen match record at settlement time." },
            { name: "canonical.documents", type: "array",  desc: "Hashes and filenames of every supporting document." },
            { name: "canonical.events",    type: "array",  desc: "Every state transition, sanctions screen, KYC verification, and ATB binding." },
            { name: "canonical.collapse",  type: "object", desc: "The signed collapse-ledger entry that closed the deal." },
          ]}
        />

        <DocH2 id="fetch">Download a pack</DocH2>
        <div className="flex items-center gap-3 mb-3">
          <EndpointBadge method="GET" />
          <code className="text-[13.5px] font-mono text-foreground">/evidence-pack/:matchId</code>
        </div>
        <DocP>
          Returns the full pack as JSON. The match must be in <InlineCode>completed</InlineCode>{" "}
          state. Requires the <InlineCode>evidence:read</InlineCode> scope.
        </DocP>
        <CodePanel title="Request" language="http" code={FETCH_PACK} />
        <CodePanel title="Response · 200" language="json" code={PACK_RESPONSE} />

        <DocH2 id="wad">WaD certificate</DocH2>
        <DocP>
          Settlement runs through the Without a Doubt (WaD) issuance engine, which enforces ten
          deterministic hard-gates. Every gate must pass before a match can complete; the
          evidence pack records the result of each.
        </DocP>
        <ParamTable
          rows={[
            { name: "1. POI_STATE",              type: "gate", desc: "Match is in committed state with both parties' Proof of Intent recorded." },
            { name: "2. ENTITY_STATUS",          type: "gate", desc: "Both buyer and seller entities are VERIFIED and unblocked." },
            { name: "3. UBO_COMPLETENESS",       type: "gate", desc: "Verified beneficial ownership ≥ 100% for both parties." },
            { name: "4. AUTHORITY_TO_BIND",      type: "gate", desc: "An active, verified ATB record exists for the signing party on each side." },
            { name: "5. JURISDICTION_SELECTION", type: "gate", desc: "Origin and destination jurisdictions resolved and not on the embargo register." },
            { name: "6. GOVERNANCE_DOCUMENTS",   type: "gate", desc: "All mandatory governance documents validated and on file." },
            { name: "7. COMPLIANCE_CLEAR",       type: "gate", desc: "Zero open compliance cases against either party." },
            { name: "8. CREDIT_BALANCE",         type: "gate", desc: "Sufficient credit balance to cover the settlement burn. (Wire identifier remains INSUFFICIENT_TOKENS for API contract stability.)" },
            { name: "9. SCREENING_RECENTNESS",   type: "gate", desc: "Sanctions / PEP screening for both parties is within the 30-day freshness window." },
            { name: "10. WEBHOOK_CONNECTIVITY",  type: "gate", desc: "Neither party's primary webhook endpoint is auto-disabled. Sealing requires a live notification channel on each side." },
          ]}
        />
        <Callout variant="warning">
          A failed gate returns <InlineCode>422</InlineCode> with a <InlineCode>denial_reasons</InlineCode>{" "}
          array naming the failed gate(s). Re-issue settlement once the underlying condition is
          remediated; nothing is partially recorded.
        </Callout>

        <DocH2 id="verify">Verify a pack offline</DocH2>
        <DocP>
          The pack is self-contained. An auditor can verify integrity without calling the API at
          all.
        </DocP>
        <CodePanel title="Verification recipe" language="bash" code={VERIFY_OFFLINE} />
        <DocP>
          Public signing keys are published at <InlineCode>/.well-known/izenzo-signing-keys.json</InlineCode>.
          Keys rotate quarterly; old keys remain valid for verification of historical packs
          indefinitely.
        </DocP>

        <DocH3>Retention</DocH3>
        <DocP>
          Evidence packs are retained online for seven years from settlement, then archived to
          immutable cold storage. The cold-storage manifest is available on request and the
          packs themselves remain hash-verifiable in perpetuity.
        </DocP>
      </div>
    </DocsLayout>
  );
}
