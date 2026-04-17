import { useState } from "react";
import { Copy, RefreshCw, Eye, EyeOff, Check, Plus } from "lucide-react";

interface KeyRow {
  id: string;
  label: string;
  env: "live" | "test";
  /** masked-display fragments around the bullets */
  prefix: string;
  suffix: string;
  /** raw value for clipboard only */
  raw: string;
  scopes: string[];
  lastUsed: string;
}

const KEYS: KeyRow[] = [
  {
    id: "1",
    label: "Production · Backend",
    env: "live",
    prefix: "iz_live_77f4",
    suffix: "3a21",
    raw: "iz_live_77f4Hq2X9Bm4KLp8R2Wn3a21",
    scopes: ["trade:read", "trade:write", "poi:generate"],
    lastUsed: "12s ago",
  },
  {
    id: "2",
    label: "Staging · CI Pipeline",
    env: "test",
    prefix: "iz_test_3lp8",
    suffix: "8e02",
    raw: "iz_test_3lp8R2Wn1V9Tk4M6Yc8Q8e02",
    scopes: ["trade:read", "webhooks:manage"],
    lastUsed: "4m ago",
  },
  {
    id: "3",
    label: "Analytics · Worker",
    env: "live",
    prefix: "iz_live_9tk4",
    suffix: "1f9c",
    raw: "iz_live_9tk4M6Yc8Q2Fz1N5Jb7P1f9c",
    scopes: ["audit:read"],
    lastUsed: "1h ago",
  },
];

function KeyCard({ row }: { row: KeyRow }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const masked = `${row.prefix}••••••••••••••••${row.suffix}`;
  const display = revealed ? row.raw : masked;

  const copy = async () => {
    await navigator.clipboard.writeText(row.raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span
            className={[
              "font-mono text-[10px] uppercase tracking-[0.2em] px-1.5 py-0.5 border",
              row.env === "live"
                ? "text-green-400 border-green-500/40"
                : "text-amber-300 border-amber-500/40",
            ].join(" ")}
          >
            {row.env}
          </span>
          <span className="text-[13px] text-slate-100" style={{ fontFamily: "Inter, sans-serif" }}>
            {row.label}
          </span>
        </div>
        <span className="font-mono text-[11px] text-slate-400">last used {row.lastUsed}</span>
      </div>

      {/* Key field */}
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 mb-2">
          Live Secret Key
        </div>
        <div className="flex items-stretch gap-2">
          <div className="flex-1 bg-black border border-slate-800 px-3 py-2.5 font-mono text-[13px] text-green-400 overflow-x-auto whitespace-nowrap rounded-sm">
            {display}
          </div>
          <button
            onClick={() => setRevealed(!revealed)}
            className="px-3 bg-black border border-slate-700 text-slate-400 hover:text-slate-100 hover:border-slate-600 transition-colors rounded-sm"
            title={revealed ? "Hide" : "Reveal"}
            aria-label={revealed ? "Hide key" : "Reveal key"}
          >
            {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={copy}
            className="px-3 bg-black border border-slate-700 text-slate-400 hover:text-green-400 hover:border-slate-600 transition-colors rounded-sm"
            title="Copy"
            aria-label="Copy key"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Scopes */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {row.scopes.map((s) => (
            <span
              key={s}
              className="font-mono text-[10px] tracking-tight text-slate-400 bg-black border border-slate-800 px-1.5 py-0.5 rounded-sm"
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 mt-5">
        <button className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400 hover:text-amber-300 border border-slate-700 hover:border-amber-500/50 px-3 py-1.5 rounded-sm transition-colors flex items-center gap-1.5">
          <RefreshCw className="h-3 w-3" />
          Rotate Key
        </button>
      </div>
    </div>
  );
}

export function ApiKeysPanel() {
  return (
    <section>
      <div className="flex items-end justify-between mb-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
            §01 / Authentication
          </div>
          <h2
            className="mt-1 text-lg text-slate-100 tracking-tight"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            Production Infrastructure Keys
          </h2>
        </div>
        <button className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-100 border border-slate-700 hover:border-green-400/60 hover:text-green-400 px-3 py-1.5 rounded-sm flex items-center gap-1.5 transition-colors">
          <Plus className="h-3 w-3" />
          New Key
        </button>
      </div>

      <div className="space-y-3">
        {KEYS.map((k) => (
          <KeyCard key={k.id} row={k} />
        ))}
      </div>
    </section>
  );
}
