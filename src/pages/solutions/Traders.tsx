/**
 * Solutions, Commodity Traders & Corporates.
 *
 * Same "Emerald & Airy" Stripe-Infrastructure aesthetic as the Product pages.
 * Persona-targeted copy (Speed & Execution) wrapped around the live
 * MatchCompiler-style Certificate of Intent mockup.
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, ShieldCheck, Lock, FileText, Search, Zap } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";
import { PageFooter } from "@/components/PageFooter";
import { DEMO_COMPILER_TERMS, DEMO_COMPILER_DOCS, DEMO_COMPILER_SEAL } from "@/components/desk/_demo/fixtures";

/* ───────────────────────── BACKDROP PIECES ───────────────────────── */

function PrecisionGrid() {
  return <div aria-hidden className="pointer-events-none absolute inset-0" style={{
    backgroundImage: "linear-gradient(to right, rgba(15,23,42,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.05) 1px, transparent 1px)",
    backgroundSize: "40px 40px",
    maskImage: "radial-gradient(ellipse 80% 60% at 50% 40%, black 40%, transparent 100%)",
    WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 40%, black 40%, transparent 100%)"
  }} />;
}
function EmeraldWhisper() {
  return <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-[680px] w-[1100px] rounded-full blur-3xl" style={{
      background: "radial-gradient(ellipse at center, rgba(16,185,129,0.12) 0%, rgba(16,185,129,0.04) 40%, transparent 70%)"
    }} />
      <div className="absolute top-40 right-0 h-[420px] w-[520px] rounded-full blur-3xl" style={{
      background: "radial-gradient(circle, rgba(5,150,105,0.08) 0%, transparent 70%)"
    }} />
    </div>;
}

/* ─────────────── HERO MOCKUP, Static Certificate of Intent ─────────────── */

function CertificateMockup() {
  const docCount = DEMO_COMPILER_DOCS.length;
  return <motion.div initial={{
    opacity: 0,
    y: 24,
    rotate: 0
  }} animate={{
    opacity: 1,
    y: 0,
    rotate: 1
  }} transition={{
    duration: 0.9,
    ease: [0.16, 1, 0.3, 1]
  }} className="relative w-full max-w-[520px] mx-auto" style={{
    transformOrigin: "center center"
  }}>
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[28px] blur-3xl opacity-60" style={{
      background: "radial-gradient(ellipse at 50% 80%, rgba(16,185,129,0.18) 0%, transparent 70%)"
    }} />
      <article className="bg-card rounded-2xl shadow-2xl ring-1 ring-slate-900/10 overflow-hidden">
        <header className="px-10 pt-9 pb-6 border-b border-border text-center">
          <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-[hsl(var(--emerald))]">
            Izenzo · Trade Desk
          </p>
          <h3 className="mt-3 text-xl font-semibold text-foreground tracking-tight">
            Certificate of Intent
          </h3>
          <p className="mt-1 font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            Match · A1B2C3D4 · WaD/A v1.2
          </p>
        </header>

        <div className="px-10 py-8 space-y-5">
          <Row label="Counterparty" value={DEMO_COMPILER_TERMS.counterparty} />
          <Row label="Commodity" value={DEMO_COMPILER_TERMS.commodity} />
          <div className="grid grid-cols-2 gap-6">
            <Row label="Volume" value={`${DEMO_COMPILER_TERMS.volume} MT`} mono />
            <Row label="Price" value={`USD ${DEMO_COMPILER_TERMS.price}`} mono />
          </div>
          <Row label="Incoterms" value={DEMO_COMPILER_TERMS.incoterms} />

          <div className="pt-4 border-t border-border">
            <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-3">
              Bound Evidence · {docCount} files
            </p>
            <ul className="space-y-2">
              {DEMO_COMPILER_DOCS.map(d => <li key={d.name} className="flex items-center gap-3 text-[12px] text-muted-foreground">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" strokeWidth={1.75} />
                  <span className="truncate flex-1">{d.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    {d.hash.slice(0, 8)}…
                  </span>
                </li>)}
            </ul>
          </div>
        </div>

        <footer className="px-10 py-6 bg-muted/60 border-t border-border">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 h-8 w-8 rounded-full bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-200 flex items-center justify-center shrink-0">
              <Lock className="h-3.5 w-3.5 text-[hsl(var(--emerald))]" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
                SHA-256 Tamper-Proof Seal
              </p>
              <p className="mt-1 font-mono text-[11px] text-foreground break-all leading-relaxed">
                {DEMO_COMPILER_SEAL}
              </p>
            </div>
          </div>
        </footer>
      </article>
    </motion.div>;
}
function Row({
  label,
  value,
  mono = false
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return <div>
      <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-[14px] text-foreground ${mono ? "font-mono tabular-nums" : "font-medium"}`}>
        {value}
      </p>
    </div>;
}

/* ─────────────────────────────── PAGE ─────────────────────────────── */

export default function TradersSolutionsPage() {
  return <div className="min-h-screen bg-card text-foreground antialiased font-sans">
      <PublicHeader />

      {/* ════════════════════════ HERO ════════════════════════ */}
      <section className="relative overflow-hidden">
        <PrecisionGrid />
        <EmeraldWhisper />

        <div className="relative max-w-7xl mx-auto px-6 lg:px-12 pt-24 pb-32 lg:pt-36 lg:pb-48">
          <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-center">
            <div>
              <motion.p initial={{
              opacity: 0,
              y: 8
            }} animate={{
              opacity: 1,
              y: 0
            }} transition={{
              duration: 0.6
            }} className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.25em] uppercase text-[hsl(var(--emerald))]">
                <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--emerald))]" />
                For Commodity Traders & Corporates
              </motion.p>

              <motion.h1 initial={{
              opacity: 0,
              y: 12
            }} animate={{
              opacity: 1,
              y: 0
            }} transition={{
              duration: 0.7,
              delay: 0.05
            }} className="mt-6 text-3xl sm:text-4xl md:text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-semibold tracking-tighter leading-[1.02] text-foreground">
                Execute with absolute certainty.
              </motion.h1>

              <motion.p initial={{
              opacity: 0,
              y: 12
            }} animate={{
              opacity: 1,
              y: 0
            }} transition={{
              duration: 0.7,
              delay: 0.1
            }} className="mt-8 text-lg lg:text-xl text-muted-foreground leading-relaxed max-w-xl">
                Discover verified counterparties, negotiate terms, and seal
                cross-border commodity deals in a unified, secure terminal.
              </motion.p>

              <motion.div initial={{
              opacity: 0,
              y: 12
            }} animate={{
              opacity: 1,
              y: 0
            }} transition={{
              duration: 0.7,
              delay: 0.18
            }} className="mt-12 flex flex-wrap items-center gap-4">
                <Link to="/auth" className="group inline-flex items-center gap-2 rounded-md bg-[hsl(var(--emerald))] px-6 py-3.5 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 hover:bg-[hsl(var(--emerald))] hover:shadow-emerald-700/30 transition-all">
                  Open your desk
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                </Link>
                <Link to="/products/trade-desk" className="inline-flex items-center gap-2 rounded-md px-6 py-3.5 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                  See the product
                  <ArrowRight className="h-4 w-4 opacity-60" strokeWidth={2} />
                </Link>
              </motion.div>

              <motion.p initial={{
              opacity: 0
            }} animate={{
              opacity: 1
            }} transition={{
              duration: 0.7,
              delay: 0.3
            }} className="mt-10 font-mono text-[11px] tracking-[0.18em] uppercase text-muted-foreground">
                Verified liquidity · Hash-locked terms · Zero-friction compliance
              </motion.p>
            </div>

            <div className="relative">
              <CertificateMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════ FEATURE BENTO ═══════════════════ */}
      <section className="relative bg-muted/40 border-y border-border">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-16 sm:py-24 md:py-32 lg:py-44">
          <div className="max-w-2xl mb-20 lg:mb-28">
            <p className="font-mono text-[11px] tracking-[0.25em] uppercase text-[hsl(var(--emerald))]">
              The trader's edge
            </p>
            <h2 className="mt-5 text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tighter leading-[1.05] text-foreground">
              Find liquidity. Lock terms. Move capital.
            </h2>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
              Three primitives engineered to compress days of paperwork into
              minutes from drafted intent to recorded POI.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Box 1, Verified Liquidity */}
            <div className="lg:col-span-2 rounded-2xl bg-card border border-border p-10 lg:p-14">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-8 rounded-md bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-100 flex items-center justify-center">
                  <Search className="h-4 w-4 text-[hsl(var(--emerald))]" strokeWidth={2} />
                </div>
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                  Box 01 · Discovery
                </p>
              </div>
              <h3 className="text-3xl lg:text-4xl font-semibold tracking-tighter text-foreground">
                Verified liquidity, on demand.
              </h3>
              <p className="mt-4 text-base text-muted-foreground leading-relaxed max-w-xl">
                Search the order book by commodity, geography, role, or
                counterparty. Counterparties shown on your desk carry the
                screening status recorded for them. Status changes over time;
                always verify the current badge.
              </p>

              <div className="mt-10 grid sm:grid-cols-3 gap-4">
                {[{
                label: "Verified counterparties",
                value: "1,200+"
              }, {
                label: "Active commodities",
                value: "80"
              }, {
                label: "Jurisdictions",
                value: "42"
              }].map(s => <div key={s.label} className="rounded-xl bg-muted/70 ring-1 ring-slate-100 p-5">
                    <p className="text-2xl font-semibold tracking-tighter text-foreground tabular-nums">
                      {s.value}
                    </p>
                    <p className="mt-1 text-[12px] text-muted-foreground">{s.label}</p>
                  </div>)}
              </div>
            </div>

            {/* Box 2, Hash-Locked Negotiations */}
            <div className="rounded-2xl bg-card border border-border p-10 flex flex-col">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-8 rounded-md bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-100 flex items-center justify-center">
                  <Lock className="h-4 w-4 text-[hsl(var(--emerald))]" strokeWidth={2} />
                </div>
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                  Box 02 · Negotiation
                </p>
              </div>
              <h3 className="text-2xl font-semibold tracking-tighter text-foreground">
                Hash-locked negotiations.
              </h3>
              <p className="mt-3 text-[15px] text-muted-foreground leading-relaxed"> Every term iteration is signed and chained. No silent edits, no "he said / she said", the canonical version is always provably the latest. </p>

              <ul className="mt-8 space-y-3 text-[13px]">
                {["Versioned commercial terms", "Bilateral signature collapse", "Tamper-evident audit trail", "SHA-256 sealed at issuance"].map(c => <li key={c} className="flex items-center gap-3 text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--emerald))] shrink-0" strokeWidth={2} />
                    {c}
                  </li>)}
              </ul>
            </div>

            {/* Box 3, Zero-Friction Compliance */}
            <div className="lg:col-span-3 rounded-2xl bg-card border border-border p-10 lg:p-14">
              <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="h-8 w-8 rounded-md bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-100 flex items-center justify-center">
                      <Zap className="h-4 w-4 text-[hsl(var(--emerald))]" strokeWidth={2} />
                    </div>
                    <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                      Box 03 · Speed
                    </p>
                  </div>
                  <h3 className="text-3xl font-semibold tracking-tighter text-foreground">
                    Zero-friction compliance.
                  </h3>
                  <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                    Your KYB profile completes once and follows you across every
                    deal. Counterparties see only what they need to see. No
                    duplicate intake. No re-uploaded passports. No 14-day
                    onboarding sprints.
                  </p>
                </div>

                <ul className="space-y-2.5">
                  {["Single KYB profile, all counterparties", "Sanctions screening workflow with admin-reviewed thresholds. Continuous re-screening is planned hardening.", "Jurisdictional routing on every deal", "Authority binding workflow with verifiable credentials", "Compliance evidence travels with the trade"].map((g, i) => <li key={g} className="flex items-center gap-3 text-[13px]">
                      <span className="font-mono text-[10px] text-[hsl(var(--emerald))]/70 tabular-nums w-6">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <ShieldCheck className="h-3.5 w-3.5 text-[hsl(var(--emerald))] shrink-0" strokeWidth={2} />
                      <span className="text-muted-foreground">{g}</span>
                    </li>)}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════ FINAL CTA ════════════════ */}
      <section className="relative bg-card">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-16 sm:py-24 md:py-32 lg:py-44 text-center">
          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tighter leading-[1.05] text-foreground max-w-3xl mx-auto">
            Stop chasing paperwork.
            <br />
            <span className="text-[hsl(var(--emerald))]">Start closing trades.</span>
          </h2>
          <p className="mt-8 text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Provision a desk, complete your compliance profile, and seal your
            first cross-border match today.
          </p>
          <div className="mt-12">
            <Link to="/auth" className="group inline-flex items-center gap-2 rounded-md bg-[hsl(var(--emerald))] px-7 py-4 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 hover:bg-[hsl(var(--emerald))] transition-all">
              Open your desk
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
            </Link>
          </div>
        </div>
      </section>

      <PageFooter />
    </div>;
}