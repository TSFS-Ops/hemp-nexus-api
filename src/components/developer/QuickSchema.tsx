/**
 * QuickSchema, inline JSON reference for the core Match + POI objects.
 * Blue for keys, amber for values. Lets a developer learn the data model
 * without leaving the page.
 */
export function QuickSchema() {
  return (
    <section>
      <div className="flex items-end justify-between mb-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
          // QUICK_REFERENCE · core objects
        </div>
        <a
          href="/developer/schema"
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400 hover:text-cyan-400 transition-colors"
        >
          full reference →
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Match */}
        <div>
          <div className="px-3 py-1.5 bg-slate-900 border border-slate-800 border-b-0 rounded-t-sm font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
            object · Match
          </div>
          <pre className="bg-black border border-slate-800 rounded-b-sm p-4 font-mono text-[12px] leading-[1.7] overflow-x-auto">
            <span className="text-slate-500">{"{"}</span>
            {"\n  "}
            <K>"match_id"</K>: <V>"mch_77f4a219"</V>,
            {"\n  "}
            <K>"side"</K>: <V>"buy"</V>,
            {"\n  "}
            <K>"commodity"</K>: <V>"maize.yellow.za"</V>,
            {"\n  "}
            <K>"quantity_mt"</K>: <N>5000</N>,
            {"\n  "}
            <K>"price_zar"</K>: <N>4250</N>,
            {"\n  "}
            <K>"incoterm"</K>: <V>"FOB Durban"</V>,
            {"\n  "}
            <K>"counterparty"</K>: <span className="text-slate-500">{"{"}</span>
            {"\n    "}
            <K>"entity_id"</K>: <V>"ent_4Lp2"</V>,
            {"\n    "}
            <K>"kyc_status"</K>: <V>"verified"</V>
            {"\n  "}
            <span className="text-slate-500">{"}"}</span>
            {"\n"}
            <span className="text-slate-500">{"}"}</span>
          </pre>
        </div>

        {/* POI */}
        <div>
          <div className="px-3 py-1.5 bg-slate-900 border border-slate-800 border-b-0 rounded-t-sm font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
            object · POI
          </div>
          <pre className="bg-black border border-slate-800 rounded-b-sm p-4 font-mono text-[12px] leading-[1.7] overflow-x-auto">
            <span className="text-slate-500">{"{"}</span>
            {"\n  "}
            <K>"poi_id"</K>: <V>"poi_3a21bc"</V>,
            {"\n  "}
            <K>"match_id"</K>: <V>"mch_77f4a219"</V>,
            {"\n  "}
            <K>"state"</K>: <V>"sealed"</V>,
            {"\n  "}
            <K>"burn_amount_znzo"</K>: <N>10</N>,
            {"\n  "}
            <K>"burn_tx"</K>: <V>"0xabc…123"</V>,
            {"\n  "}
            <K>"issued_at"</K>: <V>"2026-04-17T12:45:48Z"</V>,
            {"\n  "}
            <K>"sealed_at"</K>: <V>"2026-04-17T12:46:11Z"</V>,
            {"\n  "}
            <K>"signature_valid"</K>: <B>true</B>
            {"\n"}
            <span className="text-slate-500">{"}"}</span>
          </pre>
        </div>
      </div>
    </section>
  );
}

const K = ({ children }: { children: React.ReactNode }) => (
  <span className="text-blue-400">{children}</span>
);
const V = ({ children }: { children: React.ReactNode }) => (
  <span className="text-amber-300">{children}</span>
);
const N = ({ children }: { children: React.ReactNode }) => (
  <span className="text-amber-400">{children}</span>
);
const B = ({ children }: { children: React.ReactNode }) => (
  <span className="text-rose-400">{children}</span>
);
