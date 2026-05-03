/**
 * Solutions, Sovereigns & PDBs.
 *
 * Same "Emerald & Airy" Stripe-Infrastructure aesthetic as the Product pages.
 * Persona-targeted copy (Macro-Oversight) wrapped around a custom static
 * Macro Telemetry dashboard mockup.
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, ShieldCheck, Lock, Globe2, Activity, AlertTriangle, TrendingUp } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";
import { PageFooter } from "@/components/PageFooter";

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

/* ─────────────── HERO MOCKUP, Macro Telemetry Dashboard ─────────────── */

const PROGRAMME_PULSES = [{
  t: "10:42",
  evt: "programme_disbursement",
  amt: "USD 12.4M"
}, {
  t: "10:41",
  evt: "milestone_verified",
  amt: "USD 8.1M"
}, {
  t: "10:39",
  evt: "kyb_re_attestation",
  amt: "-"
}, {
  t: "10:36",
  evt: "sanctions_clear",
  amt: "-"
}, {
  t: "10:34",
  evt: "fund_flow_recorded",
  amt: "USD 3.2M"
}];
const PROGRAMME_KPIS = [{
  label: "Programmes active",
  value: "47",
  trend: "+3"
}, {
  label: "Capital under governance",
  value: "$2.4B",
  trend: "+12%"
}, {
  label: "Breach rate",
  value: "0.02%",
  trend: "−0.4%"
}];
function MacroDashboardMockup() {
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
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[28px] blur-3xl opacity-60" style={{
      background: "radial-gradient(ellipse at 50% 80%, rgba(16,185,129,0.18) 0%, transparent 70%)"
    }} />
      <article className="bg-card rounded-2xl shadow-2xl ring-1 ring-slate-900/10 overflow-hidden">
        {/* Header */}
        <header className="px-8 pt-7 pb-5 border-b border-border flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-[hsl(var(--emerald))]">
              Izenzo · Governance Console
            </p>
            <h3 className="mt-2 text-lg font-semibold text-foreground tracking-tight">
              Macro Telemetry
            </h3>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-200">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[hsl(var(--emerald))] opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[hsl(var(--emerald))]" />
            </span>
            <span className="font-mono text-[10px] tracking-wider uppercase text-[hsl(var(--emerald))]">
              Live
            </span>
          </div>
        </header>

        {/* KPI strip */}
        <div className="px-8 py-6 grid grid-cols-3 gap-4 border-b border-border">
          {PROGRAMME_KPIS.map(k => <div key={k.label}>
              <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-muted-foreground">
                {k.label}
              </p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground tabular-nums">
                {k.value}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-[hsl(var(--emerald))]">
                {k.trend} · 24h
              </p>
            </div>)}
        </div>

        {/* Programme verification card */}
        <div className="px-8 py-6 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
              Programme Verification
            </p>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-200 font-mono text-[10px] text-[hsl(var(--emerald))]">
              <Lock className="h-2.5 w-2.5" strokeWidth={2.5} />
              SEALED
            </span>
          </div>
          <p className="text-[13px] font-semibold text-foreground">
            Maize Reserve Strategic Programme · ZAF
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            12 participants · 142 milestones · USD 480M deployed
          </p>
          <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-[hsl(var(--emerald))]" style={{
            width: "78%"
          }} />
          </div>
          <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
            <span>78% disbursed · 9/9 gates passed</span>
            <span className="text-muted-foreground/70">A1B2C3D4…</span>
          </div>
        </div>

        {/* Live event feed */}
        <div className="px-8 py-6">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-3">
            Live Programme Events
          </p>
          <ul className="space-y-2">
            {PROGRAMME_PULSES.map(p => <li key={p.t + p.evt} className="flex items-center gap-3 text-[11px] font-mono">
                <span className="text-muted-foreground/70 tabular-nums w-10">{p.t}</span>
                <span className="h-1 w-1 rounded-full bg-[hsl(var(--emerald))] shrink-0" />
                <span className="text-foreground truncate flex-1">{p.evt}</span>
                <span className="text-muted-foreground tabular-nums">{p.amt}</span>
              </li>)}
          </ul>
        </div>
      </article>
    </motion.div>;
}

/* ─────────────────────────────── PAGE ─────────────────────────────── */

export default function SovereignsSolutionsPage() {
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
                For Sovereigns & PDBs
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
                Govern institutional trade at scale.
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
                Secure national and cross-border trade programmes with
                end-to-end provenance, automated compliance, and real-time
                macro telemetry.
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
                  Request a briefing
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                </Link>
                <Link to="/products/audit-ledger" className="inline-flex items-center gap-2 rounded-md px-6 py-3.5 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                  See the architecture
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
                Institutional data residency · Append-only ledger · Macro telemetry
              </motion.p>
            </div>

            <div className="relative">
              <MacroDashboardMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════ FEATURE BENTO ═══════════════════ */}
      <section className="relative bg-muted/40 border-y border-border">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-16 sm:py-24 md:py-32 lg:py-44">
          <div className="max-w-2xl mb-20 lg:mb-28">
            <p className="font-mono text-[11px] tracking-[0.25em] uppercase text-[hsl(var(--emerald))]">
              For ministries, central banks & PDBs
            </p>
            <h2 className="mt-5 text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tighter leading-[1.05] text-foreground">
              See the whole programme. In real time.
            </h2>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed"> Three primitives (macro oversight, fraud prevention, and institutional data control) engineered for institutional trade programmes at national scale. </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Box 1, Macro Oversight */}
            <div className="lg:col-span-2 rounded-2xl bg-card border border-border p-10 lg:p-14">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-8 rounded-md bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-100 flex items-center justify-center">
                  <Activity className="h-4 w-4 text-[hsl(var(--emerald))]" strokeWidth={2} />
                </div>
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                  Box 01 · Oversight
                </p>
              </div>
              <h3 className="text-3xl lg:text-4xl font-semibold tracking-tighter text-foreground">
                Macro-level oversight.
              </h3>
              <p className="mt-4 text-base text-muted-foreground leading-relaxed max-w-xl"> Track every participant, milestone, and disbursement across an entire trade programme, in real time, without waiting for end-of-quarter reports. Drill from a national KPI down to a single signed event in three clicks. </p>

              <div className="mt-10 grid sm:grid-cols-3 gap-4">
                {[{
                icon: TrendingUp,
                label: "Live KPI dashboards"
              }, {
                icon: Activity,
                label: "Append-only event stream"
              }, {
                icon: ShieldCheck,
                label: "Tamper-Proof provenance"
              }].map(s => {
                const Icon = s.icon;
                return <div key={s.label} className="rounded-xl bg-muted/70 ring-1 ring-slate-100 p-5">
                      <Icon className="h-4 w-4 text-[hsl(var(--emerald))] mb-3" strokeWidth={2} />
                      <p className="text-[12px] text-muted-foreground leading-snug font-medium">
                        {s.label}
                      </p>
                    </div>;
              })}
              </div>
            </div>

            {/* Box 2, Fraud & Leakage Prevention */}
            <div className="rounded-2xl bg-card border border-border p-10 flex flex-col">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-8 rounded-md bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-100 flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4 text-[hsl(var(--emerald))]" strokeWidth={2} />
                </div>
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                  Box 02 · Integrity
                </p>
              </div>
              <h3 className="text-2xl font-semibold tracking-tighter text-foreground">
                Fraud & leakage prevention.
              </h3>
              <p className="mt-3 text-[15px] text-muted-foreground leading-relaxed"> Every disbursement is gated by milestone verification. Every signature is bound to a verified principal. Every event is hash-chained: making tampering mathematically detectable. </p>

              <ul className="mt-8 space-y-3 text-[13px]">
                {["Milestone-gated fund flows", "Authority-bound signatures", "Hash-chained event store", "Automated breach detection"].map(c => <li key={c} className="flex items-center gap-3 text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--emerald))] shrink-0" strokeWidth={2} />
                    {c}
                  </li>)}
              </ul>
            </div>

            {/* Box 3, Institutional Data Control */}
            <div className="lg:col-span-3 rounded-2xl bg-card border border-border p-10 lg:p-14">
              <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="h-8 w-8 rounded-md bg-[hsl(var(--emerald-muted))] ring-1 ring-emerald-100 flex items-center justify-center">
                      <Globe2 className="h-4 w-4 text-[hsl(var(--emerald))]" strokeWidth={2} />
                    </div>
                    <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                      Box 03 · Data Control
                    </p>
                  </div>
                  <h3 className="text-3xl font-semibold tracking-tighter text-foreground">
                    Institutional data control.
                  </h3>
                  <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                    Programme data, KYB records, and trade evidence remain
                    locked to the jurisdiction you choose. Residency is enforced
                    at onboarding and cannot be silently relocated. Your data,
                    your borders, your terms.
                  </p>
                </div>

                <ul className="space-y-2.5">
                  {["Jurisdiction-locked data residency", "Role-based access (RBAC + break-glass)", "POPIA / GDPR retention enforcement", "Cold-storage archival pipeline", "Independent regulator export endpoints"].map((g, i) => <li key={g} className="flex items-center gap-3 text-[13px]">
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
            Stop governing on quarterly lag.
            <br />
            <span className="text-[hsl(var(--emerald))]">Start governing in real time.</span>
          </h2>
          <p className="mt-8 text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed"> Brief our institutional solutions team on your programme, we'll architect the governance rail end-to-end. </p>
          <div className="mt-12">
            <Link to="/auth" className="group inline-flex items-center gap-2 rounded-md bg-[hsl(var(--emerald))] px-7 py-4 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 hover:bg-[hsl(var(--emerald))] transition-all">
              Request a briefing
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
            </Link>
          </div>
        </div>
      </section>

      <PageFooter />
    </div>;
}