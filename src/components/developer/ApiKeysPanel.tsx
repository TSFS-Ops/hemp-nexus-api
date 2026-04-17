import { useState } from "react";
import { Copy, RefreshCw, Eye, EyeOff, Check, Plus } from "lucide-react";

interface KeyRow {
  id: string;
  label: string;
  env: "live" | "test";
  prefix: string;
  scopes: string[];
  lastUsed: string;
}

const KEYS: KeyRow[] = [
  {
    id: "1",
    label: "Production — Backend",
    env: "live",
    prefix: "iz_live_7Hq2X9Bm4K",
    scopes: ["trade:read", "trade:write", "poi:generate"],
    lastUsed: "12s ago",
  },
  {
    id: "2",
    label: "Staging — CI Pipeline",
    env: "test",
    prefix: "iz_test_3Lp8R2Wn1V",
    scopes: ["trade:read", "webhooks:manage"],
    lastUsed: "4m ago",
  },
  {
    id: "3",
    label: "Analytics Worker",
    env: "live",
    prefix: "iz_live_9Tk4M6Yc8Q",
    scopes: ["audit:read"],
    lastUsed: "1h ago",
  },
];

function KeyCard({ row }: { row: KeyRow }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const masked = `${row.prefix.split("_").slice(0, 2).join("_")}_••••••••••••••••`;
  const display = revealed ? `${row.prefix}••••••••••••` : masked;

  const copy = async () => {
    await navigator.clipboard.writeText(row.prefix);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <span
            className={[
              "text-[10px] uppercase tracking-[0.18em] px-1.5 py-0.5 rounded-sm border",
              row.env === "live"
                ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/5"
                : "text-amber-300 border-amber-500/40 bg-amber-500/5",
            ].join(" ")}
          >
            {row.env}
          </span>
          <span className="text-[13px] text-slate-100">{row.label}</span>
        </div>
        <span className="text-[11px] text-slate-500">last used {row.lastUsed}</span>
      </div>

      {/* Key field */}
      <div className="px-5 py-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2">
          Secret Key
        </div>
        <div className="flex items-stretch gap-2">
          <div className="flex-1 bg-slate-950 border border-slate-800 rounded-sm px-3 py-2.5 text-[13px] text-emerald-300 overflow-x-auto whitespace-nowrap">
            {display}
          </div>
          <button
            onClick={() => setRevealed(!revealed)}
            className="px-3 bg-slate-950 border border-slate-800 rounded-sm text-slate-400 hover:text-slate-100 hover:border-slate-700 transition-colors"
            title={revealed ? "Hide" : "Reveal"}
          >
            {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={copy}
            className="px-3 bg-slate-950 border border-slate-800 rounded-sm text-slate-400 hover:text-emerald-300 hover:border-slate-700 transition-colors"
            title="Copy"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Scopes */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {row.scopes.map((s) => (
            <span
              key={s}
              className="text-[10px] tracking-tight text-slate-400 bg-slate-950 border border-slate-800 px-1.5 py-0.5 rounded-sm"
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 px-5 py-2.5 border-t border-slate-800 bg-slate-950/40">
        <button className="text-[11px] uppercase tracking-[0.14em] text-slate-400 hover:text-amber-300 transition-colors flex items-center gap-1.5">
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
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
            §01 / Authentication
          </div>
          <h2 className="mt-1 text-lg text-slate-100 tracking-tight">
            Production API Keys
          </h2>
        </div>
        <button className="text-[11px] uppercase tracking-[0.14em] text-slate-300 border border-slate-700 hover:border-emerald-400/60 hover:text-emerald-300 px-3 py-1.5 rounded-sm flex items-center gap-1.5 transition-colors">
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
