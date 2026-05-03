/**
 * Developers, public technical landing page.
 *
 * Same "Emerald & Airy" Stripe-Infrastructure aesthetic as the Product and
 * Solutions pages: whisper-light emerald mesh, 40px precision grid, extreme
 * whitespace, tight-tracked Inter headings. Hero artwork is a dark-mode
 * terminal mockup showing a syntax-highlighted Izenzo API call.
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen, Code2, Box, Activity, Terminal, Copy } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";
import { PageFooter } from "@/components/PageFooter";
import { ROUTES } from "@/lib/constants";

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

/* ───────────────── HERO MOCKUP, Dark Terminal with cURL ───────────────── */

function TerminalMockup() {
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
      {/* soft emerald glow */}
      <div aria-hidden className="absolute -inset-8 -z-10 rounded-[32px] blur-3xl opacity-70" style={{
      background: "radial-gradient(ellipse at 50% 60%, rgba(16,185,129,0.28) 0%, rgba(16,185,129,0.08) 40%, transparent 70%)"
    }} />

      <div className="rounded-2xl shadow-2xl ring-1 ring-slate-900/40 overflow-hidden bg-slate-950">
        {/* Title bar */}
        <div className="flex items-center justify-between px-5 py-3 bg-slate-900/80 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
            </div>
            <div className="flex items-center gap-2 ml-2">
              <Terminal className="h-3.5 w-3.5 text-slate-500" strokeWidth={2} />
              <span className="font-mono text-[11px] text-slate-400">
                izenzo-api · POST /functions/v1/match
              </span>
            </div>
          </div>
          <button type="button" disabled className="text-slate-500 hover:text-slate-300 transition-colors" aria-label="Copy snippet">
            <Copy className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>

        {/* Code body */}
        <div className="px-6 py-6 font-mono text-[12.5px] leading-[1.65]">
          <pre className="text-slate-300">
            <span className="text-emerald-400">curl</span>{" "}
            <span className="text-slate-400">-X</span>{" "}
            <span className="text-amber-300">POST</span>{" "}
            <span className="text-sky-300">https://api.izenzo.co.za/functions/v1/match</span>{" "}
            <span className="text-slate-500">\</span>
            {"\n  "}
            <span className="text-slate-400">-H</span>{" "}
            <span className="text-emerald-300">"X-API-Key: </span>
            <span className="text-slate-500">$IZENZO_KEY</span>
            <span className="text-emerald-300">"</span>{" "}
            <span className="text-slate-500">\</span>
            {"\n  "}
            <span className="text-slate-400">-H</span>{" "}
            <span className="text-emerald-300">"Content-Type: application/json"</span>{" "}
            <span className="text-slate-500">\</span>
            {"\n  "}
            <span className="text-slate-400">-d</span>{" "}
            <span className="text-emerald-300">{`'{`}</span>
            {"\n    "}
            <span className="text-sky-300">"counterparty_id"</span>
            <span className="text-slate-400">:</span>{" "}
            <span className="text-emerald-300">"cp_glencore_intl"</span>
            <span className="text-slate-400">,</span>
            {"\n    "}
            <span className="text-sky-300">"commodity"</span>
            <span className="text-slate-400">:</span>{" "}
            <span className="text-emerald-300">"copper_grade_a"</span>
            <span className="text-slate-400">,</span>
            {"\n    "}
            <span className="text-sky-300">"volume_mt"</span>
            <span className="text-slate-400">:</span>{" "}
            <span className="text-amber-300">500</span>
            <span className="text-slate-400">,</span>
            {"\n    "}
            <span className="text-sky-300">"price_usd"</span>
            <span className="text-slate-400">:</span>{" "}
            <span className="text-amber-300">9420</span>
            <span className="text-slate-400">,</span>
            {"\n    "}
            <span className="text-sky-300">"incoterms"</span>
            <span className="text-slate-400">:</span>{" "}
            <span className="text-emerald-300">"CIF Rotterdam"</span>
            {"\n  "}
            <span className="text-emerald-300">{`}'`}</span>
          </pre>

          {/* Response */}
          <div className="mt-6 pt-5 border-t border-slate-800">
            <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 mb-3">
              Response · 201 Created
            </p>
            <pre className="text-slate-300">
              <span className="text-slate-500">{"{"}</span>
              {"\n  "}
              <span className="text-sky-300">"id"</span>
              <span className="text-slate-400">:</span>{" "}
              <span className="text-emerald-300">"mtch_a1b2c3d4"</span>
              <span className="text-slate-400">,</span>
              {"\n  "}
              <span className="text-sky-300">"state"</span>
              <span className="text-slate-400">:</span>{" "}
              <span className="text-emerald-300">"poi_pending"</span>
              <span className="text-slate-400">,</span>
              {"\n  "}
              <span className="text-sky-300">"sha256_seal"</span>
              <span className="text-slate-400">:</span>{" "}
              <span className="text-emerald-300">"0x7c1a4f8e…"</span>
              {"\n"}
              <span className="text-slate-500">{"}"}</span>
            </pre>
          </div>
        </div>
      </div>
    </motion.div>;
}

/* ───────────────────────── DEVELOPER BENTO ───────────────────────── */

type HubCard = {
  icon: typeof BookOpen;
  title: string;
  description: string;
  href: string;
  cta: string;
  statusBadge?: boolean;
};
const HUB_CARDS: HubCard[] = [{
  icon: BookOpen,
  title: "Documentation",
  description: "Platform concepts, architecture, and integration guides.",
  href: ROUTES.DOCS,
  cta: "Read the docs"
}, {
  icon: Code2,
  title: "API Reference",
  description: "Full REST endpoints, webhooks, and authentication.",
  href: ROUTES.DOCS,
  cta: "Browse the API"
}, {
  icon: Box,
  title: "Webhooks",
  description: "Signed HTTP callbacks for every state transition.",
  href: "/docs/webhooks",
  cta: "Wire up webhooks"
}, {
  icon: Activity,
  title: "System Status",
  description: "100% uptime target. Real-time platform health.",
  href: "/admin/health",
  cta: "View status",
  statusBadge: true
}];

/* ─────────────────────────────── PAGE ─────────────────────────────── */

export default function DevelopersPage() {
  return <div className="min-h-screen bg-white text-slate-900 antialiased font-sans">
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
            }} className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.25em] uppercase text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                Izenzo Developers
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
            }} className="mt-6 text-5xl lg:text-6xl xl:text-7xl font-semibold tracking-tighter leading-[1.02] text-slate-900">
                Build on governance infrastructure.
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
            }} className="mt-8 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-xl">
                Integrate the Izenzo API to embed tamper-proof trade
                governance, automated KYB, and instant match execution
                directly into your institutional systems.
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
                <Link to={ROUTES.DOCS} className="group inline-flex items-center gap-2 rounded-md bg-emerald-600 px-6 py-3.5 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 hover:shadow-emerald-700/30 transition-all">
                  Read the docs
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                </Link>
                <Link to="/developer/keys" className="inline-flex items-center gap-2 rounded-md px-6 py-3.5 text-sm font-medium text-slate-900 hover:bg-slate-50 transition-colors">
                  Get an API key
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
            }} className="mt-10 font-mono text-[11px] tracking-[0.18em] uppercase text-slate-500">
                REST · Webhooks · Idempotent · Signed
              </motion.p>
            </div>

            <div className="relative">
              <TerminalMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════ DEVELOPER BENTO (4 cards) ═══════════════════ */}
      <section className="relative bg-slate-50/40 border-y border-slate-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-32 lg:py-44">
          <div className="max-w-2xl mb-20 lg:mb-28">
            <p className="font-mono text-[11px] tracking-[0.25em] uppercase text-emerald-700">
              Everything you need
            </p>
            <h2 className="mt-5 text-4xl lg:text-5xl font-semibold tracking-tighter leading-[1.05] text-slate-900">
              From first request to production scale.
            </h2>
            <p className="mt-6 text-lg text-slate-600 leading-relaxed"> Four primitives (guides, reference, webhooks, and live status) composed into a single, hard-engineering surface. </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {HUB_CARDS.map((card, i) => {
            const Icon = card.icon;
            return <motion.div key={card.title} initial={{
              opacity: 0,
              y: 12
            }} whileInView={{
              opacity: 1,
              y: 0
            }} viewport={{
              once: true,
              margin: "-50px"
            }} transition={{
              duration: 0.5,
              delay: i * 0.06
            }}>
                  <Link to={card.href} className="group flex flex-col h-full rounded-2xl bg-white border border-slate-100 p-8 hover:border-emerald-200 hover:shadow-md transition-all">
                    <div className="flex items-start justify-between mb-6">
                      <div className="h-10 w-10 rounded-md bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center">
                        <Icon className="h-5 w-5 text-emerald-600" strokeWidth={2} />
                      </div>
                      {card.statusBadge && <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 ring-1 ring-emerald-200">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-600" />
                          </span>
                          <span className="font-mono text-[10px] tracking-wider uppercase text-emerald-700">
                            Live
                          </span>
                        </span>}
                    </div>

                    <h3 className="text-xl font-semibold tracking-tight text-slate-900">
                      {card.title}
                    </h3>
                    <p className="mt-3 text-[14px] text-slate-500 leading-relaxed flex-1">
                      {card.description}
                    </p>
                    <div className="mt-8 inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-700 group-hover:gap-2.5 transition-all">
                      {card.cta}
                      <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                    </div>
                  </Link>
                </motion.div>;
          })}
          </div>
        </div>
      </section>

      {/* ════════════════ FINAL CTA ════════════════ */}
      <section className="relative bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-32 lg:py-44 text-center">
          <h2 className="text-4xl lg:text-5xl font-semibold tracking-tighter leading-[1.05] text-slate-900 max-w-3xl mx-auto">
            Ship your first sealed match.
            <br />
            <span className="text-emerald-700">In under 10 minutes.</span>
          </h2>
          <p className="mt-8 text-lg text-slate-600 max-w-xl mx-auto leading-relaxed">
            Provision a workspace, mint an API key, and POST your first
            tamper-proofally sealed deal today.
          </p>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
            <Link to="/auth" className="group inline-flex items-center gap-2 rounded-md bg-emerald-600 px-7 py-4 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 transition-all">
              Create an account
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
            </Link>
            <Link to={ROUTES.DOCS} className="inline-flex items-center gap-2 rounded-md px-7 py-4 text-sm font-medium text-slate-900 hover:bg-slate-50 transition-colors">
              Read the docs
              <ArrowRight className="h-4 w-4 opacity-60" strokeWidth={2} />
            </Link>
          </div>
        </div>
      </section>

      <PageFooter />
    </div>;
}