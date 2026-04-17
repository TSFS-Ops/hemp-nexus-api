/**
 * Trade Desk — Product marketing page.
 *
 * Stripe-Infrastructure aesthetic: extreme whitespace, precision grid,
 * emerald-only accents, and the live MatchCompiler component rendered in
 * demoMode so the marketing surface mirrors the production UI byte-for-byte.
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  ShieldCheck,
  Building2,
  Activity,
  FileSignature,
  ScanFace,
  Globe2,
  Users,
  Lock,
  FileText,
  ScrollText,
  BadgeCheck,
} from "lucide-react";
import { MatchCompiler } from "@/components/desk/match/MatchCompiler";
import { PublicHeader } from "@/components/PublicHeader";
import { PageFooter } from "@/components/PageFooter";

/* ─────────────────────────────────────────────────────────────────── */
/*  GRID BACKDROP — 1px lines every 40px. Communicates 'precision'.    */
/* ─────────────────────────────────────────────────────────────────── */

function PrecisionGrid() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage:
          "linear-gradient(to right, rgb(15 23 42 / 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgb(15 23 42 / 0.04) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
        maskImage:
          "radial-gradient(ellipse 80% 60% at 50% 30%, black 40%, transparent 100%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 80% 60% at 50% 30%, black 40%, transparent 100%)",
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  EMERALD MESH — soft radial gradient behind the mockup.              */
/* ─────────────────────────────────────────────────────────────────── */

function EmeraldMesh() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 -z-10"
      style={{
        background:
          "radial-gradient(60% 50% at 30% 20%, hsl(155 60% 90% / 0.7), transparent 70%), radial-gradient(50% 60% at 80% 70%, hsl(155 70% 85% / 0.6), transparent 70%), linear-gradient(180deg, white, hsl(155 30% 97%))",
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  HERO                                                                */
/* ─────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-slate-200/70 bg-white">
      <PrecisionGrid />

      <div className="relative mx-auto max-w-[1280px] px-6 lg:px-12 pt-20 lg:pt-28 pb-24 lg:pb-32">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
          {/* ── LEFT: Copy ─────────────────────────────────────── */}
          <div className="lg:col-span-5 lg:pt-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/60 px-3 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-emerald-800">
                Trade Desk · Live
              </span>
            </div>

            <h1 className="mt-8 text-[44px] sm:text-[56px] lg:text-[64px] font-semibold tracking-[-0.02em] leading-[1.02] text-slate-900">
              Sovereign
              <br />
              Infrastructure
              <br />
              for the{" "}
              <span className="text-emerald-700">Deal Maker</span>.
            </h1>

            <p className="mt-8 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-xl">
              The all-in-one terminal for institutional commodity trade. Compile
              terms, attach evidence, and seal proof — without ever leaving the desk.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link
                to="/desk"
                className="group inline-flex items-center gap-2 rounded-md bg-emerald-700 hover:bg-emerald-800 px-6 py-3.5 text-sm font-medium text-white shadow-sm hover:shadow-md transition-all"
              >
                Open Your Desk
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
              </Link>
              <Link
                to="/pricing"
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-6 py-3.5 text-sm font-medium text-slate-800 hover:border-slate-400 hover:bg-slate-50 transition-colors"
              >
                See Pricing
              </Link>
            </div>

            {/* Trust strip */}
            <dl className="mt-14 grid grid-cols-3 gap-6 max-w-md">
              <Stat value="9" label="Verification gates" />
              <Stat value="SHA-256" label="Cryptographic seal" mono />
              <Stat value="< 200ms" label="P95 settlement" mono />
            </dl>
          </div>

          {/* ── RIGHT: Floating MatchCompiler mockup ───────────── */}
          <div className="lg:col-span-7 relative">
            <div className="relative">
              <EmeraldMesh />

              <motion.div
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                className="relative mx-auto"
                style={{
                  filter:
                    "drop-shadow(0 30px 60px hsl(155 50% 25% / 0.18)) drop-shadow(0 12px 24px hsl(155 50% 25% / 0.12))",
                }}
              >
                {/* Browser chrome */}
                <div className="rounded-t-xl border border-slate-200 border-b-0 bg-white/90 backdrop-blur px-4 py-3 flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
                  </div>
                  <div className="flex-1 flex items-center justify-center">
                    <div className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-3 py-1 max-w-[280px] w-full justify-center">
                      <Lock className="h-3 w-3 text-emerald-700" strokeWidth={2} />
                      <span className="font-mono text-[10px] text-slate-600 truncate">
                        izenzo.co.za / desk / match
                      </span>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-emerald-700">
                    Live
                  </span>
                </div>

                {/* Compiler frame — fixed height crops the live component into a hero card */}
                <div className="relative rounded-b-xl border border-slate-200 bg-white overflow-hidden h-[640px]">
                  <div className="absolute inset-0 origin-top-left">
                    {/*
                      MatchCompiler internally uses `fixed inset-0`. We override
                      that by putting it inside a relatively-positioned shell;
                      the component still renders correctly because its inner
                      panes use overflow-y-auto.
                    */}
                    <div className="relative w-full h-full [&>div]:!static [&>div]:!inset-auto [&>div]:!h-full [&>div]:!pb-0 [&>div]:!md:left-0">
                      <MatchCompiler demoMode />
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Caption */}
              <p className="mt-6 text-center font-mono text-[10px] tracking-[0.3em] uppercase text-slate-500">
                The actual product · Rendered in demo mode
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ value, label, mono }: { value: string; label: string; mono?: boolean }) {
  return (
    <div>
      <dt className={`text-2xl font-semibold text-slate-900 ${mono ? "font-mono text-xl" : ""}`}>
        {value}
      </dt>
      <dd className="mt-1 font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 leading-tight">
        {label}
      </dd>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  BENTO                                                               */
/* ─────────────────────────────────────────────────────────────────── */

const NINE_GATES = [
  { id: "01", label: "Bilateral Signatures Verified" },
  { id: "02", label: "Token Burn Recorded" },
  { id: "03", label: "KYB Status Cleared" },
  { id: "04", label: "Jurisdiction & Sanctions Reviewed" },
  { id: "05", label: "UBO & Authority Records Bound" },
  { id: "06", label: "Commercial Terms Hash-Locked" },
  { id: "07", label: "Document Integrity Verified" },
  { id: "08", label: "Audit Trail Sealed (NTP Anchored)" },
  { id: "09", label: "WaD Certificate Issued" },
];

function NineGateVisual() {
  return (
    <div className="space-y-2.5">
      {NINE_GATES.map((g, i) => (
        <motion.div
          key={g.id}
          initial={{ opacity: 0, x: -12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ delay: i * 0.05, duration: 0.4 }}
          className="flex items-center gap-3"
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-700 shrink-0">
            <Check className="h-3 w-3 text-white" strokeWidth={3} />
          </span>
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 w-8 shrink-0">
            {g.id}
          </span>
          <span className="text-sm text-slate-800 font-medium">{g.label}</span>
          <div className="flex-1 border-b border-dashed border-slate-200" />
          <span className="font-mono text-[9px] text-emerald-700 tracking-wider">
            VERIFIED
          </span>
        </motion.div>
      ))}
    </div>
  );
}

const KYB_FACETS = [
  { icon: Building2, label: "Entity Records" },
  { icon: ScanFace, label: "UBO Identity" },
  { icon: Globe2, label: "Jurisdiction" },
  { icon: ScrollText, label: "Authority Letters" },
  { icon: Users, label: "Director Roster" },
  { icon: BadgeCheck, label: "Sanctions Screen" },
];

function KybVisual() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {KYB_FACETS.map(({ icon: Icon, label }, i) => (
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.06, duration: 0.4 }}
          className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2.5"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-50">
            <Icon className="h-3.5 w-3.5 text-emerald-700" strokeWidth={1.75} />
          </span>
          <span className="text-xs text-slate-700 font-medium">{label}</span>
          <Check className="h-3 w-3 text-emerald-700 ml-auto shrink-0" strokeWidth={3} />
        </motion.div>
      ))}
    </div>
  );
}

const PULSES = [
  { dot: "emerald", label: "POI Sealed", meta: "Glencore → Aurubis · Cu/A", time: "just now" },
  { dot: "emerald", label: "KYB Cleared", meta: "Trafigura PTE", time: "12s" },
  { dot: "emerald", label: "Sanctions OK", meta: "OFAC + EU + UK", time: "41s" },
  { dot: "slate", label: "UBO Bound", meta: "Authority Letter v3", time: "1m" },
  { dot: "slate", label: "Hash Locked", meta: "0x7c1a3d…3b5c", time: "2m" },
];

function TelemetryVisual() {
  return (
    <div className="rounded-md bg-slate-950 p-4 font-mono text-[11px]">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <span className="tracking-[0.25em] uppercase text-slate-400 text-[9px]">
          System Pulse · IZN-DESK-01
        </span>
        <span className="inline-flex items-center gap-1.5 text-emerald-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          <span className="tracking-[0.2em] uppercase text-[9px]">Live</span>
        </span>
      </div>
      <ul className="mt-3 space-y-2.5">
        {PULSES.map((p, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -6 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08, duration: 0.35 }}
            className="flex items-center gap-3"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                p.dot === "emerald" ? "bg-emerald-400" : "bg-slate-600"
              }`}
            />
            <span className="text-slate-200">{p.label}</span>
            <span className="text-slate-500 truncate">{p.meta}</span>
            <span className="ml-auto text-slate-500 shrink-0">{p.time}</span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function FeatureBento() {
  return (
    <section className="relative bg-white py-24 lg:py-32 border-b border-slate-200/70">
      <div className="mx-auto max-w-[1280px] px-6 lg:px-12">
        {/* Section heading */}
        <div className="max-w-2xl mb-16">
          <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-emerald-700 mb-4">
            Built into every deal
          </p>
          <h2 className="text-3xl lg:text-5xl font-semibold tracking-[-0.02em] text-slate-900 leading-[1.05]">
            Every commercial action is{" "}
            <span className="text-emerald-700">verified, sealed,</span> and recorded.
          </h2>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-6">
          {/* Box 1 — LARGE — 9-Gate Protocol */}
          <BentoCard
            className="lg:col-span-2 lg:row-span-2"
            kicker="Protocol"
            icon={ShieldCheck}
            title="The 9-Gate Protocol"
            body="Every Proof of Intent must clear nine independent verification gates before it is sealed. No deal escapes without a complete cryptographic chain."
          >
            <div className="mt-8">
              <NineGateVisual />
            </div>
          </BentoCard>

          {/* Box 2 — KYB Integrated */}
          <BentoCard
            kicker="Compliance"
            icon={FileSignature}
            title="KYB Integrated"
            body="Your Compliance Profile — entity records, UBOs, authority letters, sanctions — feeds directly into every deal. Run once. Reuse forever."
          >
            <div className="mt-6">
              <KybVisual />
            </div>
          </BentoCard>

          {/* Box 3 — Real-time Telemetry */}
          <BentoCard
            kicker="Telemetry"
            icon={Activity}
            title="Real-time Telemetry"
            body="System pulses stream from every desk in your organisation. Watch settlement, KYB clearance, and seal events as they happen."
          >
            <div className="mt-6">
              <TelemetryVisual />
            </div>
          </BentoCard>
        </div>

        {/* Closing CTA strip */}
        <div className="mt-20 lg:mt-24 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 border-t border-slate-200 pt-12">
          <div>
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-emerald-700 mb-2">
              Ready when you are
            </p>
            <h3 className="text-2xl lg:text-3xl font-semibold text-slate-900 tracking-tight">
              Open your Trade Desk in under a minute.
            </h3>
          </div>
          <Link
            to="/desk"
            className="group inline-flex items-center gap-2 rounded-md bg-emerald-700 hover:bg-emerald-800 px-6 py-3.5 text-sm font-medium text-white shadow-sm hover:shadow-md transition-all shrink-0"
          >
            Open Your Desk
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function BentoCard({
  className = "",
  kicker,
  icon: Icon,
  title,
  body,
  children,
}: {
  className?: string;
  kicker: string;
  icon: typeof FileText;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={`relative rounded-xl border border-slate-200 bg-white p-7 lg:p-9 hover:border-emerald-300 transition-colors ${className}`}
    >
      <div className="flex items-center gap-3 mb-5">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-emerald-50 border border-emerald-100">
          <Icon className="h-4 w-4 text-emerald-700" strokeWidth={1.75} />
        </span>
        <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-emerald-700">
          {kicker}
        </span>
      </div>
      <h3 className="text-xl lg:text-2xl font-semibold text-slate-900 tracking-tight">
        {title}
      </h3>
      <p className="mt-3 text-sm lg:text-[15px] text-slate-600 leading-relaxed max-w-md">
        {body}
      </p>
      {children}
    </motion.article>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  PAGE                                                                */
/* ─────────────────────────────────────────────────────────────────── */

export default function TradeDeskProductPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* SEO */}
      <title>Trade Desk — Sovereign Infrastructure for the Deal Maker | Izenzo</title>
      <meta
        name="description"
        content="The all-in-one terminal for institutional commodity trade. Compile terms, attach evidence, and seal cryptographic Proof of Intent — all in one desk."
      />
      <link rel="canonical" href="https://izenzo.co.za/products/trade-desk" />

      <PublicHeader />
      <Hero />
      <FeatureBento />
      <PageFooter />
    </div>
  );
}
