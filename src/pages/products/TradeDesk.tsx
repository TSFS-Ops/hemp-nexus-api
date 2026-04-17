/**
 * Trade Desk — public product page.
 *
 * "Emerald Infrastructure" aesthetic — extreme whitespace, whisper-light
 * emerald/mint mesh, tight-tracked Inter headings, 1px slate-100 bento cards
 * with emerald-600 icons. The hero mounts the LIVE MatchCompiler in
 * `demoMode` so visitors see the actual product UI (no auth, no DB).
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Activity,
} from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";
import { PageFooter } from "@/components/PageFooter";
import { MatchCompiler } from "@/components/desk/match/MatchCompiler";

const INTER =
  "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/* ───────────────────── BACKDROP — whisper mesh + grid ───────────────────── */

function PrecisionGrid() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage:
          "linear-gradient(to right, rgba(15,23,42,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.04) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
        maskImage:
          "radial-gradient(ellipse 80% 60% at 50% 40%, black 35%, transparent 100%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 80% 60% at 50% 40%, black 35%, transparent 100%)",
      }}
    />
  );
}

/** A whisper of green — emerald-50/20 + mint-50/10. */
function EmeraldWhisper() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute -top-40 left-1/2 -translate-x-1/2 h-[760px] w-[1200px] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(236,253,245,0.9) 0%, rgba(209,250,229,0.35) 35%, transparent 70%)",
        }}
      />
      <div
        className="absolute top-60 right-0 h-[480px] w-[560px] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(167,243,208,0.18) 0%, transparent 70%)",
        }}
      />
    </div>
  );
}

/* ───────────────────────── 9-GATE PROTOCOL ───────────────────────── */

const GATES = [
  "Entity Verification",
  "UBO Disclosure",
  "Sanctions Screening",
  "Jurisdiction Resolution",
  "Authority Binding",
  "Terms Lock",
  "Evidence Attachment",
  "Bilateral Collapse Sign",
  "WaD Certificate Issuance",
];

function NineGateProtocol() {
  return (
    <div className="space-y-3">
      {GATES.map((gate, i) => (
        <motion.div
          key={gate}
          initial={{ opacity: 0, x: -8 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ delay: i * 0.04, duration: 0.4 }}
          className="flex items-center gap-4"
        >
          <div className="flex items-center gap-3 shrink-0">
            <span className="font-mono text-[10px] tracking-[0.2em] text-emerald-700/60 w-6">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="h-6 w-6 rounded-full bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2} />
            </div>
          </div>
          <p className="text-[13px] text-slate-700 font-medium flex-1 min-w-0">{gate}</p>
          <div className="hidden sm:block flex-1 h-px bg-gradient-to-r from-emerald-100 to-transparent" />
        </motion.div>
      ))}
    </div>
  );
}

/* ──────────────────── REAL-TIME TELEMETRY (mini live feed) ──────────────────── */

const PULSES = [
  { t: "00:01", evt: "match_created", org: "GLN-SG" },
  { t: "00:02", evt: "kyc_verified", org: "AUR-DE" },
  { t: "00:04", evt: "sanctions_screened", org: "AUR-DE" },
  { t: "00:09", evt: "terms_locked", org: "GLN-SG" },
  { t: "00:11", evt: "poi_generated", org: "—" },
];

function TelemetryFeed() {
  return (
    <div className="space-y-2.5">
      {PULSES.map((p, i) => (
        <motion.div
          key={p.t + p.evt}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.08 }}
          className="flex items-center gap-3 text-[12px] font-mono"
        >
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-600" />
          </span>
          <span className="text-slate-400 tabular-nums">{p.t}</span>
          <span className="text-slate-900 truncate flex-1">{p.evt}</span>
          <span className="text-slate-500">{p.org}</span>
        </motion.div>
      ))}
    </div>
  );
}

/* ─────────────────────────────── PAGE ─────────────────────────────── */

export default function TradeDeskProductPage() {
  return (
    <div
      className="min-h-screen bg-white text-slate-900 antialiased"
      style={{ fontFamily: INTER }}
    >
      <PublicHeader />

      {/* ════════════════════════ HERO ════════════════════════ */}
      <section className="relative overflow-hidden">
        <PrecisionGrid />
        <EmeraldWhisper />

        <div className="relative max-w-7xl mx-auto px-6 lg:px-12 pt-32 pb-40 lg:pt-44 lg:pb-56">
          <div className="grid lg:grid-cols-12 gap-16 lg:gap-20 items-center">
            {/* Left: copy — 5 cols */}
            <div className="lg:col-span-5">
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.25em] uppercase text-emerald-700"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                Trade Desk
              </motion.p>

              <motion.h1
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.05 }}
                className="mt-8 text-5xl lg:text-6xl xl:text-7xl font-semibold tracking-tighter leading-[1.02] text-slate-900"
              >
                Sovereign infrastructure for the deal maker.
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.1 }}
                className="mt-10 text-lg lg:text-xl text-slate-500 leading-relaxed max-w-lg"
              >
                The all-in-one terminal for institutional commodity trade. Discover
                counterparties, run compliance, and seal cross-border deals with
                cryptographic Proof of Intent.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.18 }}
                className="mt-14 flex flex-wrap items-center gap-4"
              >
                <Link
                  to="/auth"
                  className="group inline-flex items-center gap-2 rounded-md bg-emerald-600 px-6 py-3.5 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 hover:shadow-emerald-700/30 transition-all"
                >
                  Open your desk
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                </Link>
                <Link
                  to="/pricing"
                  className="inline-flex items-center gap-2 rounded-md px-6 py-3.5 text-sm font-medium text-slate-900 hover:bg-slate-50 transition-colors"
                >
                  See pricing
                  <ArrowRight className="h-4 w-4 opacity-60" strokeWidth={2} />
                </Link>
              </motion.div>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.7, delay: 0.3 }}
                className="mt-12 font-mono text-[11px] tracking-[0.18em] uppercase text-slate-400"
              >
                SHA-256 sealed · 9-gate verified · Audit-ready
              </motion.p>
            </div>

            {/* Right: live MatchCompiler in demo mode — 7 cols */}
            <div className="lg:col-span-7 relative">
              {/* soft floor shadow to anchor the 3D card */}
              <div
                aria-hidden
                className="absolute -inset-6 -z-10 rounded-[28px] blur-3xl opacity-50"
                style={{
                  background:
                    "radial-gradient(ellipse at 50% 70%, rgba(16,185,129,0.16) 0%, transparent 70%)",
                }}
              />
              <motion.div
                initial={{ opacity: 0, y: 24, rotate: -2 }}
                animate={{ opacity: 1, y: 0, rotate: 1 }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                className="origin-center"
              >
                <div className="rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 overflow-hidden">
                  <MatchCompiler demoMode />
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════ FEATURE BENTO ═══════════════════ */}
      <section className="relative bg-white border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-32 lg:py-48">
          <div className="max-w-2xl mb-24 lg:mb-32">
            <p className="font-mono text-[11px] tracking-[0.25em] uppercase text-emerald-700">
              The system
            </p>
            <h2 className="mt-6 text-4xl lg:text-5xl font-semibold tracking-tighter leading-[1.05] text-slate-900">
              Precision-engineered for institutional throughput.
            </h2>
            <p className="mt-6 text-lg text-slate-500 leading-relaxed">
              Three primitives — verification, compliance, and telemetry — composed
              into a single cohesive workspace.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Box 1 — Large, spans 2 cols */}
            <div className="lg:col-span-2 rounded-2xl bg-white border border-slate-100 p-10 lg:p-14">
              <div className="flex items-center gap-3 mb-8">
                <div className="h-9 w-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <ShieldCheck className="h-4.5 w-4.5 text-emerald-600" strokeWidth={2} />
                </div>
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400">
                  Box 01 · Protocol
                </p>
              </div>
              <h3 className="text-3xl lg:text-4xl font-semibold tracking-tighter text-slate-900">
                The 9-Gate Protocol.
              </h3>
              <p className="mt-4 text-base text-slate-500 leading-relaxed max-w-md">
                Every Proof of Intent traverses nine cryptographic gates before it
                seals — entity, UBO, sanctions, jurisdiction, authority, terms,
                evidence, dual-collapse, certification.
              </p>

              <div className="mt-12">
                <NineGateProtocol />
              </div>
            </div>

            {/* Box 2 — KYB */}
            <div className="rounded-2xl bg-white border border-slate-100 p-10 flex flex-col">
              <div className="flex items-center gap-3 mb-8">
                <div className="h-9 w-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" strokeWidth={2} />
                </div>
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400">
                  Box 02 · Compliance
                </p>
              </div>
              <h3 className="text-2xl font-semibold tracking-tighter text-slate-900">
                KYB integrated.
              </h3>
              <p className="mt-3 text-[15px] text-slate-500 leading-relaxed">
                Your Compliance Profile feeds directly into every deal. No second
                onboarding, no duplicate evidence.
              </p>

              <ul className="mt-10 space-y-3 text-[13px]">
                {[
                  "Entity verification",
                  "Beneficial-owner disclosure",
                  "Sanctions & PEP screening",
                  "Jurisdiction residency lock",
                ].map((c) => (
                  <li key={c} className="flex items-center gap-3 text-slate-600">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" strokeWidth={2} />
                    {c}
                  </li>
                ))}
              </ul>
            </div>

            {/* Box 3 — Telemetry */}
            <div className="lg:col-span-3 rounded-2xl bg-white border border-slate-100 p-10 lg:p-14">
              <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
                <div>
                  <div className="flex items-center gap-3 mb-8">
                    <div className="h-9 w-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                      <Activity className="h-4.5 w-4.5 text-emerald-600" strokeWidth={2} />
                    </div>
                    <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400">
                      Box 03 · Observability
                    </p>
                  </div>
                  <h3 className="text-3xl font-semibold tracking-tighter text-slate-900">
                    Real-time telemetry.
                  </h3>
                  <p className="mt-4 text-base text-slate-500 leading-relaxed max-w-md">
                    A live activity stream surfaces every state transition across
                    your desk — from match creation to certificate issuance —
                    with cryptographic provenance on every pulse.
                  </p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/40 p-8">
                  <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400 mb-5">
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
      <section className="relative overflow-hidden border-t border-slate-100">
        <EmeraldWhisper />
        <div className="relative max-w-4xl mx-auto px-6 lg:px-12 py-32 lg:py-48 text-center">
          <h2 className="text-4xl lg:text-5xl font-semibold tracking-tighter leading-[1.05] text-slate-900">
            Open your desk in minutes.
          </h2>
          <p className="mt-6 text-lg text-slate-500 leading-relaxed max-w-xl mx-auto">
            Provision a workspace, complete your compliance profile, and issue your
            first sealed Proof of Intent today.
          </p>
          <div className="mt-12">
            <Link
              to="/auth"
              className="group inline-flex items-center gap-2 rounded-md bg-emerald-600 px-7 py-4 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 transition-all"
            >
              Open your desk
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
            </Link>
          </div>
        </div>
      </section>

      <PageFooter />
    </div>
  );
}
