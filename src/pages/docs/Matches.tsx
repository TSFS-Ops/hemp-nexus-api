import { DocsLayout } from "./DocsLayout";
import { DocEyebrow, DocH1, DocH2, DocH3, DocLede, DocP, InlineCode, CodePanel, Callout, ParamTable, EndpointBadge } from "./_shared";

const CREATE = `POST /match
X-API-Key: sk_live_...
Idempotency-Key: 9f86d081-884c-7d65-9a2f-eaa0c55ad015
Content-Type: application/json

{
  "buyer":  { "id": "B001", "name": "Aurubis AG" },
  "seller": { "id": "S001", "name": "Glencore Singapore Pte Ltd" },
  "commodity": "Copper Cathode · LME Grade A",
  "quantity": { "amount": 500, "unit": "MT" },
  "price":    { "amount": 9420, "currency": "USD" },
  "terms": "CIF Rotterdam, L/C at sight"
}`;

const RESPONSE = `{
  "id": "match_01HX7Z9K3M2P4Q6R8T0V2X4Y6A",
  "status": "matched",
  "state":  "discovery",
  "hash":   "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "buyer_name":  "Aurubis AG",
  "seller_name": "Glencore Singapore Pte Ltd",
  "commodity":   "Copper Cathode · LME Grade A",
  "quantity_amount": 500,
  "quantity_unit":   "MT",
  "price_amount":    9420,
  "price_currency":  "USD",
  "created_at": "2026-04-18T09:14:22.000Z"
}`;

export default function DocsMatches() {
  return (
    <DocsLayout>
      <div className="max-w-3xl">
        <DocEyebrow>Core resources</DocEyebrow>
        <DocH1>Matches</DocH1>
        <DocLede>
          A match is the canonical record of bilateral trade intent between two organisations.
          Every state transition emits a signed event into the audit ledger, and the final
          settlement produces an evidence pack any auditor can verify offline.
        </DocLede>

        <DocH2 id="lifecycle">Lifecycle</DocH2>
        <DocP>
          The public <InlineCode>/match</InlineCode> resource exposes five deterministic states.
          Transitions are guarded server-side and cannot be skipped or reversed. Internally
          these map onto the POI engine's eight-state machine
          (<InlineCode>DRAFT → PENDING_APPROVAL → ELIGIBLE → COMPLETION_REQUESTED → COMPLETED</InlineCode>,
          plus terminal <InlineCode>EXPIRED</InlineCode>, <InlineCode>REJECTED</InlineCode>,
          <InlineCode>ANNULLED</InlineCode>); the API surfaces the externally-meaningful
          rollup. See{" "}
          <a href="/docs/evidence" className="text-[hsl(var(--emerald))] hover:text-[hsl(var(--emerald))] font-medium">Evidence Packs</a>{" "}
          for the WaD seal that runs on top.
        </DocP>
        <ParamTable
          rows={[
            { name: "discovery",            type: "initial", desc: "Both party slots identified. Terms may still be amended." },
            { name: "intent_declared",      type: "next",    desc: "Initiating party has recorded intent. The opposite-slot org has been notified — single-side acknowledgement, not bilateral acceptance." },
            { name: "counterparty_sighted", type: "next",    desc: "The opposite-slot org has acknowledged the match. Engagement hold-point cleared. Still single-side; not yet committed." },
            { name: "committed",            type: "next",    desc: "At least one party's POI has been recorded. Terms are locked from further client mutation pending counterparty action. The POI is only described as mutual once both parties have confirmed." },
            { name: "completed",            type: "final",   desc: "Without a Doubt (WaD) certificate sealed. Evidence pack downloadable." },
          ]}
        />

        <DocH2 id="create">Create a match</DocH2>
        <div className="flex items-center gap-3 mb-3">
          <EndpointBadge method="POST" />
          <code className="text-[13.5px] font-mono text-foreground">/match</code>
        </div>
        <DocP>
          Records bilateral intent. Both parties must already exist as counterparties in your
          organisation. Pass an <InlineCode>Idempotency-Key</InlineCode> so network retries don't
          create duplicate matches.
        </DocP>

        <DocH3>Required parameters</DocH3>
        <ParamTable
          rows={[
            { name: "buyer.id",        type: "string", required: true,  desc: "Counterparty identifier for the buy side." },
            { name: "buyer.name",      type: "string", required: true,  desc: "Display name; stored verbatim on the audit record." },
            { name: "seller.id",       type: "string", required: true,  desc: "Counterparty identifier for the sell side." },
            { name: "seller.name",     type: "string", required: true,  desc: "Display name." },
            { name: "commodity",       type: "string", required: true,  desc: "Free-form description; commodity taxonomy is applied server-side." },
            { name: "quantity.amount", type: "number", required: true,  desc: "Positive number." },
            { name: "quantity.unit",   type: "string", required: true,  desc: "ISO unit (e.g. MT, BBL, OZ_T)." },
            { name: "price.amount",    type: "number", required: true,  desc: "Per-unit price." },
            { name: "price.currency",  type: "string", required: true,  desc: "ISO 4217 currency code." },
            { name: "terms",           type: "string", desc: "Optional commercial terms (Incoterms, payment, inspection)." },
            { name: "metadata",        type: "object", desc: "Up to 8 KB of arbitrary key/value pairs returned verbatim on read." },
          ]}
        />

        <CodePanel title="Request" language="http" code={CREATE} />
        <CodePanel title="Response · 200" language="json" code={RESPONSE} />

        <Callout variant="warning">
          Once a match enters <InlineCode>committed</InlineCode>, terms are sealed in the
          collapse ledger and cannot be amended. Create a new match if commercial terms need to
          change.
        </Callout>

        <DocH2 id="retrieve">Retrieve a match</DocH2>
        <div className="flex items-center gap-3 mb-3">
          <EndpointBadge method="GET" />
          <code className="text-[13.5px] font-mono text-foreground">/match/:id</code>
        </div>
        <DocP>
          Returns the canonical match record including current state, hash, and embedded
          references to the orgs in each slot (<InlineCode>buyer_org_id</InlineCode> and{" "}
          <InlineCode>seller_org_id</InlineCode>). Both slots are absolute — what counts as
          "the counterparty" is always derived relative to the viewer's own slot.
        </DocP>

        <DocH2 id="confirm-intent">Mint Proof of Intent (POI)</DocH2>
        <div className="flex items-center gap-3 mb-3">
          <EndpointBadge method="POST" />
          <code className="text-[13.5px] font-mono text-foreground">/match/:id/settle</code>
        </div>
        <DocP>
          Advances a match to <InlineCode>committed</InlineCode> and, once both sides have
          minted, on to <InlineCode>completed</InlineCode>. Internally this is a single
          operation referred to in three places by three names — they are the same call:
          <strong className="text-foreground font-medium"> POI mint</strong> (engine layer),
          <strong className="text-foreground font-medium"> /settle</strong> (REST verb), and
          <strong className="text-foreground font-medium"> Confirm Intent</strong> (UI label).
          The call burns 1 credit (1 credit = $1 USD) from your balance, generates the Proof
          of Intent payload + SHA-256 hash, writes the collapse-ledger entry, and triggers the{" "}
          <InlineCode>poi.generated</InlineCode> webhook. When both sides have minted, the WaD
          gates run and <InlineCode>wad.sealed</InlineCode> fires.
        </DocP>
        <Callout>
          POI mint is a hold-point: the call returns <InlineCode>409 ENGAGEMENT_PENDING</InlineCode>{" "}
          until the org in the opposite slot has accepted the engagement. Acceptance is
          single-side and is <em>not</em> the same as bilateral commitment — both parties
          must mint POI for the match to reach <InlineCode>committed</InlineCode>. See{" "}
          <a href="/docs/counterparties" className="text-[hsl(var(--emerald))] hover:text-[hsl(var(--emerald))] font-medium">Counterparties</a>{" "}
          for the engagement flow.
        </Callout>

        <DocH2 id="list">List matches</DocH2>
        <div className="flex items-center gap-3 mb-3">
          <EndpointBadge method="GET" />
          <code className="text-[13.5px] font-mono text-foreground">/matches</code>
        </div>
        <DocP>
          Paginated. Filter by <InlineCode>status</InlineCode>, <InlineCode>commodity</InlineCode>,
          and date range. Results are scoped to the calling key's organisation.
        </DocP>
      </div>
    </DocsLayout>
  );
}
