/**
 * 4-card capabilities grid — Stripe-style product showcase.
 * Each card has an icon, title, description, and a subtle hover lift.
 */

import { Search, FileSignature, ShieldCheck, Archive } from "lucide-react";

const CAPABILITIES = [
  {
    icon: Search,
    title: "Counterparty Discovery",
    subtitle: "Search across verified data sources",
    description:
      "Query registered counterparties across commodities, corridors, and jurisdictions. Every result is backed by a verified data source — not a marketplace listing.",
    label: "DISCOVERY",
  },
  {
    icon: FileSignature,
    title: "Intent Signalling",
    subtitle: "Publish governed Proof-of-Intention",
    description:
      "Signal buy or sell intent with a cryptographically signed POI. Your interest becomes a verifiable, governed record — not a soft enquiry that disappears.",
    label: "POI ENGINE",
  },
  {
    icon: ShieldCheck,
    title: "Compliance Workflows",
    subtitle: "Eligibility, KYC, and sanctions screening",
    description:
      "Automated eligibility checks, sanctions screening, and multi-role approval workflows. Every compliance decision is logged with a tamper-evident audit trail.",
    label: "COMPLIANCE",
  },
  {
    icon: Archive,
    title: "Evidence Packs",
    subtitle: "Immutable transaction proof",
    description:
      "Generate court-grade evidence packs for every stage of intent formation. Hash-linked documents, attestations, and governance checkpoints — all exportable.",
    label: "EVIDENCE",
  },
];

export function CapabilitiesGrid() {
  return (
    <section className="py-20 sm:py-28 px-4 sm:px-6 border-t border-border">
      <div className="max-w-[1280px] mx-auto">
        <div className="max-w-xl mb-14 animate-fade-up">
          <span className="text-[10px] font-mono uppercase tracking-widest text-primary mb-3 block">
            Platform Capabilities
          </span>
          <h2 className="text-foreground tracking-tighter mb-4">
            Modular infrastructure for every stage of trade formation.
          </h2>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            Four interconnected modules designed to work individually or together —
            from first search to settlement-ready evidence.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 border border-border">
          {CAPABILITIES.map((cap, i) => {
            const Icon = cap.icon;
            return (
              <div
                key={cap.label}
                className={`p-6 sm:p-8 group transition-colors duration-300 hover:bg-accent/30
                           animate-fade-up
                           ${i % 2 === 1 ? "sm:border-l border-border" : ""}
                           ${i >= 2 ? "border-t border-border" : ""}`}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-9 w-9 border border-border flex items-center justify-center
                                group-hover:border-primary/40 group-hover:bg-primary/[0.04] transition-all duration-300">
                    <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors duration-300" />
                  </div>
                  <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/50">
                    {cap.label}
                  </span>
                </div>
                <h3 className="text-foreground mb-1 tracking-tighter">{cap.title}</h3>
                <p className="text-[11px] font-medium text-primary/70 mb-3">{cap.subtitle}</p>
                <p className="text-[12px] text-muted-foreground leading-relaxed">{cap.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
