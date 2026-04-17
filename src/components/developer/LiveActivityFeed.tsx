import { useEffect, useRef, useState } from "react";

interface LogLine {
  ts: string;
  method: "POST" | "GET" | "PUT" | "DELETE";
  path: string;
  status: number;
}

const PATHS = [
  "/v1/match.created",
  "/v1/match.sealed",
  "/v1/poi.sealed",
  "/v1/poi.generate",
  "/v1/entities/search",
  "/v1/trade.search",
  "/v1/webhooks.deliver",
  "/v1/audit.export",
  "/v1/key.rotate",
];
const METHODS: LogLine["method"][] = ["POST", "GET", "POST", "GET", "POST"];
const STATUSES = [200, 200, 200, 200, 201, 204, 404, 429, 500];

function makeLine(): LogLine {
  const now = new Date();
  const ts = now.toISOString().replace("T", " ").slice(0, 19);
  return {
    ts,
    method: METHODS[Math.floor(Math.random() * METHODS.length)],
    path: PATHS[Math.floor(Math.random() * PATHS.length)],
    status: STATUSES[Math.floor(Math.random() * STATUSES.length)],
  };
}

const SEED: LogLine[] = [
  { ts: "2026-04-17 12:46:11", method: "GET",  path: "/v1/entities/search",  status: 200 },
  { ts: "2026-04-17 12:45:48", method: "POST", path: "/v1/poi.sealed",       status: 200 },
  { ts: "2026-04-17 12:45:02", method: "POST", path: "/v1/match.created",    status: 200 },
  { ts: "2026-04-17 12:44:39", method: "POST", path: "/v1/webhooks.deliver", status: 200 },
  { ts: "2026-04-17 12:44:11", method: "GET",  path: "/v1/audit.export",     status: 200 },
  { ts: "2026-04-17 12:43:55", method: "POST", path: "/v1/match.sealed",     status: 201 },
];

function statusColor(s: number) {
  if (s >= 500) return "text-rose-400";
  if (s >= 400) return "text-amber-400";
  if (s >= 300) return "text-cyan-400";
  return "text-green-400";
}

function statusLabel(s: number) {
  switch (s) {
    case 200: return "OK";
    case 201: return "CREATED";
    case 204: return "NO CONTENT";
    case 404: return "NOT FOUND";
    case 429: return "RATE LIMITED";
    case 500: return "ERROR";
    default: return "";
  }
}

export function LiveActivityFeed() {
  const [lines, setLines] = useState<LogLine[]>(SEED);
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setLines((prev) => [makeLine(), ...prev].slice(0, 80));
    }, 1800);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <section>
      <div className="flex items-end justify-between mb-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
            §02 / Realtime
          </div>
          <h2
            className="mt-1 text-lg text-slate-100 tracking-tight"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            Live Event Stream
          </h2>
        </div>
        <button
          onClick={() => setPaused(!paused)}
          className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400 hover:text-slate-100 transition-colors"
        >
          {paused ? "▶ resume" : "⏸ pause"}
        </button>
      </div>

      <div className="bg-black border border-slate-800 rounded-sm">
        {/* Terminal chrome */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-rose-500/60" />
            <span className="h-2 w-2 rounded-full bg-amber-500/60" />
            <span className="h-2 w-2 rounded-full bg-emerald-500/60" />
            <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
              tail -f /var/log/izenzo/api.stream
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className={`absolute inline-flex h-full w-full rounded-full ${paused ? "bg-slate-600" : "bg-green-500 opacity-60 animate-ping"}`} />
              <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${paused ? "bg-slate-600" : "bg-green-500"}`} />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
              {paused ? "paused" : "live"}
            </span>
          </div>
        </div>

        {/* Log */}
        <div ref={ref} className="max-h-[420px] overflow-y-auto p-4 font-mono text-[12px] leading-[1.7]">
          {lines.map((l, i) => (
            <div key={`${l.ts}-${i}`} className="flex items-baseline gap-3 whitespace-nowrap">
              <span className="text-blue-400">[{l.ts}]</span>
              <span className="text-slate-400 w-12">{l.method}</span>
              <span className="text-slate-100">{l.path}</span>
              <span className="text-slate-600">·</span>
              <span className={statusColor(l.status)}>
                {l.status} {statusLabel(l.status)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
