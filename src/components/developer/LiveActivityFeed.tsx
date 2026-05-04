import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PanelStatusBadge } from "./PanelStatusBadge";
interface LogRow {
  id: string;
  created_at: string;
  method: string;
  endpoint: string;
  status_code: number;
  response_time_ms: number | null;
}
function statusColor(s: number) {
  if (s >= 500) return "text-rose-400";
  if (s >= 400) return "text-amber-400";
  if (s >= 300) return "text-cyan-400";
  return "text-green-400";
}
function statusLabel(s: number) {
  if (s >= 500) return "ERROR";
  if (s === 429) return "RATE LIMITED";
  if (s === 404) return "NOT FOUND";
  if (s >= 400) return "BAD REQUEST";
  if (s === 204) return "NO CONTENT";
  if (s === 201) return "CREATED";
  if (s >= 200) return "OK";
  return "";
}
function formatTs(iso: string) {
  return iso.replace("T", " ").slice(0, 19);
}
export function LiveActivityFeed() {
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [lastBeat, setLastBeat] = useState<string>(new Date().toISOString());
  const {
    data: lines = [],
    isLoading
  } = useQuery<LogRow[]>({
    queryKey: ["live-activity-feed"],
    queryFn: async () => {
      const {
        data,
        error
      } = await supabase.from("api_request_logs").select("id, created_at, method, endpoint, status_code, response_time_ms").order("created_at", {
        ascending: false
      }).limit(50);
      if (error) throw error;
      setLastBeat(new Date().toISOString());
      return (data ?? []) as LogRow[];
    },
    refetchInterval: paused ? false : 5000,
    refetchOnWindowFocus: false
  });

  // Realtime subscription for instant updates
  useEffect(() => {
    if (paused) return;
    const channel = supabase.channel("api_request_logs_stream").on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "api_request_logs"
    }, () => {
      setLastBeat(new Date().toISOString());
    }).subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [paused]);
  return <section>
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">§02 / Realtime</span>
            <PanelStatusBadge kind="functional" />
          </div>
          <h2 className="mt-1 text-lg text-slate-100 tracking-tight" style={{ fontFamily: "Inter, sans-serif" }}>
            Live Event Stream
          </h2>
          <p className="mt-1 text-[12.5px] text-slate-400 max-w-2xl" style={{ fontFamily: "Inter, sans-serif" }}>
            Every API call your keys have made in the last hour, newest first. Use this to confirm a request reached us and copy a request_id for support.
          </p>
        </div>
        <button onClick={() => setPaused(!paused)} className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400 hover:text-slate-100 transition-colors">
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
          {isLoading && lines.length === 0 ? <div className="text-slate-500">connecting to telemetry stream…</div> : lines.length === 0 ? <div className="space-y-2">
              <div className="text-slate-500">// zero activity in window</div>
              <div className="text-slate-600">
                last heartbeat: <span className="text-slate-400">{formatTs(lastBeat)}</span>
              </div>
              <div className="text-slate-600"> awaiting first request on /v1/*, no API traffic recorded yet. </div>
            </div> : lines.map(l => <div key={l.id} className="flex items-baseline gap-3 whitespace-nowrap">
                <span className="text-blue-400">[{formatTs(l.created_at)}]</span>
                <span className="text-slate-400 w-12">{l.method}</span>
                <span className="text-slate-100">{l.endpoint}</span>
                <span className="text-slate-600">·</span>
                <span className={statusColor(l.status_code)}>
                  {l.status_code} {statusLabel(l.status_code)}
                </span>
                {l.response_time_ms != null && <>
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-500">{l.response_time_ms}ms</span>
                  </>}
              </div>)}
        </div>
      </div>
    </section>;
}