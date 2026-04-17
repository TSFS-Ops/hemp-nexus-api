/**
 * Audit Ledger — public product page.
 *
 * Same "Emerald & Airy" aesthetic as Trade Desk and Compliance Engine: a
 * whisper-light emerald mesh, 40px precision grid, extreme whitespace, tight-
 * tracked Inter headings. The hero artwork mounts the live EvidencePackView in
 * `demoMode` so the public visitor sees the *actual* sealed certificate UI —
 * no auth, no Supabase round-trip, no redirects.
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Lock,
  FileJson,
  FileText,
  FileSpreadsheet,
  Hash,
} from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";
import { PageFooter } from "@/components/PageFooter";
import { EvidencePackView } from "@/components/desk/evidence/EvidencePackView";

/* ───────────────────────── BACKDROP PIECES ───────────────────────── */

function PrecisionGrid({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{
        backgroundImage:
          "linear-gradient(to right, rgba(15,23,42,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.05) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
        maskImage:
          "radial-gradient(ellipse 80% 60% at 50% 40%, black 40%, transparent 100%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 80% 60% at 50% 40%, black 40%, transparent 100%)",
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

/* ───────────────── BENTO VISUAL — payload → SHA-256 hash ───────────────── */

const HASH_VALUE = "0x7c1a4f8e9b2d6c5f3a1e8d4b7c9f2e5a8d3b6c1f4e7a9d2c5b8e1f4a7d3c9e6b";

function PayloadToHash() {
  return (
    <div className="grid lg:grid-cols-[1fr_auto_1fr] gap-6 lg:gap-8 items-center">
      {/* Canonical JSON payload */}
      <div className="rounded-xl bg-slate-50/60 ring-1 ring-slate-100 p-5 font-mono text-[11px] leading-relaxed text-slate-700 overflow-hidden">
        <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-slate-400 mb-3">
          Canonical Payload
        </p>
        <pre className="whitespace-pre overflow-hidden text-slate-800">
{`{
  "match_id": "a1b2c3d4-...",
  "counterparty": "Glencore Intl",
  "commodity": "Grade A Copper",
  "volume_mt": 500,
  "price_usd": 9420,
  "incoterms": "CIF Rotterdam",
  "gates_passed": 9,
  "issued_at": "2026-04-17T12:04:11Z"
}`}
        </pre>
      </div>

      {/* Arrow + algorithm */}
      <div className="flex lg:flex-col items-center justify-center gap-2">
        <div className="flex items-center gap-2">
          <div className="h-px w-10 lg:w-px lg:h-10 bg-emerald-200" />
          <div className="h-7 w-7 rounded-full bg-emerald-50 ring-1 ring-emerald-200 flex items-center justify-center shrink-0">
            <Hash className="h-3.5 w-3.5 text-emerald-700" strokeWidth={2} />
          </div>
          <div className="h-px w-10 lg:w-px lg:h-10 bg-emerald-200" />
        </div>
        <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-emerald-700">
          SHA-256
        </p>
      </div>

      {/* Deterministic hash output */}
      <div className="rounded-xl bg-slate-900 ring-1 ring-slate-800 p-5 font-mono text-[11px] leading-relaxed text-emerald-300 break-all">
        <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-slate-500 mb-3">
          Deterministic Seal
        </p>
        <p className="text-emerald-300">{HASH_VALUE}</p>
        <div className="mt-4 flex items-center gap-2 text-[10px] text-slate-500">
          <Lock className="h-3 w-3" strokeWidth={2} />
          <span className="font-mono tracking-wider">Immutable · 256-bit</span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── BENTO — Bank-Ready Exports ─────────────── */

const EXPORT_FORMATS = [
  {
    icon: FileJson,
    label: "JSON",
    desc: "Machine-readable canonical payload",
    use: "REST · webhook · API ingest",
  },
  {
    icon: FileText,
    label: "PDF",
    desc: "Sealed human-readable certificate",
    use: "Bank credit committee",
  },
  {
    icon: FileSpreadsheet,
    label: "CSV",
    desc: "Structured row export for ledgers",
    use: "Treasury · reconciliation",
  },
];

/* ─────────────────────────────── PAGE ─────────────────────────────── */

export default function AuditLedgerProductPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased font-sans">
      <PublicHeader />

      {/* ════════════════════════ HERO ════════════════════════ */}
      <section className="relative overflow-hidden">
        <PrecisionGrid />
        <EmeraldWhisper />

        <div className="relative max-w-7xl mx-auto px-6 lg:px-12 pt-24 pb-32 lg:pt-36 lg:pb-48">
          <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-center">
            {/* Left: copy */}
            <div>
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.25em] uppercase text-emerald-700"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                Audit Ledger
              </motion.p>

              <motion.h1
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.05 }}
                className="mt-6 text-5xl lg:text-6xl xl:text-7xl font-semibold tracking-tighter leading-[1.02] text-slate-900"
              >
                Cryptographic truth
                <br />
                for trade finance.
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.1 }}
                className="mt-8 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-xl"
              >
                Provide banks, DDIs, and insurers with mathematically provable
                deal records. Eliminate manual auditing, eradicate fraud, and
                accelerate capital deployment.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.18 }}
                className="mt-12 flex flex-wrap items-center gap-4"
              >
                <Link
                  to="/auth"
                  className="group inline-flex items-center gap-2 rounded-md bg-emerald-600 px-6 py-3.5 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 hover:shadow-emerald-700/30 transition-all"
                >
                  Issue your first ledger
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                </Link>
                <Link
                  to="/docs"
                  className="inline-flex items-center gap-2 rounded-md px-6 py-3.5 text-sm font-medium text-slate-900 hover:bg-slate-50 transition-colors"
                >
                  Read the spec
                  <ArrowRight className="h-4 w-4 opacity-60" strokeWidth={2} />
                </Link>
              </motion.div>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.7, delay: 0.3 }}
                className="mt-10 font-mono text-[11px] tracking-[0.18em] uppercase text-slate-500"
              >
                SHA-256 sealed · 9-gate verified · Bank-ready exports
              </motion.p>
            </div>

            {/* Right: floating Audit Ledger mockup (real component, demo mode) */}
            <div className="relative">
              <motion.div
                initial={{ opacity: 0, y: 24, rotate: -2 }}
                animate={{ opacity: 1, y: 0, rotate: -1 }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                className="relative w-full"
                style={{ transformOrigin: "center center" }}
              >
                {/* soft floor shadow */}
                <div
                  aria-hidden
                  className="absolute -inset-6 -z-10 rounded-[28px] blur-3xl opacity-60"
                  style={{
                    background:
                      "radial-gradient(ellipse at 50% 80%, rgba(16,185,129,0.18) 0%, transparent 70%)",
                  }}
                />
                <div className="rounded-2xl shadow-2xl ring-1 ring-slate-900/10 overflow-hidden bg-slate-900">
                  <EvidencePackView demoMode />
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════ FEATURE BENTO ═══════════════════ */}
      <section className="relative bg-slate-50/40 border-y border-slate-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-32 lg:py-44">
          <div className="max-w-2xl mb-20 lg:mb-28">
            <p className="font-mono text-[11px] tracking-[0.25em] uppercase text-emerald-700">
              The architecture
            </p>
            <h2 className="mt-5 text-4xl lg:text-5xl font-semibold tracking-tighter leading-[1.05] text-slate-900">
              An immutable record. A bankable proof.
            </h2>
            <p className="mt-6 text-lg text-slate-600 leading-relaxed">
              Three primitives — deterministic hashing, multi-format export, and
              gated ingest — composed into a single audit-grade ledger.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Box 1 — Large, spans 2 cols: The Immutable Ledger */}
            <div className="lg:col-span-2 rounded-2xl bg-white border border-slate-100 p-10 lg:p-14">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-8 rounded-md bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center">
                  <Hash className="h-4 w-4 text-emerald-600" strokeWidth={2} />
                </div>
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
                  Box 01 · Hashing
                </p>
              </div>
              <h3 className="text-3xl lg:text-4xl font-semibold tracking-tighter text-slate-900">
                The immutable ledger.
              </h3>
              <p className="mt-4 text-base text-slate-500 leading-relaxed max-w-md">
                Every sealed deal is canonicalised into a deterministic JSON
                payload, then hashed via SHA-256 to produce a 256-bit fingerprint
                that any third party can independently verify.
              </p>

              <div className="mt-12">
                <PayloadToHash />
              </div>
            </div>

            {/* Box 2 — Bank-Ready Exports */}
            <div className="rounded-2xl bg-white border border-slate-100 p-10 flex flex-col">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-8 rounded-md bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center">
                  <FileText className="h-4 w-4 text-emerald-600" strokeWidth={2} />
                </div>
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
                  Box 02 · Exports
                </p>
              </div>
              <h3 className="text-2xl font-semibold tracking-tighter text-slate-900">
                Bank-ready exports.
              </h3>
              <p className="mt-3 text-[15px] text-slate-500 leading-relaxed">
                Deliver evidence in the formats trade finance institutions
                already ingest — no bespoke integration required.
              </p>

              <ul className="mt-8 space-y-4">
                {EXPORT_FORMATS.map((f) => {
                  const Icon = f.icon;
                  return (
                    <li key={f.label} className="flex items-start gap-3">
                      <div className="mt-0.5 h-7 w-7 rounded-md bg-slate-50 ring-1 ring-slate-100 flex items-center justify-center shrink-0">
                        <Icon className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-900">{f.label}</p>
                        <p className="text-[12px] text-slate-500 leading-snug mt-0.5">{f.desc}</p>
                        <p className="font-mono text-[10px] tracking-wider text-slate-400 mt-1 uppercase">
                          {f.use}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Box 3 — The 9-Gate Proof (full width) */}
            <div className="lg:col-span-3 rounded-2xl bg-white border border-slate-100 p-10 lg:p-14">
              <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="h-8 w-8 rounded-md bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center">
                      <ShieldCheck className="h-4 w-4 text-emerald-600" strokeWidth={2} />
                    </div>
                    <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
                      Box 03 · Ingest
                    </p>
                  </div>
                  <h3 className="text-3xl font-semibold tracking-tighter text-slate-900">
                    The 9-gate proof.
                  </h3>
                  <p className="mt-4 text-base text-slate-500 leading-relaxed">
                    The Audit Ledger only ingests deals that have successfully
                    collapsed bilaterally and cleared all nine compliance gates.
                    Nothing partial. Nothing unilateral. Nothing unverified.
                  </p>
                </div>

                <ul className="space-y-2.5">
                  {[
                    "Entity verification",
                    "UBO disclosure",
                    "Sanctions & PEP screening",
                    "Jurisdiction resolution",
                    "Authority binding",
                    "Terms lock",
                    "Evidence attachment",
                    "Bilateral collapse signature",
                    "WaD certificate issuance",
                  ].map((g, i) => (
                    <li key={g} className="flex items-center gap-3 text-[13px]">
                      <span className="font-mono text-[10px] text-emerald-700/70 tabular-nums w-6">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" strokeWidth={2} />
                      <span className="text-slate-700">{g}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════ FINAL CTA ════════════════ */}
      <section className="relative bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-32 lg:py-44 text-center">
          <h2 className="text-4xl lg:text-5xl font-semibold tracking-tighter leading-[1.05] text-slate-900 max-w-3xl mx-auto">
            Stop auditing paperwork.
            <br />
            <span className="text-emerald-700">Start verifying mathematics.</span>
          </h2>
          <p className="mt-8 text-lg text-slate-600 max-w-xl mx-auto leading-relaxed">
            The Audit Ledger is included with every Izenzo Trade Desk seat.
          </p>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/auth"
              className="group inline-flex items-center gap-2 rounded-md bg-emerald-600 px-6 py-3.5 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 transition-all"
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
          </div>
        </div>
      </section>

      <PageFooter />
    </div>
  );
}
