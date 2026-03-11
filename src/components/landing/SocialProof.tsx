/**
 * Social proof / trust section — Stripe-style industry sectors.
 * Placeholder logos represented as text badges for now.
 */

import { ArrowRight } from "lucide-react";

const SECTORS = [
  {
    name: "Mining & Metals",
    description: "Copper, lithium, cobalt, and manganese corridors across Sub-Saharan Africa.",
    stat: "Supported sector",
  },
  {
    name: "Agriculture & Soft Commodities",
    description: "Soybean, maize, and cashew supply chains from East and Southern Africa.",
    stat: "Supported sector",
  },
  {
    name: "Carbon & Environmental Markets",
    description: "Voluntary carbon credits, CDRs, and renewable energy certificates.",
    stat: "Supported sector",
  },
];

const TRUST_SIGNALS = [
  "SADC Trade Corridor",
  "AfCFTA Aligned",
  "FATF Compliant",
  "ISO 27001 Ready",
  "POPIA Compliant",
];

export function SocialProof() {
  return (
    <section className="relative py-20 sm:py-28 px-4 sm:px-6 border-t border-border overflow-hidden">
      {/* Subtle diagonal lines */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.02] dark:opacity-[0.035]"
        aria-hidden="true"
        style={{
          backgroundImage: `repeating-linear-gradient(45deg, hsl(var(--foreground)) 0, hsl(var(--foreground)) 1px, transparent 0, transparent 50%)`,
          backgroundSize: "48px 48px",
        }}
      />
      <div className="max-w-[1280px] mx-auto relative z-10">
        <div className="max-w-xl mb-14 animate-fade-up">
          <span className="text-[10px] font-mono uppercase tracking-widest text-primary mb-3 block">
            Trusted Across Industries
          </span>
          <h2 className="text-foreground tracking-tighter mb-4">
            Powering trade formation across high-value sectors.
          </h2>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            Izenzo infrastructure adapts to the compliance and governance requirements
            of each sector — from mineral extraction to carbon markets.
          </p>
        </div>

        {/* Sector cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-0 border border-border mb-12">
          {SECTORS.map((sector, i) => (
            <div
              key={sector.name}
              className={`p-6 sm:p-8 group hover:bg-accent/20 transition-colors duration-300 animate-fade-up
                         ${i > 0 ? "sm:border-l border-t sm:border-t-0 border-border" : ""}`}
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <h3 className="text-foreground mb-2 tracking-tighter">{sector.name}</h3>
              <p className="text-[12px] text-muted-foreground leading-relaxed mb-4">
                {sector.description}
              </p>
              <div className="flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal-verified" />
                <span className="text-[10px] font-mono text-signal-verified uppercase tracking-widest">
                  {sector.stat}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Trust badges */}
        <div className="flex flex-wrap items-center gap-3 animate-fade-up delay-300">
          {TRUST_SIGNALS.map((signal) => (
            <span
              key={signal}
              className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/50
                       border border-border px-3 py-1.5 hover:border-primary/30
                       hover:text-muted-foreground transition-all duration-200"
            >
              {signal}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
