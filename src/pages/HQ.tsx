/**
 * HQ — "God Mode" Super-Admin Console.
 *
 * The fourth and final persona. Where the other three (Trader/Governor/Developer)
 * live INSIDE a sidebar workspace, the HQ deliberately ABANDONS the sidebar to
 * signal a shift in altitude — the operator is no longer working IN the system,
 * they are looking AT the entire network from above.
 *
 * Layout DNA:
 *   - Top Command Bar (slate-950): brand + network status + exit.
 *   - Secondary Nav (white, hairline border): horizontal section links.
 *   - Macro grid (slate-50): Bloomberg-style scorecards.
 *   - Entity Oversight Matrix: full-width table with severe actions.
 *   - Zero-Knowledge Ledger Stream: hashes only. Privacy-by-design.
 *
 * Privacy contract: Admins must never see counterparty trade details. The live
 * stream renders only cryptographic proofs (SEALED_HASH, ORG_VERIFIED) so the
 * architecture itself prevents Izenzo HQ from snooping on commercial flow.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Routes, Route, Navigate } from "react-router-dom";
import { Activity, LogOut, Shield, AlertTriangle } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/contexts/AuthContext";

// ─────────────────────────────────────────────────────────────────────────────
// Top Command Bar — the "Air Traffic Control" header.
// Midnight slate-950 to draw a hard boundary against the bright workspace below.
// ─────────────────────────────────────────────────────────────────────────────
function CommandBar() {
  const { signOut } = useAuth();
  return (
    <header className="bg-slate-950 text-slate-100 border-b border-slate-900">
      <div className="px-6 lg:px-10 h-14 flex items-center justify-between">
        <div className="flex items-center gap-8">
          {/* Wordmark */}
          <Link to="/hq" className="flex items-center gap-2.5">
            <div className="h-6 w-6 rounded-sm bg-emerald-500 flex items-center justify-center">
              <span className="text-slate-950 font-bold text-[10px] font-mono">IZ</span>
            </div>
            <div className="leading-tight">
              <div className="font-mono text-[11px] tracking-[0.25em] uppercase text-slate-100">
                Izenzo · HQ
              </div>
              <div className="font-mono text-[9px] tracking-[0.2em] uppercase text-slate-500">
                Sovereign Network Control
              </div>
            </div>
          </Link>

          {/* Network status badge */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-sm border border-emerald-900/60 bg-emerald-950/40">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-emerald-300">
              Network Status: Synchronized
            </span>
          </div>
        </div>

        <button
          onClick={signOut}
          className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-slate-400 hover:text-slate-100 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
          Sign out
        </button>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Secondary nav — bright white horizontal rail. Deliberately not a sidebar:
// admins should glance horizontally, the way one reads a newspaper masthead.
// ─────────────────────────────────────────────────────────────────────────────
const SECTIONS = [
  { to: "/hq", label: "Network Pulse", end: true },
  { to: "/hq/entities", label: "Entity Oversight" },
  { to: "/hq/ledger", label: "Ledger Analytics" },
  { to: "/hq/anomalies", label: "Anomaly Alerts" },
];

function SecondaryNav() {
  return (
    <nav className="bg-white border-b border-slate-200">
      <div className="px-6 lg:px-10">
        <ul className="flex items-center gap-8 h-12">
          {SECTIONS.map((s) => (
            <li key={s.to}>
              <NavLink
                to={s.to}
                end={s.end}
                className={({ isActive }) =>
                  [
                    "relative inline-flex items-center text-sm h-12 transition-colors",
                    isActive
                      ? "text-slate-900 font-medium"
                      : "text-slate-500 hover:text-slate-900",
                  ].join(" ")
                }
              >
                {({ isActive }) => (
                  <>
                    <span>{s.label}</span>
                    {isActive && (
                      <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-slate-900" />
                    )}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scorecard — Bloomberg-style. Lightweight Inter, generous size, monospace
// label. Avoids any decorative chrome so the number itself does the talking.
// ─────────────────────────────────────────────────────────────────────────────
function Scorecard({
  label,
  value,
  delta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: "neutral" | "positive" | "warning";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-600"
      : tone === "warning"
      ? "text-amber-600"
      : "text-slate-500";
  return (
    <div className="bg-white border border-slate-200 px-6 py-5">
      <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 mb-3">
        {label}
      </p>
      <p
        className="text-3xl lg:text-4xl text-slate-900 tracking-tight"
        style={{ fontWeight: 300, letterSpacing: "-0.02em" }}
      >
        {value}
      </p>
      {delta && (
        <p className={`mt-2 font-mono text-[11px] tracking-wide ${toneClass}`}>
          {delta}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock dataset. Real wiring (organizations table + audit_logs counts) will
// come in PROMPT 17. This pass is the stage; data plumbing follows.
// ─────────────────────────────────────────────────────────────────────────────
const MOCK_ORGS = [
  { name: "Acme Mining Co.", onboarded: "2024-08-12", kyb: "Verified", apiVol: "2.1M" },
  { name: "Durban Port Authority", onboarded: "2024-09-04", kyb: "Verified", apiVol: "1.8M" },
  { name: "Karoo AgriCorp", onboarded: "2024-10-21", kyb: "Verified", apiVol: "640K" },
  { name: "Midlands Logistics", onboarded: "2024-11-15", kyb: "Pending", apiVol: "112K" },
  { name: "Cape Industrial Holdings", onboarded: "2025-01-09", kyb: "Verified", apiVol: "980K" },
  { name: "Gauteng Refinery Group", onboarded: "2025-02-18", kyb: "Verified", apiVol: "3.4M" },
  { name: "Saldanha Bulk Terminals", onboarded: "2025-03-02", kyb: "Review", apiVol: "220K" },
];

// Synthetic stream generator. Hashes are deterministically random per tick so
// the page feels alive without leaking any real data shape.
function useLedgerStream() {
  const [events, setEvents] = useState<{ ts: string; type: string; payload: string }[]>(
    () => seedEvents()
  );

  useEffect(() => {
    const id = setInterval(() => {
      setEvents((prev) => [makeEvent(), ...prev].slice(0, 60));
    }, 2400);
    return () => clearInterval(id);
  }, []);

  return events;
}

function seedEvents() {
  return Array.from({ length: 14 }, () => makeEvent());
}

function makeEvent() {
  const types = [
    { t: "SEALED_HASH", p: () => randHash(8) + "...91x" },
    { t: "ORG_VERIFIED", p: () => "org_" + Math.floor(Math.random() * 999) },
    { t: "WAD_ISSUED", p: () => "wad_" + randHash(6) },
    { t: "GATE_4_CLEARED", p: () => "case_" + randHash(5) },
    { t: "KEY_ROTATED", p: () => "k_" + randHash(7) },
  ];
  const e = types[Math.floor(Math.random() * types.length)];
  const now = new Date();
  const ts = now.toTimeString().slice(0, 8);
  return { ts, type: e.t, payload: e.p() };
}

function randHash(len: number) {
  const chars = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Network Pulse — the landing screen. Macro KPIs, oversight matrix, and the
// zero-knowledge stream side-by-side.
// ─────────────────────────────────────────────────────────────────────────────
function NetworkPulse() {
  const events = useLedgerStream();
  const total = useMemo(
    () => MOCK_ORGS.reduce((acc, o) => acc + parseFloat(o.apiVol), 0).toFixed(1),
    []
  );

  return (
    <div className="bg-slate-50 min-h-[calc(100vh-104px)]">
      <div className="px-6 lg:px-10 py-8 space-y-10">
        {/* Section: Macro Pulse ─────────────────────────────────────────── */}
        <section>
          <div className="flex items-baseline justify-between mb-5">
            <div>
              <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
                Section 01
              </p>
              <h2 className="text-lg font-medium text-slate-900 tracking-tight">
                Macro Pulse · Sovereign Network
              </h2>
            </div>
            <p className="font-mono text-[10px] tracking-wide text-slate-400">
              Last sync · {new Date().toLocaleTimeString()}
            </p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 border border-slate-200">
            <Scorecard
              label="Total Network Volume"
              value="R 4.2 Bn"
              delta="↑ 12.4% MoM"
              tone="positive"
            />
            <Scorecard
              label="Active Nodes / Orgs"
              value="142"
              delta="138 verified · 4 pending"
            />
            <Scorecard
              label="WaD Certificates Issued"
              value="8,401"
              delta="↑ 312 this week"
              tone="positive"
            />
            <Scorecard
              label="Global Dispute Rate"
              value="0.04%"
              delta="Within tolerance"
              tone="positive"
            />
          </div>
        </section>

        {/* Heavy divider — separates "what is" from "who is" ─────────── */}
        <div className="border-t-2 border-slate-900" />

        {/* Section: Entity Oversight + Ledger Stream split ──────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Oversight matrix */}
          <section className="xl:col-span-2">
            <div className="flex items-baseline justify-between mb-5">
              <div>
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
                  Section 02
                </p>
                <h2 className="text-lg font-medium text-slate-900 tracking-tight">
                  Active Network Participants
                </h2>
              </div>
              <p className="font-mono text-[10px] tracking-wide text-slate-400">
                {MOCK_ORGS.length} organisations
              </p>
            </div>
            <div className="bg-white border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 px-5 py-3">
                      Org Name
                    </th>
                    <th className="text-left font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 px-5 py-3">
                      Onboarded
                    </th>
                    <th className="text-left font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 px-5 py-3">
                      KYB
                    </th>
                    <th className="text-right font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 px-5 py-3">
                      API Vol
                    </th>
                    <th className="text-right font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 px-5 py-3">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_ORGS.map((o) => (
                    <tr
                      key={o.name}
                      className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50 transition-colors"
                    >
                      <td className="px-5 py-3.5 text-slate-900">{o.name}</td>
                      <td className="px-5 py-3.5 font-mono text-[12px] text-slate-500">
                        {o.onboarded}
                      </td>
                      <td className="px-5 py-3.5">
                        <KybBadge status={o.kyb} />
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-[12px] text-slate-700">
                        {o.apiVol}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button className="font-mono text-[11px] tracking-wide text-slate-500 hover:text-red-600 hover:bg-red-50 px-2.5 py-1 rounded-sm transition-colors">
                          Suspend Network Access
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Zero-Knowledge ledger stream */}
          <section className="xl:col-span-1">
            <div className="flex items-baseline justify-between mb-5">
              <div>
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
                  Section 03
                </p>
                <h2 className="text-lg font-medium text-slate-900 tracking-tight">
                  Live Ledger Stream
                </h2>
                <p className="text-[11px] text-slate-500 mt-1 max-w-xs">
                  Cryptographic proofs only. Trade detail is opaque to HQ by design.
                </p>
              </div>
            </div>
            <div className="bg-slate-950 border border-slate-900 h-[520px] overflow-hidden flex flex-col">
              {/* terminal header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-900">
                <div className="flex items-center gap-2">
                  <Activity className="h-3 w-3 text-emerald-400" strokeWidth={1.5} />
                  <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">
                    zk_stream / live
                  </span>
                </div>
                <span className="font-mono text-[10px] text-emerald-400">●  REC</span>
              </div>
              <div className="flex-1 overflow-auto px-4 py-3 font-mono text-[11px] leading-6">
                {events.map((e, i) => (
                  <div
                    key={i}
                    className="flex items-baseline gap-3 text-slate-500"
                    style={{ opacity: Math.max(0.35, 1 - i * 0.03) }}
                  >
                    <span className="text-slate-600">[{e.ts}]</span>
                    <span className="text-emerald-400/80">{e.type}:</span>
                    <span className="text-slate-300">{e.payload}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function KybBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Verified: "text-emerald-700 bg-emerald-50 border-emerald-200",
    Pending: "text-amber-700 bg-amber-50 border-amber-200",
    Review: "text-slate-700 bg-slate-100 border-slate-200",
  };
  const cls = map[status] || map.Review;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 border rounded-sm font-mono text-[10px] tracking-[0.15em] uppercase ${cls}`}
    >
      <span className="h-1 w-1 rounded-full bg-current" />
      {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Placeholder sub-routes. Built thin on purpose — depth comes after wiring.
// ─────────────────────────────────────────────────────────────────────────────
function Placeholder({ title, blurb, icon: Icon }: { title: string; blurb: string; icon: any }) {
  return (
    <div className="bg-slate-50 min-h-[calc(100vh-104px)] px-6 lg:px-10 py-12">
      <div className="max-w-2xl">
        <div className="flex items-center gap-3 mb-3">
          <Icon className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
          <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
            HQ Module
          </p>
        </div>
        <h1 className="text-2xl font-medium text-slate-900 tracking-tight mb-3">{title}</h1>
        <p className="text-sm text-slate-600 leading-relaxed mb-6 max-w-xl">{blurb}</p>
        <div className="border-t-2 border-slate-900 pt-6">
          <p className="font-mono text-[11px] tracking-wide text-slate-500">
            Module under construction · Wiring scheduled in next pass.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Outer page. Auth-gated to platform admins.
// ─────────────────────────────────────────────────────────────────────────────
export default function HQ() {
  const { isAdmin } = useAuth();

  return (
    <RequireAuth>
      {/* Non-admins are bounced to the standard dashboard with a denied flag. */}
      {!isAdmin ? (
        <Navigate to="/dashboard?denied=1" replace />
      ) : (
        <div className="min-h-screen bg-slate-50" style={{ fontFamily: "Inter, sans-serif" }}>
          <CommandBar />
          <SecondaryNav />
          <Routes>
            <Route path="/" element={<NetworkPulse />} />
            <Route
              path="/entities"
              element={
                <Placeholder
                  title="Entity Oversight"
                  blurb="Deep dive on every organisation in the sovereign network — KYB lineage, beneficial ownership graph, jurisdiction posture, and cross-border exposure scoring."
                  icon={Shield}
                />
              }
            />
            <Route
              path="/ledger"
              element={
                <Placeholder
                  title="Ledger Analytics"
                  blurb="Aggregate, privacy-preserving analytics over the sealed ledger: throughput, settlement latency, hash-chain integrity, and gate-pass distributions. Counterparty detail remains opaque."
                  icon={Activity}
                />
              }
            />
            <Route
              path="/anomalies"
              element={
                <Placeholder
                  title="Anomaly Alerts"
                  blurb="Network-level red flags: unusual API velocity, cross-jurisdiction surges, repeated Gate-4 escalations, and signing-key anomalies — all surfaced without inspecting trade contents."
                  icon={AlertTriangle}
                />
              }
            />
          </Routes>
        </div>
      )}
    </RequireAuth>
  );
}
