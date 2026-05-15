/**
 * RejectedMatch, Post-Mortem split-screen for a denied trade.
 *
 * Left:  Grounds for rejection, audit log, and recovery actions.
 * Right: Voided WaD certificate with stamped 'VOIDED' watermark.
 */

import { useNavigate } from "react-router-dom";
import { ArrowLeft, AlertOctagon, Pencil, Archive } from "lucide-react";
import { motion } from "framer-motion";
const MATCH_REF = "DRAFT-7F3A2B91";
const REJECT_TIMESTAMP = "2026-04-16 21:06";
const REJECT_CODE = "REJECT_CODE_4B_SADC_MISMATCH";
export function RejectedMatch() {
  const navigate = useNavigate();
  return <div className="fixed inset-y-0 left-[250px] right-0 flex bg-card">
      {/* ── LEFT PANE: Post-Mortem ──────────────────────────────── */}
      <section className="w-1/2 overflow-y-auto border-r border-border bg-card">
        <div className="px-6 md:px-16 pt-8 md:pt-12 pb-16 md:pb-24 max-w-2xl">
          <button onClick={() => navigate("/desk")} className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-12">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Back to Pipeline
          </button>

          <motion.div initial={{
          opacity: 0,
          y: 8
        }} animate={{
          opacity: 1,
          y: 0
        }} transition={{
          duration: 0.35,
          ease: "easeOut"
        }}>
            <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-red-700 mb-3">
              Match · {MATCH_REF} · Status: Rejected
            </p>
            <h1 className="text-4xl lg:text-5xl font-semibold text-red-900 tracking-tight leading-[1.1]">
              Trade Rejected
            </h1>
            <p className="mt-6 text-base text-muted-foreground leading-relaxed max-w-lg">
              The Governance layer has issued a formal denial. The certificate has been voided
              and no credit was consumed. Review the grounds below before electing a path
              forward.
            </p>
          </motion.div>

          {/* ── Grounds for Rejection ─────────────────────────── */}
          <motion.div initial={{
          opacity: 0,
          y: 12
        }} animate={{
          opacity: 1,
          y: 0
        }} transition={{
          delay: 0.15,
          duration: 0.4,
          ease: "easeOut"
        }} className="mt-12 bg-red-50 border-l-4 border-red-600 p-6 rounded-sm">
            <div className="flex items-start gap-3">
              <AlertOctagon className="h-4 w-4 text-red-700 shrink-0 mt-0.5" strokeWidth={2} />
              <div className="min-w-0">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-red-700 font-medium">
                  Grounds for Rejection
                </p>
                <p className="mt-3 text-sm text-red-900 font-medium leading-relaxed">
                  Gate 4b: Jurisdiction Mismatch.
                </p>
                <p className="mt-2 text-sm text-red-800 leading-relaxed">
                  The provided SADC trade permit does not align with the destination port
                  (Port of Durban). Submitted documentation falls outside the declared
                  jurisdictional perimeter and cannot be sealed under the Without-a-Doubt
                  standard.
                </p>
              </div>
            </div>
          </motion.div>

          {/* ── Audit Log ─────────────────────────────────────── */}
          <div className="mt-10">
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-4">
              Governor Audit Log
            </p>
            <div className="rounded-sm border border-border bg-muted px-5 py-4 space-y-2">
              <p className="font-mono text-[11px] text-muted-foreground">
                <span className="text-muted-foreground">[2026-04-16 21:04]</span> · Bilateral
                signatures verified.
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                <span className="text-muted-foreground">[2026-04-16 21:05]</span> · Gates 1 to 4a passed. </p>
              <p className="font-mono text-[11px] text-red-700">
                <span className="text-muted-foreground">[{REJECT_TIMESTAMP}]</span> · {REJECT_CODE}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                <span className="text-muted-foreground">[2026-04-16 21:06]</span> · Certificate voided
                · No credit consumed.
              </p>
            </div>
          </div>

          {/* ── Recovery Actions ──────────────────────────────── */}
          <div className="mt-20 pt-12 border-t border-border">
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-6">
              Recovery Path
            </p>

            <div className="space-y-3">
              <motion.button whileHover={{
              scale: 0.99
            }} whileTap={{
              scale: 0.985
            }} transition={{
              type: "spring",
              stiffness: 400,
              damping: 30
            }} onClick={() => navigate("/desk/match/new")} className="w-full inline-flex items-center justify-center gap-3 rounded-md bg-primary px-6 py-4 text-sm font-medium text-primary-foreground transition-colors">
                <Pencil className="h-4 w-4" strokeWidth={2} />
                Modify & Resubmit
                <span className="font-mono text-[11px] tracking-wider opacity-80">
                  GATE 4B
                </span>
              </motion.button>

              <button onClick={() => navigate("/desk")} className="w-full inline-flex items-center justify-center gap-2 rounded-md px-6 py-4 text-sm font-medium text-muted-foreground hover:text-red-700 hover:bg-red-50 transition-colors border border-transparent hover:border-red-100">
                <Archive className="h-4 w-4" strokeWidth={2} />
                Archive & Release Match
              </button>
            </div>

            <p className="mt-6 text-center text-xs text-muted-foreground leading-relaxed max-w-md mx-auto">
              Resubmission re-opens the editor at the failing gate. Archiving closes this match
              permanently and releases the counterparty.
            </p>
          </div>
        </div>
      </section>

      {/* ── RIGHT PANE: Voided Certificate ──────────────────────── */}
      <section className="w-1/2 bg-muted overflow-hidden">
        <div className="h-full p-12 overflow-y-auto flex items-start justify-center">
          <div className="w-full max-w-xl">
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-red-700 mb-4 text-center">
              Voided Record · Issuance Failed
            </p>

            {/* Voided document card */}
            <div className="relative">
              <article className="relative bg-card rounded-sm border border-border p-12 overflow-hidden">
                {/* Header */}
                <header className="text-center pb-8 border-b border-border">
                  <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground/50"> Izenzo Governance Infrastructure, Deal Record </p>
                  <h2 className="mt-6 text-xl font-semibold tracking-[0.3em] uppercase text-muted-foreground/50">
                    Certificate of Intent
                  </h2>
                  <p className="mt-3 font-mono text-[11px] text-muted-foreground/50">
                    Ref · {MATCH_REF}
                  </p>
                </header>

                {/* Grayed data grid */}
                <dl className="py-8 space-y-3">
                  {[["Counterparty", "Aurubis AG"], ["Commodity", "Copper Cathode, LME Grade A"], ["Volume", "500 MT"], ["Price", "USD 9,420 / MT"], ["Incoterms", "CIF Durban"], ["Notional", "USD 4,710,000"]].map(([label, value]) => <div key={label} className="flex items-baseline justify-between gap-6">
                      <dt className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground/50 shrink-0">
                        {label}
                      </dt>
                      <dd className="text-sm text-muted-foreground/50 font-medium text-right truncate">
                        {value}
                      </dd>
                    </div>)}
                </dl>

                {/* Failed Seal */}
                <div className="mt-2 pt-6 border-t border-border">
                  <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground/50 mb-5">
                    Security & Integrity
                  </p>
                  <ul className="space-y-3 font-mono text-[11px]">
                    {["Jurisdiction Check", "UBO Validation", "Sanctions Screen", "Authority Bind"].map(label => <li key={label} className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground/50">{label}</span>
                        <span className="text-muted-foreground/50 tracking-wider">-</span>
                      </li>)}
                  </ul>

                  <div className="mt-6 pt-5 border-t border-dashed border-border">
                    <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-red-700 font-medium">
                      Issuance Failed
                    </p>
                    <p className="mt-2 font-mono text-[10px] text-muted-foreground/70 break-all">
                      {REJECT_CODE} · {REJECT_TIMESTAMP}
                    </p>
                  </div>
                </div>

                {/* VOIDED watermark, physical red ink stamp */}
                <motion.div initial={{
                scale: 2.6,
                opacity: 0,
                rotate: -15
              }} animate={{
                scale: [2.6, 0.92, 1.02, 1],
                opacity: [0, 0.55, 0.55, 0.55],
                rotate: -15,
                x: [0, -5, 5, -3, 2, 0],
                y: [0, -2, 3, -1, 1, 0]
              }} transition={{
                duration: 0.65,
                times: [0, 0.5, 0.78, 1],
                delay: 0.35,
                ease: [0.34, 1.56, 0.64, 1],
                x: {
                  duration: 0.45,
                  delay: 0.65,
                  ease: "easeOut"
                },
                y: {
                  duration: 0.45,
                  delay: 0.65,
                  ease: "easeOut"
                }
              }} className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{
                filter: "url(#voided-ink-stamp) blur(0.4px)"
              }}>
                  <div className="relative px-10 py-4 select-none" style={{
                  border: "5px solid rgba(176, 24, 24, 0.78)",
                  boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.55), inset 0 0 0 3px rgba(176, 24, 24, 0.78)",
                  borderRadius: "4px",
                  background: "radial-gradient(ellipse at 30% 40%, rgba(176, 24, 24, 0.04) 0%, transparent 55%), radial-gradient(ellipse at 75% 65%, rgba(176, 24, 24, 0.06) 0%, transparent 60%)"
                }}>
                    <span className="font-bold tracking-[0.18em]" style={{
                    fontFamily: "ui-serif, 'Times New Roman', Georgia, serif",
                    fontSize: "5.5rem",
                    lineHeight: 0.95,
                    color: "rgba(176, 24, 24, 0.82)",
                    WebkitTextStroke: "1.5px rgba(140, 18, 18, 0.85)",
                    textShadow: "0.5px 0.5px 0 rgba(120, 14, 14, 0.35), -0.5px 0 0 rgba(200, 40, 40, 0.25), 0 0.5px 1px rgba(140, 18, 18, 0.2)"
                  }}>
                      VOIDED
                    </span>

                    <p className="absolute left-1/2 -translate-x-1/2 -bottom-2.5 px-2 bg-card" style={{
                    fontFamily: "ui-monospace, 'JetBrains Mono', monospace",
                    fontSize: "0.55rem",
                    letterSpacing: "0.25em",
                    color: "rgba(140, 18, 18, 0.85)"
                  }}>
                      {REJECT_TIMESTAMP}
                    </p>
                  </div>

                  <svg className="absolute h-0 w-0" aria-hidden="true" focusable="false">
                    <defs>
                      <filter id="voided-ink-stamp">
                        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="noise" />
                        <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.6" />
                      </filter>
                    </defs>
                  </svg>
                </motion.div>
              </article>
            </div>

            <p className="mt-6 text-center text-xs text-muted-foreground leading-relaxed">
              This certificate is permanently sealed in the audit ledger as a voided record.
              No credit was consumed and no commercial obligation has been created.
            </p>
          </div>
        </div>
      </section>
    </div>;
}