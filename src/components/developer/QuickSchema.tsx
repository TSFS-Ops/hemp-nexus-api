/**
 * QuickSchema — inline JSON reference for the Match object.
 * Blue for keys, amber for values, slate for punctuation.
 */
export function QuickSchema() {
  return (
    <section>
      <div className="flex items-end justify-between mb-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
          // QUICK_SCHEMA · Match
        </div>
        <a
          href="/developer/schema"
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400 hover:text-cyan-400 transition-colors"
        >
          full reference →
        </a>
      </div>
      <pre className="bg-black border border-slate-800 rounded-sm p-4 font-mono text-[12px] leading-[1.7] overflow-x-auto">
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
        <span className="text-slate-500">{"}"},</span>
        {"\n  "}
        <K>"poi"</K>: <span className="text-slate-500">{"{"}</span>
        {"\n    "}
        <K>"state"</K>: <V>"sealed"</V>,
        {"\n    "}
        <K>"burn_tx"</K>: <V>"0xabc…123"</V>,
        {"\n    "}
        <K>"sealed_at"</K>: <V>"2026-04-17T12:46:11Z"</V>
        {"\n  "}
        <span className="text-slate-500">{"}"}</span>
        {"\n"}
        <span className="text-slate-500">{"}"}</span>
      </pre>
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
