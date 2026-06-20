/**
 * P011 — Public methodology page for the evidence-confidence counterparty rating.
 * Linked from `EvidenceRatingDrawer`.
 */
import { DocsLayout } from "./DocsLayout";
import {
  COUNTERPARTY_RATING_METHODOLOGY_VERSION,
  EVIDENCE_RATING_BAND_LABELS,
  EVIDENCE_RATING_BAND_USER_MEANING,
  EVIDENCE_RATING_DISCLAIMER,
  EVIDENCE_RATING_FRESHNESS_DAYS,
} from "@/lib/evidence-rating";

const BAND_ORDER = [
  "limited_information",
  "public_source_supported",
  "admin_reviewed",
  "verification_complete",
  "flagged",
] as const;

const ALLOWED_INPUTS = [
  "Approved public-source matches (registry, jurisdiction, address, domain, officers)",
  "Completed live KYB / company-registry checks where the provider is marked live and the result is current",
  "Completed live sanctions, PEP or adverse-media screening from a live-marked provider",
  "Completed UBO, director, mandate or authority checks where available and current",
  "Admin review status, admin block status and approved reason codes",
  "Internal platform engagement history (prior POI state, WaD gate state, disputes, evidence events)",
  "Uploaded evidence and document completeness, expiry date and review status",
  "Counterparty response / assignment status",
  "Methodology version and timestamps",
];

const EXCLUDED_INPUTS = [
  "Stub-only providers and key-presence branches",
  "Demo, sandbox and mock provider results",
  "CIPC, Onfido, Dow Jones, Refinitiv until they are live integrations",
  "Manually typed claims without supporting evidence",
  "AI-generated statements unless reviewed and approved as a named evidence input",
  "Expired, stale, failed or incomplete checks",
  "Bank details unless independently verified by an approved live bank-verification source",
  "Client subscription tier, package type, token balance, payment success, commercial value",
  "Private opinions, unsupported comments, internal speculation",
  "Notes not converted into an approved admin reason code",
  "Personal characteristics unrelated to entity verification or transaction integrity",
];

export default function CounterpartyRatingMethodology() {
  return (
    <DocsLayout>
      <article className="prose prose-slate max-w-none">
        <h1>Counterparty Rating Methodology v{COUNTERPARTY_RATING_METHODOLOGY_VERSION}</h1>

        <p className="lead">
          The counterparty rating is an <strong>evidence-confidence signal</strong> showing
          how much current, supporting evidence Izenzo holds about a counterparty. It is
          not a credit assessment, compliance clearance, bank verification, or guarantee
          that a trade will complete.
        </p>

        <h2>The five rating bands</h2>
        <ul>
          {BAND_ORDER.map((b) => (
            <li key={b}>
              <strong>{EVIDENCE_RATING_BAND_LABELS[b]}</strong> —{" "}
              {EVIDENCE_RATING_BAND_USER_MEANING[b]}
            </li>
          ))}
        </ul>

        <h2>Inputs that can affect the rating</h2>
        <ul>
          {ALLOWED_INPUTS.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>

        <h2>Inputs that cannot affect the rating</h2>
        <ul>
          {EXCLUDED_INPUTS.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>

        <h2>Missing and stale data</h2>
        <p>
          If a required input is missing, incomplete, failed or not yet checked, the
          rating defaults to <strong>Limited Information</strong> (unless an active
          negative signal forces <strong>Flagged</strong>). Missing data is never
          treated as positive evidence. Stale inputs remain visible as history but
          cannot support <strong>Verification Complete</strong>.
        </p>

        <h2>Freshness windows</h2>
        <table>
          <thead>
            <tr>
              <th>Input</th>
              <th>Stale after</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Public-source signals</td>
              <td>{EVIDENCE_RATING_FRESHNESS_DAYS.public_source} days</td>
            </tr>
            <tr>
              <td>Sanctions / PEP / adverse-media screening</td>
              <td>{EVIDENCE_RATING_FRESHNESS_DAYS.sanctions_pep} days</td>
            </tr>
            <tr>
              <td>KYB / company-registry verification</td>
              <td>{EVIDENCE_RATING_FRESHNESS_DAYS.kyb_registry} days (or sooner if provider gives shorter expiry)</td>
            </tr>
            <tr>
              <td>UBO / director / mandate / authority checks</td>
              <td>{EVIDENCE_RATING_FRESHNESS_DAYS.ubo_authority} days (or document expiry if earlier)</td>
            </tr>
            <tr>
              <td>Uploaded evidence documents</td>
              <td>{EVIDENCE_RATING_FRESHNESS_DAYS.uploaded_evidence} days (or stated document expiry if earlier)</td>
            </tr>
            <tr>
              <td>Admin review</td>
              <td>{EVIDENCE_RATING_FRESHNESS_DAYS.admin_review} days unless earlier expiry is set</td>
            </tr>
          </tbody>
        </table>

        <h2>Workflow impact</h2>
        <p>
          Ratings are informational for search, match review and POI visibility. They
          do not automatically approve or reject a counterparty, do not block search or
          POI creation, and do not bypass POI, WaD, authority, evidence, compliance or
          finality gates. A <strong>Flagged</strong> rating requires platform admin or
          compliance owner review before WaD progression.{" "}
          <strong>Verification Complete</strong> may support WaD gates only where the
          underlying live checks have passed and are current.
        </p>

        <h2>Why ratings are not guarantees</h2>
        <p>{EVIDENCE_RATING_DISCLAIMER}</p>
      </article>
    </DocsLayout>
  );
}
