/**
 * Trade Desk, public product page.
 *
 * "Stripe-Infrastructure" aesthetic: extreme whitespace, whisper-light emerald
 * mesh, tight-tracked Inter headings, a tactile floating Certificate of
 * Intent mockup, and a precision background grid. The hero artwork is built
 * from the same design DNA as the live MatchCompiler but is intentionally
 * static (no auth, no Supabase, no redirect to /auth) so the page renders
 * instantly for public visitors.
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, ShieldCheck, Activity, FileText, Lock } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";
import { PageFooter } from "@/components/PageFooter";
import { DEMO_COMPILER_TERMS, DEMO_COMPILER_DOCS, DEMO_COMPILER_SEAL } from "@/components/desk/_demo/fixtures";

/* ───────────────────────── BACKDROP PIECES ───────────────────────── */

/** Soft dotted texture, whisper-light. Replaces the precision grid. */
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

/** A whisper of emerald, soft radial mesh, very low opacity. */
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

/* ─────────────────── HERO MOCKUP, Certificate of Intent ─────────────────── */

function CertificateMockup() {
  const docCount = DEMO_COMPILER_DOCS.length;
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
  }} className="relative w-full max-w-[520px] mx-auto" style={{
    transformOrigin: "center center"
  }}>
      {/* soft floor shadow */}
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[28px] blur-3xl opacity-60" style={{
      background: "radial-gradient(ellipse at 50% 80%, rgba(16,185,129,0.18) 0%, transparent 70%)"
    }} />
      <article className="bg-card rounded-2xl shadow-2xl ring-1 ring-slate-900/5 overflow-hidden">
        {/* Header bar */}
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

        {/* Body, commercial terms */}
        <div className="px-10 py-8 space-y-5">
          <Row label="Counterparty" value={DEMO_COMPILER_TERMS.counterparty} />
          <Row label="Commodity" value={DEMO_COMPILER_TERMS.commodity} />
          <div className="grid grid-cols-2 gap-6">
            <Row label="Volume" value={`${DEMO_COMPILER_TERMS.volume} MT`} mono />
            <Row label="Price" value={`USD ${DEMO_COMPILER_TERMS.price}`} mono />
          </div>
          <Row label="Incoterms" value={DEMO_COMPILER_TERMS.incoterms} />

          {/* Documents */}
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

        {/* Seal footer */}
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

/* ─────────────────────── 9-GATE PROTOCOL VISUAL ─────────────────────── */

const GATES = ["Entity Verification", "UBO Disclosure", "Sanctions Screening", "Jurisdiction Resolution", "Authority Binding", "Terms Lock", "Evidence Attachment", "Bilateral Collapse Sign", "WaD Certificate Issuance"];
function NineGateProtocol() {
  return <div className="space-y-3">
      {GATES.map((gate, i) => <motion.div key={gate} initial={{
      opacity: 0,
      x: -8
    }} whileInView={{
      opacity: 1,
      x: 0
    }} viewport={{
      once: true,
      margin: "-50px"
    }} transition={{
      delay: i * 0.04,
      duration: 0.4
    }} className="flex items-center gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <span className="font-mono text-[10px] tracking-[0.2em] text-[hsl(var(--emerald))]/70 w-6">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="h-6 w-6 rounded-full bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-200 flex items-center justify-center">
              <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--emerald))]" strokeWidth={2} />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-foreground font-medium">{gate}</p>
          </div>
          <div className="hidden sm:block flex-1 h-px bg-gradient-to-r from-emerald-200/60 to-transparent" />
        </motion.div>)}
    </div>;
}

/* ────────────────── REAL-TIME TELEMETRY (mini live feed) ────────────────── */

const PULSES = [{
  t: "00:01",
  evt: "match_created",
  org: "GLN-SG"
}, {
  t: "00:02",
  evt: "kyc_verified",
  org: "AUR-DE"
}, {
  t: "00:04",
  evt: "sanctions_screened",
  org: "AUR-DE"
}, {
  t: "00:09",
  evt: "terms_locked",
  org: "GLN-SG"
}, {
  t: "00:11",
  evt: "poi_generated",
  org: "-"
}];
function TelemetryFeed() {
  return <div className="space-y-2.5">
      {PULSES.map((p, i) => <motion.div key={p.t + p.evt} initial={{
      opacity: 0
    }} whileInView={{
      opacity: 1
    }} viewport={{
      once: true
    }} transition={{
      delay: i * 0.08
    }} className="flex items-center gap-3 text-[12px] font-mono">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[hsl(var(--emerald))] opacity-60" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[hsl(var(--emerald))]" />
          </span>
          <span className="text-muted-foreground/70 tabular-nums">{p.t}</span>
          <span className="text-foreground truncate flex-1">{p.evt}</span>
          <span className="text-muted-foreground">{p.org}</span>
        </motion.div>)}
    </div>;
}

/* ─────────────────────────────── PAGE ─────────────────────────────── */

export default function TradeDeskProductPage() {
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
                Trade Desk
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
                Governance infrastructure
                <br />
                for the deal maker.
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
                The all-in-one terminal for institutional commodity trade. Discover
                counterparties, run governed compliance workflow, and record cross-border
                trade intent with cryptographically hashed Proof of Intent.
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
                <Link to="/pricing" className="inline-flex items-center gap-2 rounded-md px-6 py-3.5 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                  See pricing
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
                SHA-256 sealed · 9-gate verified · Audit-ready
              </motion.p>
            </div>

            {/* Right: floating Certificate of Intent */}
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
              The system
            </p>
            <h2 className="mt-5 text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tighter leading-[1.05] text-foreground">
              Precision-engineered for institutional throughput.
            </h2>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed"> Three primitives (verification, compliance, and telemetry) composed into a single cohesive workspace. </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Box 1, Large, spans 2 cols */}
            <div className="lg:col-span-2 lg:row-span-1 rounded-2xl bg-card ring-1 ring-slate-900/5 p-10 lg:p-14 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-8 rounded-md bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-100 flex items-center justify-center">
                  <ShieldCheck className="h-4 w-4 text-[hsl(var(--emerald))]" strokeWidth={2} />
                </div>
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                  Box 01 · Protocol
                </p>
              </div>
              <h3 className="text-3xl lg:text-4xl font-semibold tracking-tighter text-foreground">
                The 9-Gate Protocol.
              </h3>
              <p className="mt-4 text-base text-muted-foreground leading-relaxed max-w-md"> Every Proof of Intent traverses nine evidence gates before WaD certification: entity, UBO, sanctions, jurisdiction, authority, terms, evidence, dual-collapse, certification. </p>

              <div className="mt-12">
                <NineGateProtocol />
              </div>
            </div>

            {/* Box 2, KYB */}
            <div className="rounded-2xl bg-card ring-1 ring-slate-900/5 p-10 shadow-sm flex flex-col">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-8 rounded-md bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-100 flex items-center justify-center">
                  <CheckCircle2 className="h-4 w-4 text-[hsl(var(--emerald))]" strokeWidth={2} />
                </div>
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                  Box 02 · Compliance
                </p>
              </div>
              <h3 className="text-2xl font-semibold tracking-tighter text-foreground">
                KYB integrated.
              </h3>
              <p className="mt-3 text-[15px] text-muted-foreground leading-relaxed">
                Your Compliance Profile feeds directly into every deal. No second
                onboarding, no duplicate evidence.
              </p>

              <ul className="mt-8 space-y-3 text-[13px]">
                {["Entity verification", "Beneficial-owner disclosure", "Sanctions & PEP screening", "Jurisdiction recorded at onboarding"].map(c => <li key={c} className="flex items-center gap-3 text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--emerald))] shrink-0" strokeWidth={2} />
                    {c}
                  </li>)}
              </ul>
            </div>

            {/* Box 3, Telemetry */}
            <div className="lg:col-span-3 rounded-2xl bg-card ring-1 ring-slate-900/5 p-10 lg:p-14 shadow-sm">
              <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="h-8 w-8 rounded-md bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-100 flex items-center justify-center">
                      <Activity className="h-4 w-4 text-[hsl(var(--emerald))]" strokeWidth={2} />
                    </div>
                    <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                      Box 03 · Observability
                    </p>
                  </div>
                  <h3 className="text-3xl font-semibold tracking-tighter text-foreground">
                    Real-time telemetry.
                  </h3>
                  <p className="mt-4 text-base text-muted-foreground leading-relaxed max-w-md"> A product preview rendered from demo data — not customer activity — surfaces every state transition across a desk (from match creation to certificate issuance) with cryptographic provenance on every pulse. </p>
                </div>
                <div className="rounded-xl bg-muted/70 ring-1 ring-slate-100 p-8">
                  <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground mb-5">
                    Live · system pulses
                  </p>
                  <TelemetryFeed />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════ CLOSING CTA ═══════════════════ */}
      <section className="relative overflow-hidden">
        <EmeraldWhisper />
        <div className="relative max-w-4xl mx-auto px-6 lg:px-12 py-16 sm:py-24 md:py-32 lg:py-44 text-center">
          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tighter leading-[1.05] text-foreground">
            Open your desk in minutes.
          </h2>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto">
            Provision a workspace, complete your compliance profile, and record your
            first Draft Proof of Intent today.
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