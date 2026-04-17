function Sparkline({
  points,
  stroke,
}: {
  points: number[];
  stroke: string;
}) {
  const w = 96;
  const h = 28;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = h - ((p - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const LATENCY = [48, 44, 51, 39, 42, 40, 46, 41, 38, 43, 45, 42];
const UPTIME = [99.97, 99.98, 99.99, 99.96, 99.98, 99.99, 99.98, 99.99, 99.98, 99.99, 99.98, 99.98];

export function SystemDiagnostics() {
  const used = 1240;
  const limit = 10000;
  const pct = (used / limit) * 100;

  return (
    <section>
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">
        // SYSTEM_DIAGNOSTICS
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Latency */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-sm">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
                AVG_LATENCY
              </div>
              <div className="mt-2 font-mono text-2xl text-slate-100 leading-none">
                42<span className="text-sm text-slate-400">ms</span>
              </div>
              <div className="mt-1 font-mono text-[10px] text-green-400">▼ 8ms vs 24h</div>
            </div>
            <Sparkline points={LATENCY} stroke="rgb(74 222 128)" />
          </div>
        </div>

        {/* Uptime */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-sm">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
                UPTIME_24H
              </div>
              <div className="mt-2 font-mono text-2xl text-slate-100 leading-none">
                99.98<span className="text-sm text-slate-400">%</span>
              </div>
              <div className="mt-1 font-mono text-[10px] text-slate-400">0 incidents</div>
            </div>
            <Sparkline points={UPTIME} stroke="rgb(96 165 250)" />
          </div>
        </div>

        {/* Rate limit */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-sm">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
            RATE_LIMIT_USAGE
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl text-slate-100 leading-none">
              {used.toLocaleString()}
            </span>
            <span className="font-mono text-xs text-slate-500">/ {limit.toLocaleString()} req·hr</span>
          </div>
          <div className="mt-3 h-1.5 bg-black border border-slate-800 rounded-sm overflow-hidden">
            <div
              className="h-full bg-amber-400/80"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 font-mono text-[10px] text-slate-500">
            {pct.toFixed(1)}% · resets in 38m
          </div>
        </div>
      </div>
    </section>
  );
}
