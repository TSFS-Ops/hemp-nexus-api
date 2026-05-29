/**
 * Tenant Boundary Panel — HQ · platform_admin only.
 *
 * Surfaces the Stronger Tenant-Boundary Evidence Pack:
 *  - "Run probe" button → tenant-boundary-probe edge function
 *  - History of runs from public.tenant_boundary_evidence
 *  - Per-run JSON download via tenant-boundary-evidence-download
 *
 * Probe is non-destructive (no MFA gate, per user direction).
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, AlertTriangle, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type EvidenceRow = {
  run_id: string;
  run_at: string;
  status: "pass" | "fail" | "partial";
  tables_total: number;
  tables_passed: number;
  tables_failed: number;
  tables_allowlisted: number;
  critical_count: number;
  high_count: number;
  manifest_sha256: string;
  schema_hash: string;
};

function StatusBadge({ status }: { status: EvidenceRow["status"] }) {
  if (status === "pass") {
    return <Badge variant="outline" className="border-emerald-500 text-emerald-700">PASS</Badge>;
  }
  if (status === "partial") {
    return <Badge variant="outline" className="border-amber-500 text-amber-700">PARTIAL</Badge>;
  }
  return <Badge variant="outline" className="border-rose-500 text-rose-700">FAIL</Badge>;
}

export function TenantBoundaryPanel() {
  const [rows, setRows] = useState<EvidenceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("tenant_boundary_evidence")
        .select("run_id, run_at, status, tables_total, tables_passed, tables_failed, tables_allowlisted, critical_count, high_count, manifest_sha256, schema_hash")
        .order("run_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setRows((data ?? []) as EvidenceRow[]);
    } catch (e: any) {
      toast.error(`Failed to load evidence: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runProbe = useCallback(async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("tenant-boundary-probe", { body: {} });
      if (error) throw error;
      const status = (data as any)?.status ?? "unknown";
      const total = (data as any)?.tables_total ?? 0;
      toast.success(`Probe complete · ${status.toUpperCase()} · ${total} tables`);
      await load();
    } catch (e: any) {
      toast.error(`Probe failed: ${e?.message ?? e}`);
    } finally {
      setRunning(false);
    }
  }, [load]);

  const download = useCallback(async (runId: string) => {
    setDownloading(runId);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("No session");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tenant-boundary-evidence-download?run_id=${runId}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      a.download = `tenant-boundary-${runId}.json`;
      a.click();
      URL.revokeObjectURL(objUrl);
    } catch (e: any) {
      toast.error(`Download failed: ${e?.message ?? e}`);
    } finally {
      setDownloading(null);
    }
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-700" strokeWidth={1.5} />
            <h3 className="text-sm font-medium">Tenant-Boundary Evidence Pack</h3>
          </div>
          <p className="text-xs text-muted-foreground max-w-2xl">
            Reproducible static probe of <code className="font-mono text-[11px]">org_id</code> isolation across every
            multi-tenant table in <code className="font-mono text-[11px]">public</code>. Flags tables without RLS,
            with permissive <code className="font-mono text-[11px]">USING (true)</code> policies, or with policies
            that never reference <code className="font-mono text-[11px]">auth.uid()</code> /{" "}
            <code className="font-mono text-[11px]">has_role()</code> /{" "}
            <code className="font-mono text-[11px]">org_id</code>. Append-only, SHA-256 sealed.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={load} disabled={loading || running}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={runProbe} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />}
            Run probe
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs font-mono uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2">Run · UTC</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-right px-3 py-2">Tables</th>
              <th className="text-right px-3 py-2">Pass</th>
              <th className="text-right px-3 py-2">Fail</th>
              <th className="text-right px-3 py-2">Allowlisted</th>
              <th className="text-right px-3 py-2">Critical</th>
              <th className="text-right px-3 py-2">High</th>
              <th className="text-left px-3 py-2">Manifest SHA-256</th>
              <th className="text-right px-3 py-2">Download</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">
                  No probe runs yet. Click "Run probe" to generate the first evidence row.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.run_id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs">{new Date(r.run_at).toISOString().replace("T", " ").slice(0, 19)}</td>
                <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                <td className="px-3 py-2 text-right font-mono">{r.tables_total}</td>
                <td className="px-3 py-2 text-right font-mono text-emerald-700">{r.tables_passed}</td>
                <td className="px-3 py-2 text-right font-mono text-rose-700">{r.tables_failed}</td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground">{r.tables_allowlisted}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {r.critical_count > 0
                    ? <span className="text-rose-700 inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{r.critical_count}</span>
                    : <span className="text-muted-foreground">0</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {r.high_count > 0
                    ? <span className="text-amber-700">{r.high_count}</span>
                    : <span className="text-muted-foreground">0</span>}
                </td>
                <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground truncate max-w-[180px]" title={r.manifest_sha256}>
                  {r.manifest_sha256.slice(0, 16)}…
                </td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="ghost" disabled={downloading === r.run_id} onClick={() => download(r.run_id)}>
                    {downloading === r.run_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TenantBoundaryPanel;
