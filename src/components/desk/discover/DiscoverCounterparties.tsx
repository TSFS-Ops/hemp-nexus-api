/**
 * DiscoverCounterparties, Trade Desk shell for the live Discovery Engine.
 *
 * Mounts the legacy CounterpartySearch component (which owns all Supabase
 * queries, the parsed-query pipeline, role context, and batched match
 * creation) inside the institutional Trade Desk container. No data binding
 * is altered here, this file is purely the presentational wrapper.
 */

import CounterpartySearch from "@/components/CounterpartySearch";
export function DiscoverCounterparties() {
  return <>
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="mb-8 sm:mb-10">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-500">
            Liquidity Network
          </p>
          <div className="flex items-center gap-1.5 text-[10px] font-mono tracking-wider uppercase text-slate-400">
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Verified
            </span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500" /> Registered
            </span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500" /> Order Book
            </span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Web
            </span>
          </div>
        </div>
        <h1 className="text-4xl lg:text-5xl font-semibold text-slate-900 tracking-tight leading-[1.1]">
          Discover Counterparties
        </h1>
        <p className="mt-5 text-base text-slate-600 leading-relaxed max-w-2xl">
          Search the verified institutional network. Use natural language — the system parses commodity, jurisdiction, role, and liquidity signals, then ranks counterparties by source tier.
        </p>
      </header>

      {/* ── Live Search (legacy logic, preserved) ───────────── */}
      <CounterpartySearch />
    </>;
}