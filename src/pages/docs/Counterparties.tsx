import { DocsLayout } from "./DocsLayout";
import { DocEyebrow, DocH1, DocH2, DocH3, DocLede, DocP, InlineCode, CodePanel, Callout, ParamTable, EndpointBadge } from "./_shared";

const CREATE_ENTITY = `POST /entities
X-API-Key: sk_live_...
Idempotency-Key: 9f86d081-884c-7d65-9a2f-eaa0c55ad015
Content-Type: application/json

{
  "entity_type": "COMPANY",
  "legal_name": "Glencore Singapore Pte Ltd",
  "jurisdiction_code": "SG",
  "registration_number": "201018262K"
}`;

const UBO_LINK = `POST /authority-bind
X-API-Key: sk_live_...
Content-Type: application/json

{
  "action": "ubo_create",
  "person_entity_id":  "550e8400-e29b-41d4-a716-446655440001",
  "company_entity_id": "550e8400-e29b-41d4-a716-446655440002",
  "ownership_percentage": 51
}`;

export default function DocsCounterparties() {
  return (
    <DocsLayout>
      <div className="max-w-3xl">
        <DocEyebrow>Core resources</DocEyebrow>
        <DocH1>Counterparties</DocH1>
        <DocLede>
          A <strong className="text-foreground font-medium">counterparty record</strong> is a
          verified legal entity your organisation can transact with. Counterparty records
          combine a registered entity, beneficial ownership graph, and Authority-to-Bind
          records to form a single unit of trust the platform can gate settlement against.
        </DocLede>

        <Callout>
          The word <em>counterparty</em> is used in two senses on this platform — keep them
          distinct:
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>
              <strong className="text-foreground">counterparty record</strong> — a verified
              entity in your registry (this page).
            </li>
            <li>
              <strong className="text-foreground">opposite party</strong> — in any specific
              trade, the org sitting in the slot opposite to yours
              (<InlineCode>buyer_org_id</InlineCode> from a seller's perspective,
              <InlineCode>seller_org_id</InlineCode> from a buyer's). This is always
              relative to the viewer.
            </li>
            <li>
              <strong className="text-foreground">named lead</strong> — a contact name or
              email captured during outreach, not yet promoted to a verified counterparty
              record. Named leads cannot satisfy WaD certification.
            </li>
          </ul>
        </Callout>

        <DocH2 id="entities">Entities</DocH2>
        <DocP>
          Every counterparty record starts as an <InlineCode>entity</InlineCode>. Entities are either{" "}
          <InlineCode>INDIVIDUAL</InlineCode> (a natural person) or <InlineCode>COMPANY</InlineCode>{" "}
          (a registered legal person). They carry jurisdiction, registration data, and a
          screening result.
        </DocP>

        <div className="flex items-center gap-3 mb-3">
          <EndpointBadge method="POST" />
          <code className="text-[13.5px] font-mono text-foreground">/entities</code>
        </div>
        <ParamTable
          rows={[
            { name: "entity_type",        type: "enum",   required: true, desc: "INDIVIDUAL | COMPANY." },
            { name: "legal_name",         type: "string", required: true, desc: "2–256 chars. Stored verbatim." },
            { name: "jurisdiction_code",  type: "ISO-3166", required: true, desc: "Two-letter country code." },
            { name: "registration_number",type: "string", desc: "Registry number; used by KYB providers (CIPC, Companies House, etc.)." },
            { name: "tax_number",         type: "string", desc: "VAT or tax registration number." },
          ]}
        />
        <CodePanel title="Request" language="http" code={CREATE_ENTITY} />

        <DocH2 id="ubo">Beneficial ownership (UBO)</DocH2>
        <DocP>
          For company entities, declare every natural person who ultimately owns or controls
          the company. The platform enforces a <strong className="text-foreground font-medium">≥100% verified ownership</strong>{" "}
          gate before any deal is allowed to settle.
        </DocP>
        <CodePanel title="Register a UBO link" language="http" code={UBO_LINK} />
        <DocP>
          UBO links are declared, then verified asynchronously by an admin or compliance
          officer. The <InlineCode>action: "check"</InlineCode> variant returns whether the
          gate currently passes.
        </DocP>

        <DocH2 id="atb">Authority-to-Bind (ATB)</DocH2>
        <DocP>
          Authority-to-Bind records prove that a specific natural person is empowered to commit
          the company to a deal. Acceptable methods include board resolution, power of
          attorney, and registry-published director appointment.
        </DocP>
        <ParamTable
          rows={[
            { name: "action",            type: "enum",   required: true, desc: "atb_create | atb_verify | atb_reject | check" },
            { name: "person_entity_id",  type: "uuid",   required: true, desc: "The natural person being granted authority." },
            { name: "company_entity_id", type: "uuid",   required: true, desc: "The company they're authorised to bind." },
            { name: "method",            type: "string", desc: "resolution | power_of_attorney | director_register" },
            { name: "document_id",       type: "uuid",   desc: "Reference to the supporting document upload." },
          ]}
        />

        <DocH2 id="trade-approval">Trade approval</DocH2>
        <DocP>
          Once entities are screened and the UBO + ATB gates pass, an admin issues a{" "}
          <strong className="text-foreground font-medium">trade approval</strong> for the
          counterparty. Approvals carry a validity window (default 365 days) and a risk band
          inherited from the latest due-diligence score.
        </DocP>

        <Callout variant="warning">
          A counterparty without an active trade approval can appear in discovery results but
          cannot be promoted to <InlineCode>committed</InlineCode> on any match. The Confirm
          Intent call returns <InlineCode>422 TRADE_APPROVAL_MISSING</InlineCode>.
        </Callout>

        <DocH2 id="discovery">Discovery</DocH2>
        <DocP>
          The discovery engine surfaces verified counterparties matching a buyer or seller
          signal. Identity is masked until both parties have engaged. See{" "}
          <a href="/docs/api" className="text-[hsl(var(--emerald))] hover:text-[hsl(var(--emerald))] font-medium">API Reference</a>{" "}
          for the <InlineCode>/search</InlineCode> endpoint and result shape.
        </DocP>

        <DocH3>Engagement hold-point</DocH3>
        <DocP>
          When you initiate engagement with a discovered counterparty, the platform issues a{" "}
          <InlineCode>poi_engagement</InlineCode> record and notifies the counterparty by email.
          Settlement is blocked until they accept; this is a deliberate compliance hold-point,
          not a bug.
        </DocP>
      </div>
    </DocsLayout>
  );
}
