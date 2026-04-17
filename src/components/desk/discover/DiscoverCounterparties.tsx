/**
 * DiscoverCounterparties — Trade Desk shell for the live Discovery Engine.
 *
 * Mounts the legacy CounterpartySearch component (which owns all Supabase
 * queries, the parsed-query pipeline, role context, and batched match
 * creation) inside the institutional Trade Desk container. No data binding
 * is altered here — this file is purely the presentational wrapper.
 */

import CounterpartySearch from "@/components/CounterpartySearch";

export function DiscoverCounterparties() {
  return (
    <>
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="mb-10">
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

      {/* ── Live Search (legacy logic, preserved) ───────────── */}
      <CounterpartySearch />
    </>
  );
}
