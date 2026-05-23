/**
 * Pricing, Institutional infrastructure framing.
 *
 * Two-track pricing in the same "Emerald & Airy" Stripe aesthetic as the
 * product pages: pay-as-you-go for operators ($1 USD per credit, charged in
 * USD natively via Paystack) and a custom Institutional tier
 * for banks, DFIs, and sovereigns.
 * a custom Institutional tier for banks, DFIs, and sovereigns.
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  ShieldCheck,
  Globe,
  Activity,
} from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";
import { PageFooter } from "@/components/PageFooter";

/* ───────────────────────── BACKDROP ───────────────────────── */

function PrecisionGrid({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{
        backgroundImage:
          "linear-gradient(to right, rgba(15,23,42,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.04) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
        maskImage:
          "radial-gradient(ellipse at center, rgba(0,0,0,0.85) 0%, transparent 75%)",
      }}
    />
  );
}

function EmeraldWhisper() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute -top-32 left-1/2 -translate-x-1/2 h-[680px] w-[1100px] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(16,185,129,0.12) 0%, rgba(16,185,129,0.04) 40%, transparent 70%)",
        }}
      />
      <div
        className="absolute top-40 right-0 h-[420px] w-[520px] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(5,150,105,0.08) 0%, transparent 70%)",
        }}
      />
    </div>
  );
}

/* ───────────────────────── DATA ───────────────────────── */

const PAYG_FEATURES = [
  "Live Match Compiler",
  "Admin-controlled KYB and sanctions screening workflow",
  "SHA-256 hashed Proof of Intent",
  "Standard API Access",
];

const INSTITUTIONAL_FEATURES = [
  "Audit Ledger API Access",
  "Custom Sanctions Matrix",
  "Dedicated Infrastructure & SLA",
  "Enterprise Account Manager",
];

const ALWAYS_INCLUDED = [
  {
    icon: ShieldCheck,
    title: "Cryptographic Hashing",
    desc: "SHA-256 hash recorded on critical state transitions. Coverage is being progressively hardened.",
  },
  {
    icon: Globe,
    title: "Sanctions Screening Workflow",
    desc: "Periodic OFAC, EU, UK HMT, and DPL background screening on configured cadence.",
  },
  {
    icon: Activity,
    title: "Platform Health",
    desc: "Internal platform-health monitoring. Public status feed is in development.",
  },
];

/* ───────────────────────── PAGE ───────────────────────── */

export default function Pricing() {
  return (
    <div className="min-h-screen bg-card text-foreground">
      <PublicHeader />

      {/* ════════════════ HERO ════════════════ */}
      <section className="relative overflow-hidden">
        <EmeraldWhisper />
        <PrecisionGrid />
        <div className="relative max-w-5xl mx-auto px-6 lg:px-12 pt-32 pb-20 lg:pt-44 lg:pb-28 text-center">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--emerald)/0.2)] bg-[hsl(var(--emerald-muted))]/70 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.18em] text-[hsl(var(--emerald))]"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--emerald))]" />
            Pricing
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="mt-8 text-3xl sm:text-4xl md:text-5xl lg:text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tighter leading-[1.05] text-foreground"
          >
            Infrastructure pricing.
            <br />
            <span className="text-[hsl(var(--emerald))]">Scalable and predictable.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12 }}
            className="mt-8 max-w-2xl mx-auto text-lg text-muted-foreground leading-relaxed"
          >
            Pay only for the Proof-of-Intent records you mint. No opaque
            licenses, no hidden fees. Volume pricing available for institutions.
          </motion.p>
        </div>
      </section>

      {/* ════════════════ PRICING CARDS ════════════════ */}
      <section className="relative">
        <div className="relative max-w-5xl mx-auto px-6 lg:px-12 pb-24 lg:pb-32">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* ── CARD 1: Pay-as-you-go ── */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5 }}
              className="relative rounded-2xl border border-border bg-card p-10 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-[0_8px_30px_rgba(15,23,42,0.06)] transition-shadow"
            >
              <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                Pay-as-you-go
              </div>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
                Operators &amp; Traders
              </h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                For trading desks and corporates executing verified
                cross-border matches.
              </p>

              <div className="mt-10 flex items-baseline gap-2">
                <span className="text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tighter text-foreground">
                  $1.00
                </span>
                <span className="rounded-md border border-[hsl(var(--emerald)/0.2)] bg-[hsl(var(--emerald-muted))] px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider text-[hsl(var(--emerald))]">
                  USD
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">per credit · 1 credit = 1 Trade Request</p>
              <ul className="mt-4 space-y-1 text-xs text-muted-foreground font-mono">
                <li>10 credits — $10 (standard)</li>
                <li>50 credits — $45 <span className="text-[hsl(var(--emerald))]">(10% saving)</span></li>
                <li>200 credits — $160 <span className="text-[hsl(var(--emerald))]">(20% saving)</span></li>
              </ul>

              <Link
                to="/auth"
                className="group mt-10 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[hsl(var(--emerald))] px-6 py-3.5 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 hover:bg-[hsl(var(--emerald))] hover:shadow-emerald-700/30 transition-all"
              >
                Provision Workspace
                <ArrowRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  strokeWidth={2}
                />
              </Link>

              <div className="mt-10 h-px bg-muted" />

              <ul className="mt-8 space-y-3.5">
                {PAYG_FEATURES.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-3 text-sm text-muted-foreground"
                  >
                    <Check
                      className="mt-0.5 h-4 w-4 flex-shrink-0 text-[hsl(var(--emerald))]"
                      strokeWidth={2.5}
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </motion.div>

            {/* ── CARD 2: Institutional ── */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, delay: 0.08 }}
              className="relative rounded-2xl border border-slate-900/90 bg-slate-950 p-10 text-white shadow-[0_8px_30px_rgba(15,23,42,0.18)]"
            >
              <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.18em] text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Institutional
              </div>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight">
                Banks, DFIs &amp; Sovereigns
              </h3>
              <p className="mt-2 text-sm text-muted-foreground/50 leading-relaxed">
                For public development banks and trade finance underwriters
                requiring oversight.
              </p>

              <div className="mt-10 flex items-baseline gap-2">
                <span className="text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tighter">
                  Custom
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground/70">tailored to your volume</p>

              <a
                href="mailto:support@izenzo.co.za"
                className="group mt-10 inline-flex w-full items-center justify-center gap-2 rounded-md border border-white/15 bg-card/5 px-6 py-3.5 text-sm font-medium text-white hover:bg-card/10 hover:border-white/25 transition-all backdrop-blur"
              >
                Contact Sales
                <ArrowRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  strokeWidth={2}
                />
              </a>

              <div className="mt-10 h-px bg-card/10" />

              <ul className="mt-8 space-y-3.5">
                {INSTITUTIONAL_FEATURES.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-3 text-sm text-slate-200"
                  >
                    <Check
                      className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400"
                      strokeWidth={2.5}
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>

          {/* Footnote */}
          <p className="mt-10 text-center text-xs text-muted-foreground">
            All prices in USD. Charged in USD at checkout via Paystack.
            Pay-as-you-go billed per successful Proof of Intent.
            Institutional contracts include volume commitments and dedicated SLAs.
          </p>
        </div>
      </section>

      {/* ════════════════ ALWAYS INCLUDED ════════════════ */}
      <section className="relative bg-muted/50 border-y border-border">
        <div className="relative max-w-6xl mx-auto px-6 lg:px-12 py-12 sm:py-16 md:py-24 lg:py-32">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              Always included
            </div>
            <h2 className="mt-6 text-3xl lg:text-4xl font-semibold tracking-tighter text-foreground">
              Every plan ships with the platform foundation.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {ALWAYS_INCLUDED.map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
                className="rounded-xl border border-border bg-card p-7 hover:border-border transition-colors"
              >
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[hsl(var(--emerald-muted))] text-[hsl(var(--emerald))]">
                  <item.icon className="h-4.5 w-4.5" strokeWidth={2} />
                </div>
                <h3 className="mt-5 text-base font-semibold tracking-tight text-foreground">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {item.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════ CLOSING CTA ════════════════ */}
      <section className="relative overflow-hidden">
        <EmeraldWhisper />
        <div className="relative max-w-4xl mx-auto px-6 lg:px-12 py-16 sm:py-24 md:py-32 text-center">
          <h2 className="text-3xl lg:text-4xl font-semibold tracking-tighter leading-[1.05] text-foreground">
            Not sure which tier fits?
          </h2>
          <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Speak to our institutional team. We'll size the right contract for
            your trade volume and governance requirements.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <a
              href="mailto:support@izenzo.co.za"
              className="group inline-flex items-center gap-2 rounded-md bg-slate-900 px-6 py-3.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
            >
              Contact Sales
              <ArrowRight
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                strokeWidth={2}
              />
            </a>
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 rounded-md px-6 py-3.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Start with pay-as-you-go
              <ArrowRight className="h-4 w-4 opacity-60" strokeWidth={2} />
            </Link>
          </div>
        </div>
      </section>

      <PageFooter />
    </div>
  );
}
