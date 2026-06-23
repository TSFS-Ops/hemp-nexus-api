/**
 * Audit Ledger, public product page.
 *
 * Same "Emerald & Airy" aesthetic as Trade Desk and Compliance Engine: a
 * whisper-light emerald mesh, 40px precision grid, extreme whitespace, tight-
 * tracked Inter headings. The hero artwork mounts the live EvidencePackView in
 * `demoMode` so the public visitor sees the *actual* sealed certificate UI, * no auth, no Supabase round-trip, no redirects.
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, ShieldCheck, Lock, FileJson, FileText, FileSpreadsheet, Hash } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";
import { PageFooter } from "@/components/PageFooter";
import { EvidencePackView } from "@/components/desk/evidence/EvidencePackView";

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

/* ───────────────── BENTO VISUAL, payload → SHA-256 hash (sample) ───────────────── */

const SAMPLE_HASH_VALUE = "0x7c1a4f8e9b2d6c5f3a1e8d4b7c9f2e5a8d3b6c1f4e7a9d2c5b8e1f4a7d3c9e6b";
function PayloadToHash() {
  return <div className="grid lg:grid-cols-[1fr_auto_1fr] gap-6 lg:gap-8 items-center">
      {/* Canonical JSON payload (sample) */}
      <div className="rounded-xl bg-muted/60 ring-1 ring-slate-100 p-5 font-mono text-[11px] leading-relaxed text-muted-foreground overflow-hidden">
        <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-muted-foreground/70 mb-3">
          Sample Payload
        </p>
        <pre className="whitespace-pre overflow-hidden text-foreground">
{`{
  "match_id": "a1b2c3d4-...",
  "counterparty": "Glencore Intl",
  "commodity": "Grade A Copper",
  "volume_mt": 500,
  "price_usd": 9420,
  "incoterms": "CIF Rotterdam",
  "gates_evaluated": "sample",
  "issued_at": "2026-04-17T12:04:11Z"
}`}
        </pre>
      </div>

      {/* Arrow + algorithm */}
      <div className="flex lg:flex-col items-center justify-center gap-2">
        <div className="flex items-center gap-2">
          <div className="h-px w-10 lg:w-px lg:h-10 bg-emerald-200" />
          <div className="h-7 w-7 rounded-full bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-200 flex items-center justify-center shrink-0">
            <Hash className="h-3.5 w-3.5 text-[hsl(var(--emerald))]" strokeWidth={2} />
          </div>
          <div className="h-px w-10 lg:w-px lg:h-10 bg-emerald-200" />
        </div>
        <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-[hsl(var(--emerald))]">
          SHA-256
        </p>
      </div>

      {/* Sample hash output */}
      <div className="rounded-xl bg-slate-900 ring-1 ring-slate-800 p-5 font-mono text-[11px] leading-relaxed text-emerald-300 break-all">
        <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-muted-foreground mb-3">
          Sample SHA-256 Seal
        </p>
        <p className="text-emerald-300">{SAMPLE_HASH_VALUE}</p>
        <div className="mt-4 flex items-center gap-2 text-[10px] text-muted-foreground">
          <Lock className="h-3 w-3" strokeWidth={2} />
          <span className="font-mono tracking-wider">Hash-sealed · 256-bit · sample</span>
        </div>
      </div>
    </div>;
}

/* ─────────────── BENTO, Bank-Ready Exports ─────────────── */

const EXPORT_FORMATS = [{
  icon: FileJson,
  label: "JSON",
  desc: "Machine-readable canonical payload",
  use: "REST · webhook · API ingest"
}, {
  icon: FileText,
  label: "PDF",
  desc: "Sealed human-readable certificate",
  use: "Bank credit committee"
}, {
  icon: FileSpreadsheet,
  label: "CSV",
  desc: "Structured row export for ledgers",
  use: "Treasury · reconciliation"
}];

/* ─────────────────────────────── PAGE ─────────────────────────────── */

export default function AuditLedgerProductPage() {
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
                Audit Ledger
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
                Tamper-evident ledger
                <br />
                for trade finance.
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
                Provide banks, DFIs, and insurers with hash-sealed, independently
                re-verifiable deal records. Reduce manual auditing effort, raise
                the cost of tampering, and accelerate capital deployment.
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
                  Issue your first ledger
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                </Link>
                <Link to="/docs" className="inline-flex items-center gap-2 rounded-md px-6 py-3.5 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                  Read the spec
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
                Tamper-evident · Hash-sealed · Bank-ready exports
              </motion.p>
            </div>

            {/* Right: floating Audit Ledger mockup (real component, demo mode) */}
            <div className="relative">
              <motion.div initial={{
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
            }} className="relative w-full" style={{
              transformOrigin: "center center"
            }}>
                {/* soft floor shadow */}
                <div aria-hidden className="absolute -inset-6 -z-10 rounded-[28px] blur-3xl opacity-60" style={{
                background: "radial-gradient(ellipse at 50% 80%, rgba(16,185,129,0.18) 0%, transparent 70%)"
              }} />
                {/* Masked container - locks height + fades the long doc, scrolled to surface the WaD seal */}
                <div className="relative h-[600px] w-full max-w-lg mx-auto overflow-hidden rounded-xl shadow-2xl ring-1 ring-slate-900/10 -rotate-1 bg-card" aria-label="Sample evidence pack preview (demo)">
                  <div className="absolute inset-x-0 -top-[260px]">
                    <EvidencePackView demoMode />
                  </div>
                  {/* top fade - softens the cut-off above the title */}
                  <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-white to-transparent z-10 pointer-events-none" />
                  {/* bottom fade - disappears into the page */}
                  <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-white to-transparent z-10 pointer-events-none" />
                  {/* Demo/sample label - this is not a live backend verification */}
                  <div className="absolute top-3 right-3 z-20 rounded-md bg-slate-900/80 px-2 py-0.5 font-mono text-[9px] tracking-[0.2em] uppercase text-emerald-300 ring-1 ring-emerald-400/40">
                    Sample
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════ FINAL CTA ════════════════ */}
      <section className="relative bg-card">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-16 sm:py-24 md:py-32 lg:py-44 text-center">
          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tighter leading-[1.05] text-foreground max-w-3xl mx-auto">
            Stop auditing paperwork.
            <br />
            <span className="text-[hsl(var(--emerald))]">Start verifying mathematics.</span>
          </h2>
          <p className="mt-8 text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            The Audit Ledger is included with every Izenzo Trade Desk seat.
          </p>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
            <Link to="/auth" className="group inline-flex items-center gap-2 rounded-md bg-[hsl(var(--emerald))] px-6 py-3.5 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 hover:bg-[hsl(var(--emerald))] transition-all">
              Open your desk
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
            </Link>
            <Link to="/pricing" className="inline-flex items-center gap-2 rounded-md px-6 py-3.5 text-sm font-medium text-foreground hover:bg-muted transition-colors">
              See pricing
              <ArrowRight className="h-4 w-4 opacity-60" strokeWidth={2} />
            </Link>
          </div>
        </div>
      </section>

      <PageFooter />
    </div>;
}