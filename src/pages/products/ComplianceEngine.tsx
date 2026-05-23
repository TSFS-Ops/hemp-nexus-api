/**
 * Compliance Engine, public product page.
 *
 * Same "Emerald & Airy" design DNA as TradeDesk: precision grid, emerald
 * whisper mesh, tight-tracked Inter headings, floating tactile mockup.
 *
 * Hero artwork is a static "Museum Mode" rendering of the KYB Company
 * Identity tab, no auth, no Supabase, no redirect. Renders instantly for
 * public visitors while staying pixel-faithful to the live product.
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, ShieldCheck, FileText, ScanLine, Network, Globe2, Building2, User, Lock } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";
import { PageFooter } from "@/components/PageFooter";

/* ───────────────────────── BACKDROP PIECES ───────────────────────── */

function PrecisionGrid({
  className = ""
}: {
  className?: string;
}) {
  return <div aria-hidden className={`pointer-events-none absolute inset-0 ${className}`} style={{
    backgroundImage: "radial-gradient(circle, rgba(15,23,42,0.06) 1px, transparent 1.2px)",
    backgroundSize: "28px 28px",
    maskImage: "radial-gradient(ellipse 75% 55% at 50% 40%, black 35%, transparent 100%)",
    WebkitMaskImage: "radial-gradient(ellipse 75% 55% at 50% 40%, black 35%, transparent 100%)"
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

/* ─────────────── HERO MOCKUP, Company Identity (Museum Mode) ─────────────── */

const DEMO_OWNERS = [{
  name: "Aurelia Holdings AG",
  jurisdiction: "CH",
  pct: 51.0,
  type: "entity" as const
}, {
  name: "Marcus Van Der Berg",
  jurisdiction: "ZA",
  pct: 32.5,
  type: "person" as const
}, {
  name: "Pinehurst Trust",
  jurisdiction: "JE",
  pct: 16.5,
  type: "entity" as const
}];
function IdentityMockup() {
  const totalPct = DEMO_OWNERS.reduce((s, o) => s + o.pct, 0);
  return <motion.div initial={{
    opacity: 0,
    y: 24,
    rotate: -2
  }} animate={{
    opacity: 1,
    y: 0,
    rotate: -1
  }} transition={{
    duration: 0.9,
    ease: [0.16, 1, 0.3, 1]
  }} className="relative w-full max-w-[560px] mx-auto" style={{
    transformOrigin: "center center"
  }}>
      {/* soft floor shadow */}
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[28px] blur-3xl opacity-60" style={{
      background: "radial-gradient(ellipse at 50% 80%, rgba(16,185,129,0.18) 0%, transparent 70%)"
    }} />
      <article className="bg-card rounded-2xl shadow-2xl ring-1 ring-slate-900/5 overflow-hidden">
        {/* Header bar */}
        <header className="px-10 pt-9 pb-6 border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-[hsl(var(--emerald))]">
                Izenzo · Compliance Engine
              </p>
              <h3 className="mt-3 text-xl font-semibold text-foreground tracking-tight">
                Aurelia Trade Holdings (Pty) Ltd
              </h3>
              <p className="mt-1 font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
                Reg · 2019/438217/07 · ZA
              </p>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-200 px-3 py-1 shrink-0">
              <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--emerald))]" strokeWidth={2} />
              <span className="text-[11px] font-medium text-[hsl(var(--emerald))]">Verified</span>
            </div>
          </div>
        </header>

        {/* Step indicator */}
        <div className="px-10 pt-6 pb-4">
          <div className="flex items-center gap-3">
            {[{
            i: "§01",
            l: "Entity",
            done: true
          }, {
            i: "§02",
            l: "Owners",
            done: true,
            active: true
          }, {
            i: "§03",
            l: "Documents",
            done: true
          }].map((s, idx) => <div key={s.i} className="flex items-center gap-3 flex-1">
                <div className={`flex items-center gap-2 ${s.active ? "text-[hsl(var(--emerald))]" : "text-muted-foreground"}`}>
                  <div className={`h-5 w-5 rounded-full flex items-center justify-center ring-1 ${s.done ? "bg-[hsl(var(--emerald-muted))] ring-emerald-200" : "bg-muted ring-slate-200"}`}>
                    <CheckCircle2 className={`h-3 w-3 ${s.done ? "text-[hsl(var(--emerald))]" : "text-muted-foreground/50"}`} strokeWidth={2} />
                  </div>
                  <span className="font-mono text-[10px] tracking-[0.2em] uppercase">
                    {s.i} · {s.l}
                  </span>
                </div>
                {idx < 2 && <div className="flex-1 h-px bg-gradient-to-r from-emerald-200/60 to-slate-100" />}
              </div>)}
          </div>
        </div>

        {/* Body, Step §02 active */}
        <div className="px-10 pb-8">
          <div className="flex items-center justify-between mb-4">
            <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
              Declared Beneficial Owners
            </p>
            <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-[hsl(var(--emerald))]">
              {totalPct.toFixed(1)}% · Resolved
            </p>
          </div>

          <ul className="space-y-2.5">
            {DEMO_OWNERS.map(o => <li key={o.name} className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
                <div className="h-8 w-8 rounded-md bg-muted ring-1 ring-slate-100 flex items-center justify-center shrink-0">
                  {o.type === "entity" ? <Building2 className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} /> : <User className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-foreground truncate">
                    {o.name}
                  </p>
                  <p className="font-mono text-[10px] tracking-[0.15em] uppercase text-muted-foreground">
                    {o.type === "entity" ? "Corporate" : "Natural person"} · {o.jurisdiction}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono text-[13px] tabular-nums text-foreground">
                    {o.pct.toFixed(1)}%
                  </p>
                </div>
              </li>)}
          </ul>

          {/* Progress bar */}
          <div className="mt-5">
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <motion.div initial={{
              width: 0
            }} animate={{
              width: `${totalPct}%`
            }} transition={{
              duration: 1.2,
              delay: 0.4,
              ease: "easeOut"
            }} className="h-full bg-[hsl(var(--emerald))]" />
            </div>
            <div className="mt-2 flex items-center justify-between font-mono text-[10px] tracking-[0.15em] uppercase">
              <span className="text-muted-foreground">UBO threshold · 100%</span>
              <span className="text-[hsl(var(--emerald))]">Complete</span>
            </div>
          </div>
        </div>

        {/* Seal footer */}
        <footer className="px-10 py-6 bg-muted/60 border-t border-border">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 h-8 w-8 rounded-full bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-200 flex items-center justify-center shrink-0">
              <Lock className="h-3.5 w-3.5 text-[hsl(var(--emerald))]" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
                KYB Profile · SHA-256 sealed
              </p>
              <p className="mt-1 font-mono text-[11px] text-foreground break-all leading-relaxed">
                0x9f4e2c8a1b6d3f7e5a0c4b8d2e6f1a9c3b7d5e8f2a4c6b9d1e3f5a7c8b0d2e4f
              </p>
            </div>
          </div>
        </footer>
      </article>
    </motion.div>;
}

/* ─────────────────── OCR EXTRACTION VISUAL (Bento 01) ─────────────────── */

const EXTRACTED_FIELDS = [{
  k: "legal_name",
  v: "Aurelia Trade Holdings (Pty) Ltd"
}, {
  k: "registration_number",
  v: "2019/438217/07"
}, {
  k: "jurisdiction",
  v: "ZA"
}, {
  k: "incorporation_date",
  v: "2019-08-14"
}, {
  k: "registered_address",
  v: "12 Keerom St, Cape Town"
}];
function OcrExtractionVisual() {
  return <div className="grid sm:grid-cols-[1fr_auto_1fr] gap-6 items-center">
      {/* PDF source */}
      <div className="relative rounded-xl border border-border bg-muted/60 p-5 min-h-[200px]">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            Certificate.pdf
          </p>
        </div>
        <div className="space-y-1.5">
          {[6, 4, 5, 3, 5, 4].map((w, i) => <div key={i} className="h-1.5 bg-muted rounded-full" style={{
          width: `${w * 12}%`
        }} />)}
        </div>
        {/* Scan line */}
        <motion.div aria-hidden initial={{
        y: 0,
        opacity: 0
      }} whileInView={{
        y: 140,
        opacity: [0, 1, 1, 0]
      }} viewport={{
        once: false,
        margin: "-100px"
      }} transition={{
        duration: 2.4,
        repeat: Infinity,
        ease: "easeInOut"
      }} className="absolute left-3 right-3 h-px bg-[hsl(var(--emerald))] shadow-[0_0_12px_rgba(16,185,129,0.6)]" />
      </div>

      {/* Arrow */}
      <div className="flex sm:flex-col items-center justify-center gap-1 text-[hsl(var(--emerald))]">
        <ScanLine className="h-5 w-5" strokeWidth={1.75} />
        <ArrowRight className="h-4 w-4 sm:rotate-0" strokeWidth={2} />
      </div>

      {/* JSON output */}
      <div className="rounded-xl border border-border bg-slate-900 p-5 min-h-[200px] font-mono text-[11px] leading-relaxed">
        <p className="text-emerald-400 mb-2">{"{"}</p>
        {EXTRACTED_FIELDS.map((f, i) => <motion.p key={f.k} initial={{
        opacity: 0,
        x: -4
      }} whileInView={{
        opacity: 1,
        x: 0
      }} viewport={{
        once: true
      }} transition={{
        delay: 0.3 + i * 0.08
      }} className="pl-3 truncate">
            <span className="text-muted-foreground/70">"{f.k}"</span>
            <span className="text-muted-foreground">: </span>
            <span className="text-emerald-300">"{f.v}"</span>
            {i < EXTRACTED_FIELDS.length - 1 && <span className="text-muted-foreground">,</span>}
          </motion.p>)}
        <p className="text-emerald-400 mt-1">{"}"}</p>
      </div>
    </div>;
}

/* ─────────────────────────────── PAGE ─────────────────────────────── */

export default function ComplianceEngineProductPage() {
  return <div className="min-h-screen bg-card text-foreground antialiased font-sans">
      <PublicHeader />

      {/* ════════════════════════ HERO ════════════════════════ */}
      <section className="relative overflow-hidden">
        <PrecisionGrid />
        <EmeraldWhisper />

        <div className="relative max-w-7xl mx-auto px-6 lg:px-12 pt-24 pb-32 lg:pt-36 lg:pb-48">
          <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-center">
            {/* Left: copy */}
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
                Compliance Engine
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
                Institutional identity.
                <br />
                Resolved.
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
                Admin-controlled KYB workflow, resolve complex UBO structures, and screen against
                global sanctions on configured cadence. Turn compliance from a bottleneck
                into a competitive advantage.
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
                  Verify a counterparty
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                </Link>
                <Link to="/products/trade-desk" className="inline-flex items-center gap-2 rounded-md px-6 py-3.5 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                  See the Trade Desk
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
                OFAC · EU · UK HMT · DPL · Continuous screening
              </motion.p>
            </div>

            {/* Right: floating Identity mockup */}
            <div className="relative">
              <IdentityMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════ COMPLIANCE BENTO ═══════════════════ */}
      <section className="relative bg-muted/40 border-y border-border">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-16 sm:py-24 md:py-32 lg:py-44">
          <div className="max-w-2xl mb-20 lg:mb-28">
            <p className="font-mono text-[11px] tracking-[0.25em] uppercase text-[hsl(var(--emerald))]">
              The system
            </p>
            <h2 className="mt-5 text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tighter leading-[1.05] text-foreground">
              Three primitives. One verified counterparty.
            </h2>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed"> Document intelligence, ownership graphing, and periodic sanctions screening on configured cadence: composed into a single auditable record. </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Box 1, OCR (large, spans 2) */}
            <div className="lg:col-span-2 rounded-2xl bg-card border border-border p-10 lg:p-14">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-8 rounded-md bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-100 flex items-center justify-center">
                  <ScanLine className="h-4 w-4 text-[hsl(var(--emerald))]" strokeWidth={2} />
                </div>
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                  Box 01 · Intelligence
                </p>
              </div>
              <h3 className="text-3xl lg:text-4xl font-semibold tracking-tighter text-foreground">
                AI document extraction.
              </h3>
              <p className="mt-4 text-base text-muted-foreground leading-relaxed max-w-md"> Upload a Certificate of Incorporation. Within seconds, the engine reads, structures, and SHA-256 seals the contents, ready to bind to an entity record. </p>

              <div className="mt-12">
                <OcrExtractionVisual />
              </div>
            </div>

            {/* Box 2, Sanctions */}
            <div className="rounded-2xl bg-card border border-border p-10 flex flex-col">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-8 rounded-md bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-100 flex items-center justify-center">
                  <Globe2 className="h-4 w-4 text-[hsl(var(--emerald))]" strokeWidth={2} />
                </div>
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                  Box 02 · Screening
                </p>
              </div>
              <h3 className="text-2xl font-semibold tracking-tighter text-foreground">
                Periodic sanctions screening.
              </h3>
              <p className="mt-3 text-[15px] text-muted-foreground leading-relaxed"> Every entity is screened against global watchlists on a configured cadence. Continuous re-screening is planned hardening. </p>

              <ul className="mt-8 space-y-3 text-[13px]">
                {[{
                l: "OFAC SDN",
                c: "US"
              }, {
                l: "EU Consolidated",
                c: "EU"
              }, {
                l: "UK HM Treasury",
                c: "UK"
              }, {
                l: "UN Security Council",
                c: "UN"
              }, {
                l: "PEP databases",
                c: "GLB"
              }].map(s => <li key={s.l} className="flex items-center gap-3 text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--emerald))] shrink-0" strokeWidth={2} />
                    <span className="flex-1">{s.l}</span>
                    <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-muted-foreground/70">
                      {s.c}
                    </span>
                  </li>)}
              </ul>
            </div>

            {/* Box 3, UBO Graphing (full width) */}
            <div className="lg:col-span-3 rounded-2xl bg-card border border-border p-10 lg:p-14">
              <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="h-8 w-8 rounded-md bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-100 flex items-center justify-center">
                      <Network className="h-4 w-4 text-[hsl(var(--emerald))]" strokeWidth={2} />
                    </div>
                    <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                      Box 03 · Ownership
                    </p>
                  </div>
                  <h3 className="text-3xl lg:text-4xl font-semibold tracking-tighter text-foreground">
                    UBO graphing.
                  </h3>
                  <p className="mt-4 text-base text-muted-foreground leading-relaxed max-w-md"> Nested corporate entities are recursively traversed until the ultimate human owners are resolved, with ownership percentages summing to 100%. </p>
                </div>

                {/* UBO graph visual */}
                <div className="relative">
                  <div className="space-y-3">
                    {/* Root */}
                    <div className="flex items-center gap-3 rounded-lg bg-[hsl(var(--emerald-muted))]/60 ring-1 ring-emerald-200 px-4 py-3">
                      <Building2 className="h-4 w-4 text-[hsl(var(--emerald))] shrink-0" strokeWidth={1.75} />
                      <span className="text-[13px] font-medium text-foreground flex-1">
                        Aurelia Trade Holdings
                      </span>
                      <span className="font-mono text-[10px] text-[hsl(var(--emerald))]">ROOT</span>
                    </div>

                    {/* Tier 1 */}
                    <div className="pl-6 space-y-2 border-l-2 border-[hsl(var(--emerald)/0.2)] ml-4">
                      {[{
                      n: "Aurelia Holdings AG",
                      t: "entity",
                      p: "51%"
                    }, {
                      n: "Marcus Van Der Berg",
                      t: "person",
                      p: "32.5%"
                    }, {
                      n: "Pinehurst Trust",
                      t: "entity",
                      p: "16.5%"
                    }].map(n => <div key={n.n} className="flex items-center gap-3 rounded-lg border border-border px-4 py-2.5">
                          {n.t === "entity" ? <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" strokeWidth={1.75} /> : <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" strokeWidth={1.75} />}
                          <span className="text-[12px] text-foreground flex-1 truncate">
                            {n.n}
                          </span>
                          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                            {n.p}
                          </span>
                        </div>)}
                    </div>

                    {/* Resolution */}
                    <div className="pt-3 flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] uppercase text-[hsl(var(--emerald))]">
                      <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
                      100% resolved · 4 ultimate beneficial owners
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════ CLOSING CTA ═══════════════════ */}
      <section className="relative overflow-hidden">
        <EmeraldWhisper />
        <div className="relative max-w-5xl mx-auto px-6 lg:px-12 py-16 sm:py-24 md:py-32 lg:py-44 text-center">
          <ShieldCheck className="h-10 w-10 text-[hsl(var(--emerald))] mx-auto mb-8" strokeWidth={1.5} />
          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tighter leading-[1.05] text-foreground">
            Compliance, as infrastructure.
          </h2>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
            One verified counterparty record, reused across every deal. Bind it
            to the Trade Desk and seal cross-border transactions in minutes.
          </p>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
            <Link to="/auth" className="group inline-flex items-center gap-2 rounded-md bg-[hsl(var(--emerald))] px-6 py-3.5 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 hover:bg-[hsl(var(--emerald))] transition-all">
              Provision Workspace
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
            </Link>
            <Link to="/docs" className="inline-flex items-center gap-2 rounded-md px-6 py-3.5 text-sm font-medium text-foreground hover:bg-muted transition-colors">
              Read the docs
              <ArrowRight className="h-4 w-4 opacity-60" strokeWidth={2} />
            </Link>
          </div>
        </div>
      </section>

      <PageFooter />
    </div>;
}