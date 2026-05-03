/**
 * AdminLifecycleRunPanel — TEMPORARY platform-admin-only manual trigger for
 * the `lifecycle-scheduler` edge function. Invoked via the protected
 * `admin-run-lifecycle` edge function which requires a signed-in
 * `platform_admin` JWT (server-side role check).
 *
 * This panel:
 *   - Does NOT disable maintenance mode.
 *   - Does NOT touch cron, billing, RBAC, RLS, CORS, webhooks, or storage.
 *   - Renders only inside HQ (already gated to platform_admin via RequireAuth + HQ route).
 *   - Shows the raw JSON returned by lifecycle-scheduler.
 */

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, PlayCircle } from "lucide-react";

type RunResult = {
  ok: boolean;
  httpStatus?: number;
  durationMs?: number;
  body?: unknown;
  error?: string;
};

export function AdminLifecycleRunPanel() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    const t0 = performance.now();
    try {
      const { data, error } = await supabase.functions.invoke("admin-run-lifecycle");
      const durationMs = Math.round(performance.now() - t0);
      if (error) {
        setResult({
          ok: false,
          durationMs,
          error: error.message || "Invocation failed",
          body: data ?? null,
        });
      } else {
        setResult({ ok: true, durationMs, body: data });
      }
    } catch (err) {
      setResult({
        ok: false,
        durationMs: Math.round(performance.now() - t0),
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-sm border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" strokeWidth={1.75} />
        <div className="text-[12px] leading-relaxed text-amber-900">
          <div className="font-semibold mb-0.5">
            Run lifecycle scheduler now — maintenance must remain ON
          </div>
          <div className="text-amber-800">
            Temporary platform-admin trigger. Invokes <code className="font-mono text-[11px]">lifecycle-scheduler</code> once
            via the protected <code className="font-mono text-[11px]">admin-run-lifecycle</code> edge function.
            Does not disable maintenance mode, change cron, or trigger any other job.
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={handleRun}
          disabled={running}
          className="bg-slate-900 hover:bg-slate-800 text-white rounded-sm font-mono text-[12px] tracking-wide"
        >
          {running ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Running…
            </>
          ) : (
            <>
              <PlayCircle className="h-4 w-4 mr-2" strokeWidth={1.75} />
              Run lifecycle scheduler now
            </>
          )}
        </Button>
        {result?.durationMs != null && (
          <span className="font-mono text-[11px] text-slate-500">
            {result.durationMs} ms
          </span>
        )}
      </div>

      {result && (
        <div className="rounded-sm border border-slate-200 bg-slate-50">
          <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
            <span className="font-mono text-[11px] tracking-wide uppercase text-slate-600">
              Result
            </span>
            <span
              className={`font-mono text-[11px] px-2 py-0.5 rounded-sm ${
                result.ok
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-rose-100 text-rose-800"
              }`}
            >
              {result.ok ? "OK" : "ERROR"}
            </span>
          </div>
          {result.error && (
            <div className="px-3 py-2 text-[12px] text-rose-700 font-mono border-b border-slate-200">
              {result.error}
            </div>
          )}
          <pre className="px-3 py-3 text-[11px] font-mono text-slate-800 overflow-auto max-h-[480px] whitespace-pre-wrap break-words">
            {JSON.stringify(result.body, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default AdminLifecycleRunPanel;
