/**
 * Solutions, Trade Finance & Insurance.
 *
 * Same "Emerald & Airy" Stripe-Infrastructure aesthetic as the Product pages.
 * Persona-targeted copy (Risk Mitigation) wrapped around the live
 * EvidencePackView in demo mode.
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, ShieldCheck, Hash, Banknote, FileSearch } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";
import { PageFooter } from "@/components/PageFooter";
import { EvidencePackView } from "@/components/desk/evidence/EvidencePackView";

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

/* ─────────────────────────────── PAGE ─────────────────────────────── */

export default function FinanceSolutionsPage() {
  return <div className="min-h-screen bg-card text-foreground antialiased font-sans">
      <PublicHeader />

      {/* ════════════════════════ HERO ════════════════════════ */}
      <section className="relative overflow-hidden">
        <PrecisionGrid />
        <EmeraldWhisper />

        <div className="relative max-w-7xl mx-auto px-6 lg:px-12 pt-24 pb-32 lg:pt-36 lg:pb-48">
          <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-center">
            <div>
              <p className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.25em] uppercase text-[hsl(var(--emerald))]">
                <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--emerald))]" />
                For Trade Finance & Insurance
              </p>

              <h1 className="mt-6 text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-semibold tracking-tighter leading-[1.02] text-foreground">
                De-risk capital deployment.
              </h1>

              <p className="mt-8 text-lg lg:text-xl text-muted-foreground leading-relaxed max-w-xl">
                Rely on mathematically provable deal records to underwrite trade
                finance, issue letters of credit, and insure shipments with
                zero ambiguity.
              </p>

              <div className="mt-12 flex flex-wrap items-center gap-4">
                <Link to="/auth" className="group inline-flex items-center gap-2 rounded-md bg-[hsl(var(--emerald))] px-6 py-3.5 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 hover:bg-[hsl(var(--emerald))] hover:shadow-emerald-700/30 transition-all">
                  Request access
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                </Link>
                <Link to="/products/audit-ledger" className="inline-flex items-center gap-2 rounded-md px-6 py-3.5 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                  See the ledger
                  <ArrowRight className="h-4 w-4 opacity-60" strokeWidth={2} />
                </Link>
              </div>

              <p className="mt-10 font-mono text-[11px] tracking-[0.18em] uppercase text-muted-foreground">
                SHA-256 immutable · Underwriter-grade · Audit-ready
              </p>
            </div>

            {/* Right: floating EvidencePackView (Certificate of Intent) */}
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
                <div aria-hidden className="absolute -inset-6 -z-10 rounded-[28px] blur-3xl opacity-60" style={{
                background: "radial-gradient(ellipse at 50% 80%, rgba(16,185,129,0.18) 0%, transparent 70%)"
              }} />
                <div className="rounded-2xl shadow-2xl ring-1 ring-slate-900/10 overflow-hidden bg-slate-900">
                  <EvidencePackView demoMode />
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════ FEATURE BENTO ═══════════════════ */}
      <section className="relative bg-muted/40 border-y border-border">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-16 sm:py-24 md:py-32 lg:py-44">
          <div className="max-w-2xl mb-20 lg:mb-28">
            <p className="font-mono text-[11px] tracking-[0.25em] uppercase text-[hsl(var(--emerald))]">
              For underwriters, lenders, and insurers
            </p>
            <h2 className="mt-5 text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tighter leading-[1.05] text-foreground">
              The end of forensic auditing.
            </h2>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed"> Three primitives (tamper-proof proof, automated underwriting, and instant audit resolution) engineered for institutional capital deployment. </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Box 1, Immutable Proof */}
            <div className="lg:col-span-2 rounded-2xl bg-card border border-border p-10 lg:p-14">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-8 rounded-md bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-100 flex items-center justify-center">
                  <Hash className="h-4 w-4 text-[hsl(var(--emerald))]" strokeWidth={2} />
                </div>
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                  Box 01 · Proof
                </p>
              </div>
              <h3 className="text-3xl lg:text-4xl font-semibold tracking-tighter text-foreground">
                Immutable proof (SHA-256).
              </h3>
              <p className="mt-4 text-base text-muted-foreground leading-relaxed max-w-xl">
                Every sealed deal carries a 256-bit tamper-proof fingerprint
                that any third party can independently re-compute and verify.
                No more notarised PDFs. No more chasing wet-ink signatures
                across three time zones.
              </p>

              <div className="mt-10 rounded-xl bg-slate-900 ring-1 ring-slate-800 p-6 font-mono text-[11px] leading-relaxed">
                <p className="text-[9px] tracking-[0.25em] uppercase text-muted-foreground mb-3">
                  Verifiable Seal · 256-bit
                </p>
                <p className="text-emerald-300 break-all">
                  0x7c1a4f8e9b2d6c5f3a1e8d4b7c9f2e5a8d3b6c1f4e7a9d2c5b8e1f4a7d3c9e6b
                </p>
                <div className="mt-4 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <CheckCircle2 className="h-3 w-3 text-[hsl(var(--emerald))]" strokeWidth={2} />
                  <span>Verified · Match A1B2C3D4 · 9/9 gates passed</span>
                </div>
              </div>
            </div>

            {/* Box 2, Automated Underwriting */}
            <div className="rounded-2xl bg-card border border-border p-10 flex flex-col">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-8 rounded-md bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-100 flex items-center justify-center">
                  <Banknote className="h-4 w-4 text-[hsl(var(--emerald))]" strokeWidth={2} />
                </div>
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                  Box 02 · Underwriting
                </p>
              </div>
              <h3 className="text-2xl font-semibold tracking-tighter text-foreground">
                Automated underwriting.
              </h3>
              <p className="mt-3 text-[15px] text-muted-foreground leading-relaxed">
                Ingest sealed deal records via API and route them straight into
                your credit decision engine. Reduce LC issuance from days to
                minutes.
              </p>

              <ul className="mt-8 space-y-3 text-[13px]">
                {["REST + webhook ingest", "Counterparty risk pre-cleared", "Cargo & shipment evidence bound", "Programmatic policy issuance"].map(c => <li key={c} className="flex items-center gap-3 text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--emerald))] shrink-0" strokeWidth={2} />
                    {c}
                  </li>)}
              </ul>
            </div>

            {/* Box 3, Instant Audit Resolution */}
            <div className="lg:col-span-3 rounded-2xl bg-card border border-border p-10 lg:p-14">
              <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="h-8 w-8 rounded-md bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-100 flex items-center justify-center">
                      <FileSearch className="h-4 w-4 text-[hsl(var(--emerald))]" strokeWidth={2} />
                    </div>
                    <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                      Box 03 · Resolution
                    </p>
                  </div>
                  <h3 className="text-3xl font-semibold tracking-tighter text-foreground">
                    Instant audit resolution.
                  </h3>
                  <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                    When a regulator, internal auditor, or counterparty queries
                    a deal, the answer is a single hash check away. No
                    discovery requests. No document chase. No reconciliation
                    spreadsheets. Just deterministic mathematics.
                  </p>
                </div>

                <ul className="space-y-2.5">
                  {["One-click hash verification", "Bound evidence chain (KYB, sanctions, terms)", "Bilateral signature provenance", "Tamper-evident timestamping", "Bank-ready PDF + JSON exports"].map((g, i) => <li key={g} className="flex items-center gap-3 text-[13px]">
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
            Stop underwriting paperwork.
            <br />
            <span className="text-[hsl(var(--emerald))]">Start underwriting truth.</span>
          </h2>
          <p className="mt-8 text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Connect your credit engine to the Audit Ledger and accelerate
            capital deployment with mathematical certainty.
          </p>
          <div className="mt-12">
            <Link to="/auth" className="group inline-flex items-center gap-2 rounded-md bg-[hsl(var(--emerald))] px-7 py-4 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 hover:bg-[hsl(var(--emerald))] transition-all">
              Request access
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
            </Link>
          </div>
        </div>
      </section>

      <PageFooter />
    </div>;
}