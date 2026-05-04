function Sparkline({
  points,
  stroke,
  width = 120,
  height = 28,
}: {
  points: number[];
  stroke: string;
  width?: number;
  height?: number;
}) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = height - ((p - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

import { PanelStatusBadge } from "./PanelStatusBadge";

const LATENCY = [48, 44, 51, 39, 42, 40, 46, 41, 38, 43, 45, 42];

export function SystemDiagnostics() {
  const used = 1240;
  const limit = 10000;
  const pct = (used / limit) * 100;

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
          // SYSTEM_DIAGNOSTICS
        </div>
        <PanelStatusBadge kind="informational" />
      </div>
      <p className="text-[12px] text-slate-400 leading-relaxed mb-3 max-w-md" style={{ fontFamily: "Inter, sans-serif" }}>
        Headline platform health: latency, ledger sync, and your hourly request budget. Sample numbers shown until your account starts producing live traffic.
      </p>
      <div className="bg-slate-900 border border-slate-800 rounded-sm divide-y divide-slate-800">
        {/* Latency */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
              API_RESPONSE_TIME
            </span>
            <span className="font-mono text-[10px] text-green-400">▼ 8ms · 24h</span>
          </div>
          <div className="flex items-end justify-between">
            <div className="font-mono text-2xl text-slate-100 leading-none">
              42<span className="text-sm text-slate-400">ms</span>
            </div>
            <Sparkline points={LATENCY} stroke="rgb(74 222 128)" />
          </div>
          <div className="mt-2 text-[11px] text-slate-400" style={{ fontFamily: "Inter, sans-serif" }}>
            Median round-trip across the last 12 windows.
          </div>
        </div>

        {/* Ledger sync */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
              LEDGER_SYNC_STATUS
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-green-400">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
              </span>
              live
            </span>
          </div>
          <div className="font-mono text-2xl text-slate-100 leading-none">SYNCHRONIZED</div>
          <div className="mt-2 text-[11px] text-slate-400" style={{ fontFamily: "Inter, sans-serif" }}>
            All POI events written within the last block window. 0 incidents · 24h.
          </div>
        </div>

        {/* Rate limit */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
              REQUEST_QUOTA
            </span>
            <span className="font-mono text-[10px] text-slate-500">resets in 38m</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl text-slate-100 leading-none">
              {used.toLocaleString()}
            </span>
            <span className="font-mono text-xs text-slate-500">/ {limit.toLocaleString()} req·hr</span>
          </div>
          <div className="mt-3 h-1 bg-black border border-slate-800 rounded-sm overflow-hidden">
            <div
              className="h-full bg-amber-400/80"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-slate-400" style={{ fontFamily: "Inter, sans-serif" }}>
            {pct.toFixed(1)}% consumed. Burst headroom available.
          </div>
        </div>
      </div>
    </section>
  );
}
