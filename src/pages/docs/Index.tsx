import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Code, Zap, Shield, Webhook, FileCheck } from "lucide-react";
import { DocsLayout } from "./DocsLayout";
import { DocEyebrow, DocH1, DocLede } from "./_shared";

const QUICK_LINKS = [
  {
    to: "/docs/quickstart",
    icon: Zap,
    title: "Quickstart",
    desc: "Issue an API key and make your first authenticated call in under five minutes.",
  },
  {
    to: "/docs/authentication",
    icon: Shield,
    title: "Authentication",
    desc: "API keys, scopes, rate limits, and the lockout policy.",
  },
  {
    to: "/docs/webhooks",
    icon: Webhook,
    title: "Webhooks",
    desc: "Signed HMAC-SHA256 callbacks for state changes, with automatic retries and dead-letter queue.",
  },
  {
    to: "/docs/api",
    icon: Code,
    title: "API Reference",
    desc: "Every endpoint, parameter, response shape, and error code.",
  },
];

const CONCEPTS = [
  {
    to: "/docs/matches",
    icon: FileCheck,
    title: "Matches",
    desc: "Bilateral trade intent between two verified organisations. State machine, transitions, terms.",
  },
  {
    to: "/docs/counterparties",
    icon: BookOpen,
    title: "Counterparties",
    desc: "Verified organisations you can transact with. KYB, UBO, Authority-to-Bind.",
  },
  {
    to: "/docs/evidence",
    icon: FileCheck,
    title: "Evidence Packs",
    desc: "Append-only, SHA-256-sealed audit record for every settled deal. Includes WaD certificate.",
  },
  {
    to: "/docs/webhooks",
    icon: Webhook,
    title: "Webhooks",
    desc: "Signed HTTP callbacks for state changes. HMAC-SHA256 verification, automatic retries.",
  },
];

export default function DocsIndex() {
  return (
    <DocsLayout>
      <div className="max-w-3xl">
        <DocEyebrow>Documentation</DocEyebrow>
        <DocH1>Izenzo Developer Docs</DocH1>
        <DocLede>
          Izenzo is governance infrastructure for cross-border trade. Use the API to verify
          counterparties, record bilateral intent, generate cryptographically sealed Proof of
          Intent, and produce tamper-evident evidence packs your auditors can verify offline.
        </DocLede>

        <div className="grid sm:grid-cols-2 gap-4 mb-16">
          {QUICK_LINKS.map(({ to, icon: Icon, title, desc }) => (
            <Link
              key={to}
              to={to}
              className="group block p-6 rounded-xl border border-border bg-card hover:border-border hover:shadow-sm transition-all"
            >
              <Icon className="h-5 w-5 text-[hsl(var(--emerald))] mb-4" strokeWidth={1.75} />
              <h3 className="text-[15px] font-semibold text-foreground mb-1.5 tracking-tight">
                {title}
              </h3>
              <p className="text-[13.5px] text-muted-foreground leading-relaxed mb-4">{desc}</p>
              <span className="inline-flex items-center gap-1 text-[13px] font-medium text-[hsl(var(--emerald))] group-hover:gap-1.5 transition-all">
                Open <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}
        </div>

        <section className="border-t border-border pt-12 mb-16">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground mb-3">
            Core resources
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-6 max-w-2xl">
            Every API call manipulates one of four primitives. Read these once and the rest of
            the surface area follows naturally.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            {CONCEPTS.map(({ to, icon: Icon, title, desc }) => (
              <Link
                key={to}
                to={to}
                className="group block p-5 rounded-xl border border-border bg-card hover:border-border transition-all"
              >
                <div className="flex items-start gap-3">
                  <Icon className="h-4 w-4 text-muted-foreground/70 mt-1 shrink-0" strokeWidth={1.75} />
                  <div>
                    <h3 className="text-[14px] font-semibold text-foreground mb-1 tracking-tight">
                      {title}
                    </h3>
                    <p className="text-[13px] text-muted-foreground leading-relaxed">{desc}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="border-t border-border pt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground mb-3">
            Base URL & versioning
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-3 max-w-2xl">
            All endpoints are served from a single base URL. The API is unversioned at the path
            level; backwards-incompatible changes are announced 90 days in advance via the
            developer changelog and your account contact.
          </p>
          <pre className="bg-slate-950 text-slate-100 rounded-lg p-4 text-[13px] font-mono leading-relaxed overflow-x-auto">
            <code>https://api.trade.izenzo.co.za/functions/v1</code>
          </pre>
        </section>
      </div>
    </DocsLayout>
  );
}
