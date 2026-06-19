/**
 * SystemHealthPanel — surfaces deployment + liveness status for every
 * facilitation-* edge function. Calls the `facilitation-health-probe`
 * aggregator (platform_admin gated, no mutations) on demand and renders
 * a Stripe-style table: function · status · latency · request_id · error.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { friendlyFacilitationError } from "@/lib/facilitation-labels";

type ProbeResult = {
  fn: string;
  ok: boolean;
  status: number;
  latency_ms: number;
  request_id: string | null;
  version: string | number | null;
  probe_response: boolean;
  error: unknown;
};

type ProbeResponse = {
  summary: { total: number; healthy: number; degraded: number; checked_at: string };
  probes: ProbeResult[];
};

function formatError(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.error === "string") return o.error;
    if (typeof o.code === "string") return o.code;
    try { return JSON.stringify(o).slice(0, 200); } catch { return "Unknown error"; }
  }
  return String(err);
}

export function SystemHealthPanel() {
  const [data, setData] = useState<ProbeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: res, error: err } = await supabase.functions.invoke<ProbeResponse>(
        "facilitation-health-probe",
        { method: "GET" },
      );
      if (err) throw err;
      if (!res) throw new Error("Empty response from facilitation-health-probe");
      setData(res);
    } catch (e) {
      setError(await friendlyFacilitationError(e, "Could not load edge function health."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void run(); }, [run]);

  const summary = data?.summary;
  const probes = data?.probes ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm">
          {summary ? (
            <>
              <Badge variant={summary.degraded === 0 ? "default" : "destructive"} className="font-mono">
                {summary.healthy}/{summary.total} healthy
              </Badge>
              <span className="text-xs text-muted-foreground font-mono">
                checked {new Date(summary.checked_at).toLocaleTimeString()}
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Probing…</span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => void run()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <RefreshCw className="h-3.5 w-3.5 mr-2" />}
          Re-probe
        </Button>
      </div>

      {error && (
        <div className="border border-destructive/40 bg-destructive/5 text-destructive text-xs px-3 py-2 rounded-sm">
          {error}
        </div>
      )}

      <div className="border border-border rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-3 py-2">Function</th>
              <th className="text-left font-medium px-3 py-2 w-28">Status</th>
              <th className="text-right font-medium px-3 py-2 w-24">Latency</th>
              <th className="text-left font-medium px-3 py-2 w-20">HTTP</th>
              <th className="text-left font-medium px-3 py-2">Request ID</th>
              <th className="text-left font-medium px-3 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {probes.length === 0 && !loading && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">No probe data.</td></tr>
            )}
            {probes.map((p) => (
              <tr key={p.fn} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs">{p.fn}</td>
                <td className="px-3 py-2">
                  {p.ok ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Healthy
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" /> Degraded
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">{p.latency_ms}ms</td>
                <td className="px-3 py-2 font-mono text-xs">{p.status || "—"}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground truncate max-w-[180px]">
                  {p.request_id ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {p.ok
                    ? (p.probe_response ? `v${p.version ?? "?"}` : "Reachable (no health envelope)")
                    : formatError(p.error)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground font-mono leading-relaxed">
        Probes call <span className="text-foreground">GET /functions/v1/&lt;fn&gt;?__health=1</span> with header
        <span className="text-foreground"> x-health-probe: 1</span>. Each target short-circuits before auth and business
        logic and returns <span className="text-foreground">{`{ok, fn, version, now, uptime_ms}`}</span>. No mutations.
        Latency = round-trip from this browser via the aggregator.
      </p>
    </div>
  );
}
