import { Helmet } from "react-helmet-async";
import { PublicPageLayout } from "@/components/PublicPageLayout";

/**
 * Trust & Privacy — app-owned customer-facing page.
 *
 * Editable project content maintained by Starfair162 (Pty) Ltd t/a Izenzo.
 * Not Lovable-certified or independently verified. Describes enabled
 * platform capabilities and current app-owner practices only.
 */
export default function Trust() {
  const lastUpdated = "21 June 2026";

  return (
    <PublicPageLayout>
      <Helmet>
        <title>Trust, Security & Privacy — Izenzo</title>
        <meta
          name="description"
          content="How Izenzo handles access control, hosting, data, retention, subprocessors, and privacy requests. Maintained by the Izenzo team."
        />
        <link rel="canonical" href="https://trade.izenzo.co.za/trust" />
      </Helmet>

      <article className="max-w-[880px] mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <header className="mb-10 pb-8 border-b border-border">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
            Trust Surface
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground mb-4">
            Trust, security &amp; privacy
          </h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            This page is maintained by Starfair162 (Pty) Ltd t/a Izenzo to answer common
            security and privacy questions about the Izenzo Trade Desk and Registry.
            It describes controls currently enabled in the app, the hosting platform
            we build on, and how the Izenzo team handles your data. It is not an
            independent certification.
          </p>
          <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground/60 mt-4">
            Last updated: {lastUpdated}
          </p>
        </header>

        <Section title="Shared responsibility">
          <p>
            Izenzo is built on a managed cloud backend (database, authentication, file
            storage, and serverless functions). The platform provider operates the
            underlying infrastructure. Izenzo configures application-level access rules,
            workflows and integrations on top of it, and you — as the account holder —
            remain responsible for protecting your sign-in credentials, the
            counterparties you invite, and the information you choose to upload.
          </p>
        </Section>

        <Section title="Access &amp; authentication">
          <ul className="list-disc pl-5 space-y-2">
            <li>Email + password sign-in with managed password reset flows.</li>
            <li>Server-side session management; sessions expire and can be revoked.</li>
            <li>Role-based access (platform admin, compliance owner, organisation admin, member, auditor) enforced in the database.</li>
            <li>Row-level security policies scope every organisation's records so members of one organisation cannot read another organisation's data.</li>
            <li>Sensitive operational tables (raw import data, provenance, internal readiness state) are restricted to platform admin and compliance owner roles.</li>
          </ul>
        </Section>

        <Section title="Platform &amp; hosting context">
          <ul className="list-disc pl-5 space-y-2">
            <li>Application data is stored in a managed Postgres database with row-level security enabled.</li>
            <li>Uploaded files are stored in managed object storage with per-object access policies.</li>
            <li>Server-side logic runs in serverless functions invoked over HTTPS.</li>
            <li>All client ↔ server traffic is served over TLS.</li>
          </ul>
        </Section>

        <Section title="Data we collect &amp; how it is used">
          <ul className="list-disc pl-5 space-y-2">
            <li>Account profile information (name, email, organisation).</li>
            <li>Trade Request, Counterparty and Proof of Intent records you create.</li>
            <li>Evidence documents you upload to support a match or claim.</li>
            <li>Audit events generated as you act on records (used for governance, dispute handling and regulatory traceability).</li>
          </ul>
          <p className="mt-3">
            We use this data to operate the service, fulfil compliance obligations on
            transactions you initiate, and improve product reliability. We do not sell
            personal data.
          </p>
        </Section>

        <Section title="Retention &amp; deletion">
          <ul className="list-disc pl-5 space-y-2">
            <li>Trade and compliance records follow a documented lifecycle and are retained for the period required to meet audit and regulatory obligations.</li>
            <li>Account holders can request deletion of their account from within the app; account self-deletion follows a 30-day grace window and then anonymises personal fields.</li>
            <li>Records under an active legal hold or dispute are preserved until the matter is resolved, after which standard retention applies.</li>
          </ul>
        </Section>

        <Section title="Subprocessors &amp; integrations">
          <p>
            Izenzo relies on the managed cloud backend that hosts the application,
            database, authentication and storage layers. Specific third-party services
            (for example identity verification, registry lookups, payment settlement,
            transactional email) are engaged for the workflow you trigger. A current
            list of subprocessors is available on request.
          </p>
        </Section>

        <Section title="Cookies &amp; analytics">
          <p>
            Izenzo uses cookies and similar storage required to keep you signed in and
            to remember basic UI preferences. Product analytics, if enabled, are used
            in aggregate to understand which workflows are used; we do not use this
            data for cross-site advertising.
          </p>
        </Section>

        <Section title="Privacy requests">
          <p>
            To request access to, correction of, export of, or deletion of your
            personal data, email{" "}
            <a className="underline hover:text-foreground" href="mailto:privacy@izenzo.co.za">
              privacy@izenzo.co.za
            </a>
            . We will acknowledge requests within a reasonable timeframe and respond in
            line with applicable South African data-protection law (POPIA).
          </p>
        </Section>

        <Section title="Security contact &amp; vulnerability reporting">
          <p>
            If you believe you have found a security issue, please report it privately
            to{" "}
            <a className="underline hover:text-foreground" href="mailto:security@izenzo.co.za">
              security@izenzo.co.za
            </a>
            . Please do not publicly disclose the issue before we have had a reasonable
            opportunity to investigate and remediate. We appreciate coordinated
            disclosure and will keep reporters informed of progress.
          </p>
        </Section>

        <Section title="Compliance &amp; certifications">
          <p>
            Izenzo operates as a South African private company. We align internal
            controls with POPIA obligations for the personal data we process. We do
            not currently claim SOC 2, ISO 27001, PCI-DSS or HIPAA certification; if
            you require a specific compliance statement for procurement, contact{" "}
            <a className="underline hover:text-foreground" href="mailto:compliance@izenzo.co.za">
              compliance@izenzo.co.za
            </a>
            .
          </p>
        </Section>

        <footer className="mt-12 pt-6 border-t border-border">
          <p className="text-[11px] font-mono text-muted-foreground/60 leading-relaxed">
            This page is editable project content maintained by the Izenzo team. It is
            not independently verified or certified by any third party. Capabilities
            described reflect the production configuration on the date above and may
            change as the product evolves.
          </p>
        </footer>
      </article>
    </PublicPageLayout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold tracking-tight text-foreground mb-3">
        {title}
      </h2>
      <div className="text-[14px] leading-relaxed text-muted-foreground space-y-3">
        {children}
      </div>
    </section>
  );
}
