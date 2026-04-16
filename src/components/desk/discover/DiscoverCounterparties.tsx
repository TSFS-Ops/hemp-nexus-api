/**
 * DiscoverCounterparties — Institutional search terminal for verified
 * trading entities. Editorial layout, command-bar input, and AI match
 * insights surfaced inline on each result row.
 *
 * Pure presentational mockup — results are hard-coded.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Check } from "lucide-react";
import { motion } from "framer-motion";

type Counterparty = {
  id: string;
  name: string;
  registration: string;
  jurisdiction: string;
  jurisdictionFlag: string;
  kybCleared: boolean;
  matchConfidence: number;
  insight: string;
};

const RESULTS: Counterparty[] = [
  {
    id: "aurubis-ag",
    name: "Aurubis AG",
    registration: "REG: HRB 6789",
    jurisdiction: "DE",
    jurisdictionFlag: "🇩🇪",
    kybCleared: true,
    matchConfidence: 94,
    insight:
      "High liquidity in Copper Cathode. Average ticket size aligns with your profile.",
  },
  {
    id: "trafigura-pte",
    name: "Trafigura Pte Ltd",
    registration: "UEN: 200304436Z",
    jurisdiction: "SG",
    jurisdictionFlag: "🇸🇬",
    kybCleared: true,
    matchConfidence: 89,
    insight:
      "Strong CIF Rotterdam corridor. Counterparty has settled 12 LME-grade trades in last quarter.",
  },
  {
    id: "ksb-mining",
    name: "KSB Mining (Pty) Ltd",
    registration: "REG: 2014/183920/07",
    jurisdiction: "ZA",
    jurisdictionFlag: "🇿🇦",
    kybCleared: true,
    matchConfidence: 81,
    insight:
      "SADC-region origination partner. Demonstrated UBO transparency and active sanctions clearance.",
  },
  {
    id: "glencore-intl",
    name: "Glencore International AG",
    registration: "REG: CHE-100.493.046",
    jurisdiction: "CH",
    jurisdictionFlag: "🇨🇭",
    kybCleared: true,
    matchConfidence: 76,
    insight:
      "Deep liquidity but typically transacts at higher minimum volumes than your historical pattern.",
  },
];

const FILTER_PILLS = ["All Roles", "Commodity", "Jurisdiction", "Verified Only"];

export function DiscoverCounterparties() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All Roles");

  return (
    <>
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="mb-12">
        <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-500 mb-3">
          Liquidity Network
        </p>
        <h1 className="text-4xl lg:text-5xl font-semibold text-slate-900 tracking-tight leading-[1.1]">
          Discover Counterparties
        </h1>
        <p className="mt-5 text-base text-slate-600 leading-relaxed max-w-2xl">
          Search the verified institutional network. Use natural language — the system parses
          commodity, jurisdiction, role, and liquidity signals.
        </p>
      </header>

      {/* ── Command Bar ─────────────────────────────────────── */}
      <section>
        <div className="relative group">
          <Search
            className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-slate-900 transition-colors"
            strokeWidth={1.75}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g., Verified copper cathode suppliers in the SADC region…"
            className="w-full bg-white border-0 border-b-2 border-slate-300 pl-9 pr-4 py-4 text-lg text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-0 transition-colors"
          />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {FILTER_PILLS.map((pill) => {
            const isActive = pill === activeFilter;
            return (
              <button
                key={pill}
                onClick={() => setActiveFilter(pill)}
                className={`px-3 py-1.5 rounded-full border text-xs transition-colors ${
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:text-slate-900"
                }`}
              >
                {pill}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Results ─────────────────────────────────────────── */}
      <section className="mt-12">
        <div className="flex items-baseline justify-between pb-4 border-b border-slate-200">
          <h2 className="font-mono text-[11px] tracking-[0.25em] uppercase text-slate-600">
            {RESULTS.length} Verified Matches
          </h2>
          <span className="font-mono text-[11px] tracking-[0.2em] uppercase text-slate-400">
            Sorted by Confidence
          </span>
        </div>

        <ul className="mt-6 space-y-4">
          {RESULTS.map((cp, i) => (
            <motion.li
              key={cp.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeOut", delay: i * 0.06 }}
            >
              <CounterpartyCard counterparty={cp} onStartTrade={() => navigate("/desk/match/new")} />
            </motion.li>
          ))}
        </ul>
      </section>
    </>
  );
}

/* ────────────────────────────────────────────────────────────── */

function CounterpartyCard({
  counterparty,
  onStartTrade,
}: {
  counterparty: Counterparty;
  onStartTrade: () => void;
}) {
  const { name, registration, jurisdiction, jurisdictionFlag, kybCleared, matchConfidence, insight } =
    counterparty;

  return (
    <article className="group bg-white border border-slate-200 rounded-sm p-6 transition-colors hover:border-slate-400">
      <div className="grid grid-cols-12 gap-8 items-start">
        {/* Column 1 — Identity */}
        <div className="col-span-4">
          <h3 className="text-lg font-semibold text-slate-900 tracking-tight leading-snug">
            {name}
          </h3>
          <p className="mt-2 font-mono text-xs text-slate-500 tracking-wide">
            {registration} <span className="text-slate-300 px-1">|</span>{" "}
            <span className="text-slate-700">
              {jurisdictionFlag} {jurisdiction}
            </span>
          </p>
          {kybCleared && (
            <div className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
              <Check className="h-3 w-3" strokeWidth={3} />
              KYB Cleared
            </div>
          )}
        </div>

        {/* Column 2 — AI Match Insight */}
        <div className="col-span-5">
          <div className="bg-slate-50 border-l-2 border-slate-900 pl-4 pr-3 py-3">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
                Match Confidence
              </p>
              <p className="font-mono text-sm font-medium text-slate-900 tabular-nums">
                {matchConfidence}%
              </p>
            </div>
            <p className="text-sm text-slate-800 leading-relaxed">
              <span className="font-medium text-slate-900">Match Insight:</span> {insight}
            </p>
          </div>
        </div>

        {/* Column 3 — Action */}
        <div className="col-span-3 flex flex-col items-end gap-3">
          <button
            onClick={onStartTrade}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors w-full"
          >
            Start Trade
          </button>
          <button className="text-xs text-slate-600 hover:text-slate-900 transition-colors">
            View Full Profile
          </button>
        </div>
      </div>
    </article>
  );
}
